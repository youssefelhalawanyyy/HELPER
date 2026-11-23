import crypto from 'node:crypto';
import { type ChildProcess, spawn } from 'node:child_process';
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
  private readonly maxBuffer = 200;

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

  startPreset(preset: LogPreset, cwd: string): void {
    this.stop();
    const cmdLabel = `${preset.command} ${preset.args.join(' ')}`.trim();
    const child = spawn(preset.command, preset.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    this.child = child;
    this.status = {
      running: true,
      presetId: preset.id,
      command: cmdLabel,
      pid: child.pid ?? null,
      exitCode: null,
    };
    this.onStatus(this.status);
    this.emitLine('stdout', `[devdeck] started "${preset.label}" (${cmdLabel}) in ${cwd}`);

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
        presetId: preset.id,
        command: cmdLabel,
        pid: null,
        exitCode: code,
      };
      this.onStatus(this.status);
      if (code === 0) {
        this.emitLine('stdout', `[devdeck] exited cleanly (code 0)`);
        this.onAlert('success', `${preset.label} finished (0)`);
      } else {
        this.emitLine('stderr', `[devdeck] exited with code ${code ?? 'killed'}`);
        this.onAlert('error', `${preset.label} failed (code ${code ?? 'killed'})`);
      }
    });

    child.on('error', (err) => {
      this.emitLine('stderr', `[devdeck] spawn error: ${err.message}`);
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
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
    const child = spawn('/bin/zsh', ['-lc', command], {
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
