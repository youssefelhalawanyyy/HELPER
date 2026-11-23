import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AntigravityLiveState, GitDiffFile } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export class AntigravityService {
  private timer: NodeJS.Timeout | null = null;
  private latest: AntigravityLiveState = {
    active: false,
    lastActivityTs: 0,
    conversationId: '',
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

  private readLatestBrain(): {
    active: boolean;
    lastActivityTs: number;
    conversationId: string;
    artifactName: string;
    artifactPreview: string;
  } {
    const brainRoot = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    try {
      if (!fs.existsSync(brainRoot)) {
        return { active: false, lastActivityTs: 0, conversationId: '', artifactName: '', artifactPreview: '' };
      }
      const dirs = fs
        .readdirSync(brainRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const full = path.join(brainRoot, d.name);
          const st = fs.statSync(full);
          return { name: d.name, full, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      const newest = dirs[0];
      if (!newest) {
        return { active: false, lastActivityTs: 0, conversationId: '', artifactName: '', artifactPreview: '' };
      }

      // Check most recent file inside conversation dir (including transcript/artifacts)
      let latestMtime = newest.mtime;
      let artifactName = '';
      let artifactPreview = '';

      const priorityDocs = ['implementation_plan.md', 'task.md', 'walkthrough.md'];
      for (const doc of priorityDocs) {
        const docPath = path.join(newest.full, doc);
        if (fs.existsSync(docPath)) {
          const st = fs.statSync(docPath);
          if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
          if (!artifactName) {
            artifactName = doc;
            artifactPreview = fs.readFileSync(docPath, 'utf8').slice(0, 1400);
          }
        }
      }

      const logFile = path.join(newest.full, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(logFile)) {
        const st = fs.statSync(logFile);
        if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
      }

      return {
        active: Date.now() - latestMtime < 18_000,
        lastActivityTs: Math.round(latestMtime),
        conversationId: newest.name,
        artifactName,
        artifactPreview,
      };
    } catch {
      return { active: false, lastActivityTs: 0, conversationId: '', artifactName: '', artifactPreview: '' };
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

    // Only broadcast if meaningful fields changed (or first run)
    const changed =
      next.active !== this.latest.active ||
      next.conversationId !== this.latest.conversationId ||
      next.artifactName !== this.latest.artifactName ||
      next.totalAdded !== this.latest.totalAdded ||
      next.totalRemoved !== this.latest.totalRemoved ||
      next.diffFiles.length !== this.latest.diffFiles.length ||
      this.latest.lastActivityTs === 0;

    this.latest = next;
    if (changed) {
      this.onUpdate(next);
    }
    return next;
  }

  start(intervalMs = 2500): void {
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
    // Built-in macOS networkQuality JSON speed test
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
    // Fallback quick Cloudflare 5MB download test
    const start = Date.now();
    const res = await fetch('https://speed.cloudflare.com/__down?bytes=5000000');
    const buf = await res.arrayBuffer();
    const sec = Math.max(0.1, (Date.now() - start) / 1000);
    const downMbps = Number(((buf.byteLength * 8) / sec / 1_000_000).toFixed(1));
    return { downMbps, upMbps: 0, pingMs: Math.round(sec * 100) };
  }
}
