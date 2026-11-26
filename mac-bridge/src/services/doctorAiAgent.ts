import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_WIN } from '../platform/win32.js';
import type { DoctorPostReport, SystemDoctorReport } from '../types/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, '../../data/doctor_ai.json');

// Flagship reasoning models first: Gemini 2.5 Pro for deep OS troubleshooting & root-cause fixes,
// with automatic graceful fallback to Gemini 2.5 Flash (thinking enabled) and 2.0 Flash.
const MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
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
  answer?: string;
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
): Promise<{ result: AiStepResponse; modelUsed: string }> {
  let lastErr = 'Gemini request failed';

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 32_000);
    try {
      const generationConfig: Record<string, unknown> = {
        temperature: 0.15,
        maxOutputTokens: 2800,
        responseMimeType: 'application/json',
      };
      // Enable real structured reasoning on 2.5 Flash (Pro reasons natively!)
      if (/gemini-2\.5-flash/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 2048 };
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
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        lastErr = data.error?.message || `HTTP ${res.status}`;
        onLine?.(`⚠ ${model}: ${lastErr.slice(0, 95)} — trying next model…`);
        if (res.status === 503 || res.status === 429 || res.status === 404 || res.status === 400) {
          continue;
        }
        throw new Error(lastErr);
      }

      const parts = data.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find((p) => !p.thought && typeof p.text === 'string' && p.text.trim());
      const raw = textPart?.text?.trim() || '';
      if (!raw) throw new Error('Empty AI response');
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      return { result: JSON.parse(cleaned) as AiStepResponse, modelUsed: model };
    } catch (err) {
      clearTimeout(timer);
      const msg =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Timed out after 32s'
            : err.message
          : String(err);
      lastErr = msg;
      onLine?.(`⚠ ${model}: ${msg.slice(0, 95)}`);
    }
  }

  throw new Error(lastErr);
}

