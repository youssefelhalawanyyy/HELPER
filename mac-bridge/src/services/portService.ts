import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActivePort } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

const EXTRA_DEV_PORTS = new Set([80, 443, 1433, 27017, 5432, 6379, 9229]);

function isLikelyDevPort(port: number): boolean {
  return (port >= 3000 && port <= 9999) || EXTRA_DEV_PORTS.has(port);
}

export class PortService {
  private timer: NodeJS.Timeout | null = null;
  private latestPorts: ActivePort[] = [];

  constructor(private onUpdate: (ports: ActivePort[]) => void) {}

  getLatest(): ActivePort[] {
    return this.latestPorts;
  }

  async scan(): Promise<ActivePort[]> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P'], {
        timeout: 2500,
        maxBuffer: 1024 * 1024,
      });

      const seen = new Map<string, ActivePort>();
      const lines = stdout.split('\n').slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const processName = parts[0];
        const pid = Number(parts[1]);
        const nameCol = parts[8];
        const portMatch = nameCol.match(/:(\d+)$/);
        if (!portMatch || !Number.isFinite(pid)) continue;
        const port = Number(portMatch[1]);
        if (!isLikelyDevPort(port)) continue;

        const key = `${port}:${pid}`;
        if (!seen.has(key)) {
          seen.set(key, {
            port,
            pid,
            process: processName,
            address: nameCol,
          });
        }
      }

      this.latestPorts = Array.from(seen.values()).sort((a, b) => a.port - b.port);
      this.onUpdate(this.latestPorts);
      return this.latestPorts;
    } catch {
      return this.latestPorts;
    }
  }

  async killPort(pid: number, port: number): Promise<{ ok: boolean; message: string }> {
    if (pid === process.pid) {
      return { ok: false, message: 'Cannot kill DevDeck bridge itself' };
    }
    const target = this.latestPorts.find((p) => p.pid === pid && p.port === port);
    if (!target) {
      return { ok: false, message: `Port ${port} (PID ${pid}) is no longer active` };
    }

    try {
      process.kill(pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 350));
      await this.scan();
      return { ok: true, message: `Terminated ${target.process} on :${port} (PID ${pid})` };
    } catch (err) {
      return {
        ok: false,
        message: `Failed to kill PID ${pid}: ${err instanceof Error ? err.message : 'Permission denied'}`,
      };
    }
  }

  start(intervalMs = 3500): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => void this.scan(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
