import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AntigravityChatTurn,
  AntigravityFeedEvent,
  AntigravityLiveState,
  AntigravityStepItem,
  AntigravityToolItem,
  GitDiffFile,
} from '../types/protocol.js';

const execFileAsync = promisify(execFile);

interface TranscriptToolCall {
  name?: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
}

interface TranscriptEntry {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  model?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  thinking?: string;
  content?: string;
  tool_calls?: TranscriptToolCall[];
}

function readTailLines(filePath: string, maxBytes = 320_000): string[] {
  const st = fs.statSync(filePath);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim().startsWith('{'));
  } finally {
    fs.closeSync(fd);
  }
}

function summarizeToolCall(tc: TranscriptToolCall): { summary: string; detail: string } {
  const name = tc.name || 'tool';
  const args = tc.args || tc.arguments || {};
  if (typeof args.Path === 'string') {
    return { summary: path.basename(args.Path), detail: args.Path };
  }
  if (typeof args.toolSummary === 'string') {
    const cmd = typeof args.CommandLine === 'string' ? args.CommandLine.slice(0, 120) : '';
    return { summary: args.toolSummary, detail: cmd || args.toolSummary };
  }
  if (typeof args.CommandLine === 'string') {
    return { summary: args.CommandLine.slice(0, 56), detail: args.CommandLine.slice(0, 140) };
  }
  if (typeof args.focus === 'string') {
    return { summary: args.focus, detail: args.focus };
  }
  if (typeof args.query === 'string') {
    return { summary: args.query, detail: args.query };
  }
  return { summary: name, detail: name };
}

export class AntigravityService {
  private timer: NodeJS.Timeout | null = null;
  private lastDigest = '';
  private latest: AntigravityLiveState = {
    active: false,
    statusLabel: 'IDLE',
    lastActivityTs: 0,
    conversationId: '',
    model: '',
    stepCount: 0,
    contextTokens: 0,
    currentFocus: '',
    lastUserPrompt: '',
    steps: [],
    recentEvents: [],
    chatTurns: [],
    artifactName: '',
    artifactPreview: '',
    diffFiles: [],
    totalAdded: 0,
    totalRemoved: 0,
  };

  constructor(
    private getProjectDir: () => string,
    private onUpdate: (state: AntigravityLiveState) => void,
  ) {}

  getLatest(): AntigravityLiveState {
    return this.latest;
  }

