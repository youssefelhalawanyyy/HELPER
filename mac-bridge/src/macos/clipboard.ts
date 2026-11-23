import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, runPowerShell, sendWinKeystroke } from '../platform/win32.js';
import type { ClipboardItem } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export function expandSnippetTokens(raw: string): string {
  return raw
    .replace(/\{\{uuid\}\}/gi, () => crypto.randomUUID())
    .replace(/\{\{email\}\}/gi, () => `dev+${crypto.randomBytes(3).toString('hex')}@example.com`)
    .replace(/\{\{iso\}\}/gi, () => new Date().toISOString());
}

export function copyToMacClipboard(text: string): Promise<void> {
  if (IS_WIN) {
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    return runPowerShell(
      `$bytes = [Convert]::FromBase64String('${b64}'); Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString($bytes))`,
      2500,
    ).then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `pbcopy exited with code ${code}`));
    });
    child.stdin.end(text, 'utf8');
  });
}

export async function readMacClipboard(): Promise<string> {
  if (IS_WIN) {
    try {
      const out = await runPowerShell('Get-Clipboard -Raw -Format Text -ErrorAction SilentlyContinue', 1500);
      return out.replace(/\r\n/g, '\n');
    } catch {
      return '';
    }
  }

  try {
    const { stdout } = await execFileAsync('pbpaste', [], { timeout: 1000, maxBuffer: 512 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

export async function triggerMacPaste(): Promise<void> {
  if (IS_WIN) {
    await sendWinKeystroke('^v');
    return;
  }
  await execFileAsync(
    'osascript',
    ['-e', 'tell application "System Events" to keystroke "v" using {command down}'],
    { timeout: 1500 },
  );
}

export class ClipboardTracker {
  private timer: NodeJS.Timeout | null = null;
  private current = '';
  private history: ClipboardItem[] = [];
  private readonly maxItems = 25;

  constructor(private onUpdate: (current: string, history: ClipboardItem[]) => void) {}

  getState(): { current: string; history: ClipboardItem[] } {
    return { current: this.current, history: this.history };
  }

  record(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.current = text;
    this.history = [
      { id: crypto.randomUUID(), text: text.slice(0, 2000), ts: Date.now() },
      ...this.history.filter((item) => item.text !== text.slice(0, 2000)),
    ].slice(0, this.maxItems);
    this.onUpdate(this.current, this.history);
  }

  start(intervalMs = 1500): void {
    if (this.timer) return;
    const poll = async () => {
      const value = await readMacClipboard();
      if (value && value !== this.current) {
        this.record(value);
      }
    };
    void poll();
    this.timer = setInterval(() => void poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
