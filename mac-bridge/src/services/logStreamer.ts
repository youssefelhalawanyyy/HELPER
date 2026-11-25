import crypto from 'node:crypto';
import { type ChildProcess, spawn } from 'node:child_process';
import { killChildProcessTree } from '../platform/cloudflared.js';
import { IS_WIN } from '../platform/win32.js';
import type { LogLine, LogPreset, LogStatus } from '../types/protocol.js';

const ERROR_REGEX = /\b(error|failed|exception|fatal|crash|unhandled|enoent|eaddrinuse|ts\d{4})\b/i;
const SUCCESS_REGEX = /\b(success|compiled successfully|ready in|built in|passed|listening on|0 errors)\b/i;
const WARN_REGEX = /\b(warn|warning|deprecated)\b/i;

function classifyLine(text: string, stream: 'stdout' | 'stderr'): LogLine['level'] {
  if (ERROR_REGEX.test(text)) return 'error';
  if (SUCCESS_REGEX.test(text)) return 'success';
  if (stream === 'stderr' || WARN_REGEX.test(text)) return 'warn';
  return 'info';
}

export class LogStreamer {
  private child: ChildProcess | null = null;
  private status: LogStatus = {
    running: false,
    presetId: null,
    command: null,
    pid: null,
    exitCode: null,
  };
  private recentLines: LogLine[] = [];
  private readonly maxBuffer = 350;

  constructor(
    private onLine: (line: LogLine) => void,
    private onStatus: (status: LogStatus) => void,
    private onAlert: (kind: 'success' | 'error' | 'warning', message: string) => void,
  ) {}

  getStatus(): LogStatus {
    return this.status;
  }

  getRecentLines(): LogLine[] {
    return this.recentLines;
  }

  private emitLine(stream: 'stdout' | 'stderr', rawText: string): void {
    const clean = rawText.replace(/\r$/, '');
    if (!clean.trim()) return;
    const level = classifyLine(clean, stream);
    const line: LogLine = {
      id: crypto.randomUUID(),
      stream,
      text: clean.slice(0, 1000),
      level,
      ts: Date.now(),
    };
    this.recentLines = [...this.recentLines, line].slice(-this.maxBuffer);
    this.onLine(line);

    if (level === 'error') {
      this.onAlert('error', clean.slice(0, 90));
    } else if (level === 'success') {
      this.onAlert('success', clean.slice(0, 90));
    }
  }

  startShellStream(shellCommand: string, label: string, cwd: string): void {
    this.stop();
    const trimmed = shellCommand.trim();
    if (!trimmed) return;
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', trimmed], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '0' },
        })
      : spawn('/bin/zsh', ['-lc', trimmed], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}`,
            FORCE_COLOR: '0',
          },
        });

    this.attachChild(child, 'custom', label || trimmed, trimmed, cwd);
  }

  startPreset(preset: LogPreset, cwd: string): void {
    this.stop();
    const cmdLabel = `${preset.command} ${preset.args.join(' ')}`.trim();
    const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const child = IS_WIN
      ? spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `& ${psQuote(preset.command)} ${preset.args.map(psQuote).join(' ')}`,
          ],
          {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, FORCE_COLOR: '0' },
          },
        )
      : spawn(preset.command, preset.args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}`,
            FORCE_COLOR: '0',
          },
        });

    this.attachChild(child, preset.id, preset.label, cmdLabel, cwd);
  }

  private attachChild(
    child: ChildProcess,
    presetId: string,
    label: string,
    cmdLabel: string,
    cwd: string,
  ): void {
    this.child = child;
    this.status = {
      running: true,
      presetId,
      command: cmdLabel,
      pid: child.pid ?? null,
      exitCode: null,
    };
    this.onStatus(this.status);
    this.emitLine('stdout', `[devdeck] started "${label}" (${cmdLabel}) in ${cwd}`);

    let outBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      outBuf += chunk.toString('utf8');
      const lines = outBuf.split('\n');
      outBuf = lines.pop() ?? '';
      for (const line of lines) this.emitLine('stdout', line);
    });

    let errBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      errBuf += chunk.toString('utf8');
      const lines = errBuf.split('\n');
      errBuf = lines.pop() ?? '';
      for (const line of lines) this.emitLine('stderr', line);
    });

    child.on('close', (code) => {
      if (outBuf) this.emitLine('stdout', outBuf);
      if (errBuf) this.emitLine('stderr', errBuf);
      this.child = null;
      this.status = {
        running: false,
        presetId,
        command: cmdLabel,
        pid: null,
        exitCode: code,
      };
      this.onStatus(this.status);
      if (code === 0) {
        this.emitLine('stdout', `[devdeck] exited cleanly (code 0)`);
        this.onAlert('success', `${label} finished (0)`);
      } else {
        this.emitLine('stderr', `[devdeck] exited with code ${code ?? 'stopped'}`);
      }
    });

    child.on('error', (err) => {
      this.emitLine('stderr', `[devdeck] spawn error: ${err.message}`);
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      killChildProcessTree(this.child);
      this.child = null;
    }
  }
}

/**
 * Runs a whitelisted macro shell command (configured locally in config.json) safely
 * using the user's shell in projectDir with a strict timeout.
 */
export function runConfiguredShellCommand(
  command: string,
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' },
        })
      : spawn('/bin/zsh', ['-lc', command], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' },
        });

    let combined = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, output: 'Command timed out after 30s' });
    }, 30_000);

    child.stdout?.on('data', (d: Buffer) => {
      combined += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      combined += d.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const summary = combined.trim().slice(-400) || (code === 0 ? 'Completed' : `Exit code ${code}`);
      resolve({ ok: code === 0, output: summary });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
  });
}
