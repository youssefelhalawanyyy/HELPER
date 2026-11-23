import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_WIN } from '../platform/win32.js';
import type { DoctorPostReport, SystemDoctorReport } from '../types/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, '../../data/doctor_ai.json');

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

const BLOCKED_CMD_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|~|\$HOME|\/Users|\/System|\/Applications|C:\\)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdiskpart\b/i,
  /\bformat\s+[a-z]:/i,
  /\bbcdedit\b/i,
  /\b(shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*(C:\\|C:\\Windows|C:\\Users\\[^\\]+$)/i,
  /\bdel\s+\/[sfq]/i,
  /\brd\s+\/s/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression)/i,
  /\bsudo\b/i,
];

export function loadDoctorAiKey(): string {
  if (process.env.DEVDECK_DOCTOR_AI_KEY?.trim()) {
    return process.env.DEVDECK_DOCTOR_AI_KEY.trim();
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')) as { apiKey?: string };
      return (parsed.apiKey || '').trim();
    }
  } catch {
    // Ignore
  }
  return '';
}

export function saveDoctorAiKey(apiKey: string): boolean {
  const clean = apiKey.trim();
  if (clean.length < 12) return false;
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ apiKey: clean }, null, 2), { mode: 0o600 });
  return true;
}

export function isCommandSafe(cmd: string): { ok: boolean; reason?: string } {
  const trimmed = cmd.trim();
  if (!trimmed) return { ok: false, reason: 'Empty command' };
  for (const rx of BLOCKED_CMD_PATTERNS) {
    if (rx.test(trimmed)) {
      return { ok: false, reason: 'Blocked potentially destructive system command' };
    }
  }
  return { ok: true };
}

interface AiStepResponse {
  done: boolean;
  reasoning: string;
  command?: string;
  summaryOfFix?: string;
  whatWasFixed?: string[];
  whatWasNotFixed?: string[];
  whyItHappened?: string[];
  nextSteps?: string[];
}

interface GeminiTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

async function callGeminiJson(
  apiKey: string,
  systemInstruction: string,
  history: GeminiTurn[],
  onLine?: (line: string) => void,
): Promise<AiStepResponse> {
  let lastErr = 'Gemini request failed';

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18_000);
    try {
      const generationConfig: Record<string, unknown> = {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      };
      // Disable slow extended thinking on Flash models so each repair step replies in ~1-2s
      if (/gemini-3|2\.5-flash/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: history,
          generationConfig,
        }),
      });
      clearTimeout(timer);

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        lastErr = data.error?.message || `HTTP ${res.status}`;
        onLine?.(`⚠ ${model}: ${lastErr.slice(0, 90)} — trying fallback…`);
        if (res.status === 503 || res.status === 429 || res.status === 404 || res.status === 400) {
          continue;
        }
        throw new Error(lastErr);
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (!raw) throw new Error('Empty AI response');
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned) as AiStepResponse;
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'Timed out after 18s' : err.message) : String(err);
      lastErr = msg;
      onLine?.(`⚠ ${model}: ${msg.slice(0, 90)}`);
    }
  }

  throw new Error(lastErr);
}

function runShellStreaming(
  command: string,
  onLine: (line: string) => void,
  timeoutMs = 45_000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn('/bin/zsh', ['-lc', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

    let out = '';
    let buf = '';
    const flush = (chunk: Buffer) => {
      const txt = chunk.toString('utf8');
      out += txt;
      buf += txt;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (l.trim()) onLine(l);
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      onLine('⚠ Command timed out after 15s (continuing)');
      resolve({ code: -1, output: out });
    }, timeoutMs);

    child.stdout?.on('data', flush);
    child.stderr?.on('data', flush);
    child.on('error', (err) => {
      clearTimeout(timer);
      onLine(`ERROR: ${err.message}`);
      resolve({ code: 1, output: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf);
      resolve({ code: code ?? 0, output: out });
    });
  });
}

