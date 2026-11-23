import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN } from '../platform/win32.js';
import type { DockerContainer, HeavyProcess } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

const PROTECTED_PROCESSES = new Set([
  // macOS
  'kernel_task',
  'launchd',
  'WindowServer',
  'loginwindow',
  'Finder',
  'Dock',
  'SystemUIServer',
  'mds',
  'mds_stores',
  // Windows
  'System',
  'Idle',
  'System Idle Process',
  'explorer.exe',
  'dwm.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
]);

export class ProcessAndDockerService {
  private timer: NodeJS.Timeout | null = null;
  private latestProcesses: HeavyProcess[] = [];
  private dockerAvailable = false;
  private latestContainers: DockerContainer[] = [];

  constructor(
    private onProcesses: (processes: HeavyProcess[]) => void,
    private onDocker: (available: boolean, containers: DockerContainer[]) => void,
  ) {}

  getLatestProcesses(): HeavyProcess[] {
    return this.latestProcesses;
  }

  getLatestDocker(): { available: boolean; containers: DockerContainer[] } {
    return { available: this.dockerAvailable, containers: this.latestContainers };
  }

  async scanProcesses(): Promise<HeavyProcess[]> {
    try {
      if (IS_WIN) {
        const res = await si.processes();
        const list = res.list
          .filter(
            (p) =>
              p.pid > 4 &&
              p.pid !== process.pid &&
              !PROTECTED_PROCESSES.has(p.name) &&
              (p.cpu > 0.1 || p.mem > 0.5),
          )
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 6)
          .map((p) => ({
            pid: p.pid,
            name: p.name.replace(/\.exe$/i, ''),
            cpuPct: Number((p.cpu || 0).toFixed(1)),
            memPct: Number((p.mem || 0).toFixed(1)),
          }));
        this.latestProcesses = list;
        this.onProcesses(list);
        return list;
      }

      const { stdout } = await execFileAsync('ps', ['-Ao', 'pid,pcpu,pmem,comm', '-r'], {
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      });

      const list: HeavyProcess[] = [];
      for (const rawLine of stdout.split('\n').slice(1)) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
        if (!match) continue;
        const pid = Number(match[1]);
        const cpuPct = Number(match[2]);
        const memPct = Number(match[3]);
        const name = path.basename(match[4].trim());
        if (!Number.isFinite(pid) || pid === process.pid || PROTECTED_PROCESSES.has(name)) {
          continue;
        }
        list.push({
          pid,
          name,
          cpuPct: Number(cpuPct.toFixed(1)),
          memPct: Number(memPct.toFixed(1)),
        });
        if (list.length >= 6) break;
      }

      this.latestProcesses = list;
      this.onProcesses(list);
      return list;
    } catch {
      return this.latestProcesses;
    }
  }

  async killProcess(pid: number): Promise<{ ok: boolean; message: string }> {
    if (pid === process.pid) {
      return { ok: false, message: 'Cannot terminate DevDeck bridge itself' };
    }
    const found = this.latestProcesses.find((p) => p.pid === pid);
    if (!found) {
      return { ok: false, message: `Process PID ${pid} is not in the active hog list` };
    }
    try {
      if (IS_WIN) {
        await execFileAsync('taskkill', ['/PID', String(pid), '/F'], { timeout: 3000 });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 300));
      await this.scanProcesses();
      return { ok: true, message: `Killed ${found.name} (PID ${pid})` };
    } catch (err) {
      return {
        ok: false,
        message: `Failed to kill ${found.name}: ${err instanceof Error ? err.message : 'denied'}`,
      };
    }
  }

  async scanDocker(): Promise<{ available: boolean; containers: DockerContainer[] }> {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['ps', '-a', '--format', '{{.ID}}|||{{.Names}}|||{{.Status}}|||{{.State}}'],
        { timeout: 2500 },
      );
      const containers: DockerContainer[] = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [id, name, status, state] = l.split('|||');
          return {
            id: id || '',
            name: name || 'container',
            status: status || '',
            state: state || 'unknown',
          };
        })
        .filter((c) => c.id);

      this.dockerAvailable = true;
      this.latestContainers = containers;
      this.onDocker(true, containers);
      return { available: true, containers };
    } catch {
      this.dockerAvailable = false;
      this.latestContainers = [];
      this.onDocker(false, []);
      return { available: false, containers: [] };
    }
  }

  async runDockerAction(
    id: string,
    action: 'start' | 'stop' | 'restart',
  ): Promise<{ ok: boolean; message: string }> {
    const target = this.latestContainers.find((c) => c.id === id);
    if (!target) {
      return { ok: false, message: 'Container not found in current Docker list' };
    }
    try {
      await execFileAsync('docker', [action, target.id], { timeout: 15_000 });
      await this.scanDocker();
      return { ok: true, message: `Docker ${action}: ${target.name}` };
    } catch (err) {
      return {
        ok: false,
        message: `Docker ${action} failed: ${err instanceof Error ? err.message : 'error'}`,
      };
    }
  }

  start(intervalMs = 4500): void {
    if (this.timer) return;
    void this.scanProcesses();
    void this.scanDocker();
    this.timer = setInterval(() => {
      void this.scanProcesses();
      void this.scanDocker();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