  private readLatestBrain(): Omit<AntigravityLiveState, 'diffFiles' | 'totalAdded' | 'totalRemoved'> {
    const empty = {
      active: false,
      statusLabel: 'IDLE' as const,
      lastActivityTs: 0,
      conversationId: '',
      model: '',
      stepCount: 0,
      contextTokens: 0,
      currentFocus: '',
      lastUserPrompt: '',
      steps: [] as AntigravityStepItem[],
      recentEvents: [] as AntigravityFeedEvent[],
      chatTurns: [] as AntigravityChatTurn[],
      artifactName: '',
      artifactPreview: '',
    };

    const brainRoot = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    try {
      if (!fs.existsSync(brainRoot)) return empty;

      const dirs = fs
        .readdirSync(brainRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(d.name))
        .map((d) => {
          const full = path.join(brainRoot, d.name);
          const logPath = path.join(full, '.system_generated', 'logs', 'transcript.jsonl');
          let mtime = fs.statSync(full).mtimeMs;
          if (fs.existsSync(logPath)) {
            mtime = Math.max(mtime, fs.statSync(logPath).mtimeMs);
          }
          return { name: d.name, full, logPath, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);

      const newest = dirs[0];
      if (!newest) return empty;

      let latestMtime = newest.mtime;
      let artifactName = '';
      let artifactPreview = '';
      for (const doc of ['implementation_plan.md', 'task.md', 'walkthrough.md']) {
        const docPath = path.join(newest.full, doc);
        if (fs.existsSync(docPath)) {
          const st = fs.statSync(docPath);
          if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
          if (!artifactName) {
            artifactName = doc;
            artifactPreview = fs.readFileSync(docPath, 'utf8').slice(0, 2600);
          }
        }
      }

      let model = '';
      let stepCount = 0;
      let contextTokens = 0;
      let currentFocus = '';
      let lastUserPrompt = '';
      let steps: AntigravityStepItem[] = [];
      const recentEvents: AntigravityFeedEvent[] = [];
      const chatTurns: AntigravityChatTurn[] = [];
      let lastType = '';
      let lastHadToolCalls = false;

      if (fs.existsSync(newest.logPath)) {
        const lines = readTailLines(newest.logPath);
        for (const raw of lines) {
          try {
            const entry = JSON.parse(raw) as TranscriptEntry;
            const ts = entry.created_at ? Date.parse(entry.created_at) : latestMtime;
            if (typeof entry.step_index === 'number') {
              stepCount = Math.max(stepCount, entry.step_index);
            }
            if (entry.model) model = entry.model;
            if (
              typeof entry.input_tokens === 'number' ||
              typeof entry.cache_read_tokens === 'number'
            ) {
              contextTokens = (entry.input_tokens || 0) + (entry.cache_read_tokens || 0);
            }

            if (entry.type === 'USER_INPUT' && entry.content) {
              const reqMatch = entry.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
              const rawPrompt = (reqMatch ? reqMatch[1] : entry.content).trim();
              if (rawPrompt) {
                const oneLine = rawPrompt.replace(/\s+/g, ' ');
                lastUserPrompt = oneLine.slice(0, 140);
                recentEvents.push({
                  id: `u-${entry.step_index}`,
                  kind: 'user',
                  label: 'You',
                  detail: oneLine.slice(0, 95),
                  ts,
                });
                chatTurns.push({
                  id: `turn-u-${entry.step_index}`,
                  role: 'user',
                  text: rawPrompt.slice(0, 700),
                  tools: [],
                  ts,
                });
              }
              lastType = 'USER_INPUT';
              lastHadToolCalls = false;
            } else if (entry.type === 'PLANNER_RESPONSE') {
              lastType = 'PLANNER_RESPONSE';
              const tcs = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
              lastHadToolCalls = tcs.length > 0;
              const turnTools: AntigravityToolItem[] = [];

              for (const tc of tcs) {
                const args = tc.args || tc.arguments || {};
                if (tc.name === 'update_focus' && typeof args.focus === 'string') {
                  currentFocus = args.focus.replace(/^"|"$/g, '');
                } else if (tc.name === 'update_steps' && Array.isArray(args.steps)) {
                  steps = (args.steps as Array<{ title?: string; status?: string }>)
                    .filter((s) => typeof s.title === 'string')
                    .map((s) => ({ title: String(s.title), status: String(s.status || 'pending') }));
                } else if (tc.name) {
                  const info = summarizeToolCall(tc);
                  turnTools.push({ name: tc.name, summary: info.summary, detail: info.detail });
                  recentEvents.push({
                    id: `t-${entry.step_index}-${tc.name}-${recentEvents.length}`,
                    kind: 'tool',
                    label: tc.name,
                    detail: info.summary,
                    ts,
                  });
                }
              }

              const text = (entry.content || '').trim();
              const thinking = (entry.thinking || '').trim();

              if (text || turnTools.length > 0 || thinking) {
                const prev = chatTurns[chatTurns.length - 1];
                // Merge consecutive agent tool-calling steps into one clean rich chat bubble
                if (prev && prev.role === 'agent' && !prev.text && turnTools.length > 0) {
                  prev.tools = [...prev.tools, ...turnTools].slice(-12);
                  if (thinking) prev.thinking = thinking.slice(0, 320);
                  if (text) prev.text = text.slice(0, 1800);
                  prev.ts = ts;
                } else if (prev && prev.role === 'agent' && !prev.text && text) {
                  prev.text = text.slice(0, 1800);
                  if (thinking && !prev.thinking) prev.thinking = thinking.slice(0, 320);
                  prev.ts = ts;
                } else {
                  chatTurns.push({
                    id: `turn-a-${entry.step_index}`,
                    role: 'agent',
                    text: text.slice(0, 1800),
                    thinking: thinking ? thinking.slice(0, 320) : undefined,
                    tools: turnTools.slice(0, 12),
                    model: entry.model,
                    tokens: entry.output_tokens,
                    ts,
                  });
                }
              }

              if (text && tcs.length === 0) {
                const firstLine = text.split('\n')[0].replace(/[#*`]/g, '').trim();
                recentEvents.push({
                  id: `a-${entry.step_index}`,
                  kind: 'agent',
                  label: 'Agent',
                  detail: firstLine.slice(0, 95),
                  ts,
                });
              }
            }
          } catch {
            // Skip malformed JSONL line
          }
        }
      }

      const ageMs = Date.now() - latestMtime;
      const active =
        ageMs < 15_000 || (ageMs < 45_000 && (lastType === 'USER_INPUT' || lastHadToolCalls));
      const statusLabel: 'WORKING' | 'WAITING' | 'IDLE' = active
        ? 'WORKING'
        : ageMs < 5 * 60_000
          ? 'WAITING'
          : 'IDLE';

      return {
        active,
        statusLabel,
        lastActivityTs: Math.round(latestMtime),
        conversationId: newest.name,
        model,
        stepCount,
        contextTokens,
        currentFocus,
        lastUserPrompt,
        steps,
        recentEvents: recentEvents.slice(-14).reverse(),
        chatTurns: chatTurns.slice(-16),
        artifactName,
        artifactPreview,
      };
    } catch {
      return empty;
    }
  }

  private async readGitDiffStat(): Promise<{
    diffFiles: GitDiffFile[];
    totalAdded: number;
    totalRemoved: number;
  }> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--numstat'], {
        cwd: this.getProjectDir(),
        timeout: 2000,
      });
      const diffFiles: GitDiffFile[] = [];
      let totalAdded = 0;
      let totalRemoved = 0;
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length < 3) continue;
        const added = Number(parts[0]) || 0;
        const removed = Number(parts[1]) || 0;
        const file = parts[2];
        totalAdded += added;
        totalRemoved += removed;
        diffFiles.push({ file, added, removed });
      }
      return { diffFiles: diffFiles.slice(0, 16), totalAdded, totalRemoved };
    } catch {
      return { diffFiles: [], totalAdded: 0, totalRemoved: 0 };
    }
  }

  async refresh(): Promise<AntigravityLiveState> {
    const brain = this.readLatestBrain();
    const diff = await this.readGitDiffStat();
    const next: AntigravityLiveState = { ...brain, ...diff };

    const digest = `${next.conversationId}|${next.stepCount}|${next.statusLabel}|${next.currentFocus}|${next.chatTurns.length}|${next.chatTurns[next.chatTurns.length - 1]?.text.length || 0}|${next.totalAdded}|${next.totalRemoved}`;
    this.latest = next;
    if (digest !== this.lastDigest) {
      this.lastDigest = digest;
      this.onUpdate(next);
    }
    return next;
  }

  start(intervalMs = 1200): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export async function runMacSpeedTest(): Promise<{
  downMbps: number;
  upMbps: number;
  pingMs: number;
}> {
  try {
    const { stdout } = await execFileAsync('networkQuality', ['-c'], { timeout: 25_000 });
    const parsed = JSON.parse(stdout) as {
      dl_throughput?: number;
      ul_throughput?: number;
      base_rtt?: number;
    };
    const downMbps = Number(((parsed.dl_throughput || 0) / 1_000_000).toFixed(1));
    const upMbps = Number(((parsed.ul_throughput || 0) / 1_000_000).toFixed(1));
    const pingMs = Math.round(parsed.base_rtt || 0);
    return { downMbps, upMbps, pingMs };
  } catch {
    const start = Date.now();
    const res = await fetch('https://speed.cloudflare.com/__down?bytes=5000000');
    const buf = await res.arrayBuffer();
    const sec = Math.max(0.1, (Date.now() - start) / 1000);
    const downMbps = Number(((buf.byteLength * 8) / sec / 1_000_000).toFixed(1));
    return { downMbps, upMbps: 0, pingMs: Math.round(sec * 100) };
  }
}