export async function runAutonomousAiRescue(
  initialReport: SystemDoctorReport,
  onLine: (line: string) => void,
  onStatus: (status: string) => void,
  priorFixes: string[] = [],
  priorNotFixed: string[] = [],
): Promise<{
  whatWasFixed: string[];
  whatWasNotFixed: string[];
  whyItHappened: string[];
  nextSteps: string[];
}> {
  const apiKey = loadDoctorAiKey();
  if (!apiKey) {
    throw new Error('No AI Repair Key configured. Tap SET KEY to add your Gemini API key.');
  }

  const osName = IS_WIN ? 'Windows 10/11 (PowerShell)' : 'macOS (zsh)';
  const systemInstruction = `You are DevDeck AI Systems Engineer — a senior ${osName} diagnostics and repair specialist talking to a user in SIMPLE, CLEAR, EASY-TO-UNDERSTAND EVERYDAY ENGLISH (avoid confusing jargon!).
Your ONLY purpose is to investigate every remaining problem on this computer, ACTUALLY FIX everything safe (clear safe dev/app caches like npm/pip/brew/yarn/Xcode DerivedData/temp logs, find exact huge files or folders starving the drive, identify exact crashing apps and heavy browser/background hogs), and write a super clear, detailed plain-English final report.

STRICT SAFETY RULES:
- NEVER delete personal documents, photos, Desktop, Downloads, or user source code.
- NEVER use sudo, format, diskpart, mkfs, dd, shutdown, reboot, or curl|sh.
- Safe repairs & deep checks you SHOULD run when relevant:
  - If free disk space is low (< 20 GB): find the exact top 5 largest folders/files in ~/Downloads, ~/Library/Caches, ~/Library/Developer, ~/.cache (or Windows %LOCALAPPDATA% / Downloads), AND safely clean regenerable caches (npm cache clean --force, brew cleanup -s, pip cache purge, old logs) so free disk space ACTUALLY increases!
  - If browser bloat or high RAM: list the exact top 5 RAM-eating apps in MB/GB so the user knows which exact app to close.
  - If crashes exist: inspect the latest crash file name/reason so you can tell the user in plain English WHICH app crashed and WHY.
- You have up to 8 command steps. Focus on making REAL, MEASURABLE improvements, then return done: true with a complete, unified, easy-to-read English report merging Stage 1 (priorFixes) and your Stage 2 work.

ALWAYS respond with ONLY valid JSON matching this exact schema:
When running a command:
{
  "done": false,
  "reasoning": "1-2 sentence simple English explanation of WHY you are running this command",
  "command": "exact single-line ${IS_WIN ? 'PowerShell' : 'zsh'} command",
  "summaryOfFix": "optional short plain-English description of what this command fixed"
}
When finished:
{
  "done": true,
  "reasoning": "Friendly wrap-up sentence",
  "whatWasFixed": ["Simple, clear English bullet of EVERY fix actually completed (Stage 1 + Stage 2) with exact MB/GB freed or items repaired"],
  "whatWasNotFixed": ["Clear English bullet of anything that could NOT be auto-fixed and WHY (e.g. personal files in Downloads, or needing a reboot)"],
  "whyItHappened": ["Easy-to-understand English explanation of the exact root causes making THIS computer slow or unstable"],
  "nextSteps": ["Specific, easy numbered step telling the user exactly what to do (naming exact files, folders, or apps you found!)"]
}`;

  const snapshot = {
    os: osName,
    healthScore: initialReport.score,
    grade: initialReport.grade,
    metrics: initialReport.metrics,
    priorFixesAlreadyCompleted: priorFixes,
    priorItemsNeedingAttention: priorNotFixed,
    issues: initialReport.issues.map((i) => ({
      severity: i.severity,
      title: i.title,
      detail: i.plainEnglish,
    })),
  };

  const history: GeminiTurn[] = [
    {
      role: 'user',
      parts: [
        {
          text: `Automated Stage 1 repairs have already completed. Here is the live snapshot of this computer. Now perform Stage 2 deep investigation & safe repairs for all remaining issues:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
    },
  ];

  const collectedFixes: string[] = [...priorFixes];
  const collectedNotFixed: string[] = [...priorNotFixed];
  let finalResult: AiStepResponse | null = null;

  const MAX_STEPS = 5;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    onStatus(`AI Step ${step}/${MAX_STEPS}: Analyzing system…`);
    const decision = await callGeminiJson(apiKey, systemInstruction, history, onLine);

    history.push({ role: 'model', parts: [{ text: JSON.stringify(decision) }] });

    if (decision.reasoning) {
      onLine(`[AI THOUGHT ${step}/${MAX_STEPS}] ${decision.reasoning}`);
    }

    if (decision.done || !decision.command) {
      finalResult = decision;
      break;
    }

    const cmd = decision.command.trim();
    const safety = isCommandSafe(cmd);
    if (!safety.ok) {
      onLine(`🛑 [SAFETY GUARD] Blocked command: ${cmd} (${safety.reason})`);
      collectedNotFixed.push(`Skipped unsafe command: ${cmd}`);
      history.push({
        role: 'user',
        parts: [{ text: `Safety guardrail blocked that command (${safety.reason}). Choose a safe non-destructive alternative or finish with done: true.` }],
      });
      continue;
    }

    onStatus(`AI Step ${step}/${MAX_STEPS}: Running repair command…`);
    onLine(`$ ${cmd}`);
    const execRes = await runShellStreaming(cmd, onLine, 15_000);
    onLine(`[exit ${execRes.code}]`);

    if (execRes.code === 0 && decision.summaryOfFix) {
      collectedFixes.push(decision.summaryOfFix);
    }

    const trimmedOut = execRes.output.trim().slice(-2400) || '(no output)';
    history.push({
      role: 'user',
      parts: [
        {
          text: `Command exited with code ${execRes.code}.\nOutput:\n${trimmedOut}\n\n${
            step === MAX_STEPS
              ? 'This was the final allowed command step. Now respond with done: true and the complete plain-English report.'
              : 'Decide the next diagnostic/fix command or finish with done: true.'
          }`,
        },
      ],
    });
  }

  // If AI didn't return done: true on the last loop, request the final summary cleanly
  if (!finalResult || !finalResult.done) {
    onStatus('AI generating plain-English rescue report…');
    finalResult = await callGeminiJson(apiKey, systemInstruction, history, onLine);
  }

  return {
    whatWasFixed:
      finalResult.whatWasFixed?.length
        ? finalResult.whatWasFixed
        : collectedFixes.length
          ? collectedFixes
          : ['Completed AI system inspection and safe maintenance checks.'],
    whatWasNotFixed: finalResult.whatWasNotFixed?.length ? finalResult.whatWasNotFixed : collectedNotFixed,
    whyItHappened:
      finalResult.whyItHappened?.length
        ? finalResult.whyItHappened
        : ['See the live terminal output for detailed bottlenecks found during this scan.'],
    nextSteps:
      finalResult.nextSteps?.length
        ? finalResult.nextSteps
        : ['Review the findings above and restart your computer if uptime is high.'],
  };
}

export type AiRescueSummary = Pick<
  DoctorPostReport,
  'whatWasFixed' | 'whatWasNotFixed' | 'whyItHappened' | 'nextSteps'
>;