function runShellStreaming(
  command: string,
  onLine: (line: string) => void,
  timeoutMs = 30_000,
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
      onLine(`⚠ Command timed out after ${Math.round(timeoutMs / 1000)}s (continuing)`);
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

function buildSystemInstruction(osName: string, userGoal?: string): string {
  return `You are DevDeck AI Principal Systems Engineer (powered by Gemini 2.5 Pro) — an expert ${osName} diagnostics, performance, and repair specialist who ACTUALLY FIXES real computer problems safely and explains everything in crystal-clear everyday English.

${userGoal ? `USER'S SPECIFIC REQUEST: "${userGoal}"\nPrioritize solving this exact request first, verifying the fix, and reporting concrete measured results!\n` : ''}
REAL REPAIRS & DEEP CHECKS YOU SHOULD ACTUALLY EXECUTE:
1. **Disk & Bloat**: Measure exact largest directories in ~/Library/Caches, ~/Library/Developer, ~/.cache, ~/Downloads (or Windows %LOCALAPPDATA%, Temp, Downloads). Safely clean regenerable caches (npm cache clean --force, pnpm store prune, brew cleanup -s, pip cache purge, qlmanage -r cache, old logs) and measure exact MB/GB freed!
2. **CPU, Heat & Runaway Processes**: Inspect top CPU/RAM hogs (\`ps -Arcwwwxo pid,pcpu,pmem,comm | head -15\` on Mac or \`Get-Process | Sort-Object CPU -Desc | Select -First 12\` on Windows). Safely throttle (\`renice +10\`) or terminate stuck/zombie non-system hogs if clearly hung, NEVER kill DevDeck/node bridge/Finder/System/Antigravity.
3. **Crashes & Errors**: Inspect actual latest crash reports (\`~/Library/Logs/DiagnosticReports\` on Mac or \`Get-WinEvent -LogName Application,System -MaxEvents 12 -FilterXPath '*[System[Level<=2]]'\` on Windows) so you tell the user the EXACT app/driver that crashed and WHY.
4. **Network, DNS & Services**: Check DNS resolution, stuck ports, or broken system caches, and flush/reset safely (\`dscacheutil -flushcache\`, \`ipconfig /flushdns\`).
5. **Verify Your Work**: After running a fix, verify the result so you report REAL numbers (exact MB freed, exact process fixed, exact error resolved).

STRICT SAFETY GUARDRAILS:
- NEVER delete personal Documents, Desktop, Photos, Downloads, or user source code.
- NEVER run sudo, format, diskpart, mkfs, dd, shutdown, reboot, or curl|sh.
- Keep commands concise, deterministic, and non-interactive (max 8 steps).

ALWAYS respond with ONLY valid JSON matching this schema:
When running a command:
{
  "done": false,
  "reasoning": "1-2 sentence clear English explanation of what you found and WHY you are running this command",
  "command": "exact single-line ${IS_WIN ? 'PowerShell' : 'zsh'} command",
  "summaryOfFix": "optional concrete plain-English description of what this command fixed"
}
When finished:
{
  "done": true,
  "reasoning": "Clear wrap-up sentence",
  "answer": "Direct 2-4 sentence plain-English answer to the user's request with concrete numbers",
  "whatWasFixed": ["Concrete bullet of EVERY fix completed with real MB/GB/items/errors fixed"],
  "whatWasNotFixed": ["Anything that could not be auto-fixed and WHY"],
  "whyItHappened": ["Clear root-cause explanation tailored to THIS computer"],
  "nextSteps": ["Specific actionable step naming exact apps, folders, or settings found"]
}`;
}

export async function runAutonomousAiRescue(
  initialReport: SystemDoctorReport,
  onLine: (line: string) => void,
  onStatus: (status: string) => void,
  priorFixes: string[] = [],
  priorNotFixed: string[] = [],
  userGoal?: string,
): Promise<{
  answer?: string;
  modelUsed: string;
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
  const systemInstruction = buildSystemInstruction(osName, userGoal);

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
          text: userGoal
            ? `The user asked: "${userGoal}"\nLive computer snapshot:\n${JSON.stringify(snapshot, null, 2)}\nInvestigate and fix this thoroughly right now.`
            : `Automated Stage 1 repairs have already completed. Here is the live snapshot of this computer. Now perform Stage 2 deep investigation, actually fix every remaining safe issue, verify the improvements, and produce a clear plain-English report:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
    },
  ];

  const collectedFixes: string[] = [...priorFixes];
  const collectedNotFixed: string[] = [...priorNotFixed];
  let finalResult: AiStepResponse | null = null;
  let activeModel = MODELS[0];

  const MAX_STEPS = 8;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    onStatus(`AI Step ${step}/${MAX_STEPS}: Reasoning (${activeModel})…`);
    const { result: decision, modelUsed } = await callGeminiJson(
      apiKey,
      systemInstruction,
      history,
      onLine,
    );
    if (step === 1 || modelUsed !== activeModel) {
      activeModel = modelUsed;
      onLine(`🧠 [AI ENGINE] Active Model: ${activeModel}`);
    }

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
        parts: [
          {
            text: `Safety guardrail blocked that command (${safety.reason}). Choose a safe non-destructive alternative or finish with done: true.`,
          },
        ],
      });
      continue;
    }

    onStatus(`AI Step ${step}/${MAX_STEPS}: Running repair command…`);
    onLine(`$ ${cmd}`);
    const execRes = await runShellStreaming(cmd, onLine, 28_000);
    onLine(`[exit ${execRes.code}]`);

    if (execRes.code === 0 && decision.summaryOfFix) {
      collectedFixes.push(decision.summaryOfFix);
    }

    const trimmedOut = execRes.output.trim().slice(-3200) || '(no output)';
    history.push({
      role: 'user',
      parts: [
        {
          text: `Command exited with code ${execRes.code}.\nOutput:\n${trimmedOut}\n\n${
            step === MAX_STEPS
              ? 'This was the final allowed command step. Now respond with done: true and the complete plain-English report.'
              : 'Decide the next diagnostic/fix/verification command or finish with done: true.'
          }`,
        },
      ],
    });
  }

  if (!finalResult || !finalResult.done) {
    onStatus('AI generating final plain-English rescue report…');
    const finalWrap = await callGeminiJson(apiKey, systemInstruction, history, onLine);
    finalResult = finalWrap.result;
    activeModel = finalWrap.modelUsed;
  }

  return {
    answer: finalResult.answer || finalResult.reasoning,
    modelUsed: activeModel,
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
