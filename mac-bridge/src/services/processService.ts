import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN } from '../platform/win32.js';
import type { DockerContainer, HeavyProcess } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

const DOCKER_CANDIDATES = IS_WIN
  ? ['docker', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']
  : [
      'docker',
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      path.join(os.homedir(), '.orbstack/bin/docker'),
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    ];

function resolveDockerBin(): string {
  for (const candidate of DOCKER_CANDIDATES) {
    if (candidate === 'docker') continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'docker';
}

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
  private busyProc = false;
  private busyDocker = false;
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
    if (this.busyProc) return this.latestProcesses;
    this.busyProc = true;
    try {
      if (IS_WIN) {
        const res = await si.processes();
        const list = res.list
          .filter(
            (p) =>
              p.pid > 4 &&
              p.pid !== process.pid &&
              !PROTECTED_PROCESSES.has(p.name) &&
              (p.cpu > 0.1 || p.mem > 0.3),
          )
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 12)
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
        if (list.length >= 12) break;
      }

      this.latestProcesses = list;
      this.onProcesses(list);
      return list;
    } catch {
      return this.latestProcesses;
    } finally {
      this.busyProc = false;
    }
  }

  async killProcess(
    pid: number,
    force = false,
    expectedName?: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (pid === process.pid) {
      return { ok: false, message: 'Cannot terminate DevDeck bridge itself' };
    }
    const found = this.latestProcesses.find((p) => p.pid === pid);
    if (!found || (expectedName && found.name !== expectedName)) {
      return { ok: false, message: `Process PID ${pid} is not in the active hog list` };
    }
    try {
      const live = IS_WIN
        ? (await si.processes()).list.find((p) => p.pid === pid)?.name.replace(/\.exe$/i, '')
        : path.basename((await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='])).stdout.trim());
      if (!live || live !== found.name || PROTECTED_PROCESSES.has(live))
        throw Error('Process changed. Refresh the list.');
      if (IS_WIN) {
        await execFileAsync('taskkill', ['/PID', String(pid), ...(force ? ['/F'] : [])], {
          timeout: 3000,
        });
      } else {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 300));
      await this.scanProcesses();
      return {
        ok: true,
        message: `${force ? 'Force killed' : 'Quit'} ${found.name} (PID ${pid})`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Failed to terminate ${found.name}: ${err instanceof Error ? err.message : 'denied'}`,
      };
    }
  }

  async scanDocker(): Promise<{ available: boolean; containers: DockerContainer[] }> {
    if (this.busyDocker) return { available: this.dockerAvailable, containers: this.latestContainers };
    this.busyDocker = true;
    const dockerBin = resolveDockerBin();
    try {
      const { stdout } = await execFileAsync(
        dockerBin,
        [
          'ps',
          '-a',
          '--format',
          '{{.ID}}|||{{.Names}}|||{{.Status}}|||{{.State}}|||{{.Image}}|||{{.Ports}}',
        ],
        { timeout: 2500, windowsHide: true },
      );
      const containers: DockerContainer[] = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [id, name, status, state, image, ports] = l.split('|||');
          return {
            id: id || '',
            name: name || 'container',
            status: status || '',
            state: state || 'unknown',
            image: image || '',
            ports: ports || '',
          };
        })
        .filter((c) => c.id);

      // Enrich running containers with live CPU % and Memory usage via docker stats --no-stream
      if (containers.some((c) => c.state.toLowerCase() === 'running')) {
        try {
          const { stdout: statsOut } = await execFileAsync(
            dockerBin,
            ['stats', '--no-stream', '--format', '{{.ID}}|||{{.Name}}|||{{.CPUPerc}}|||{{.MemUsage}}'],
            { timeout: 2200, windowsHide: true },
          );
          const statsMap = new Map<string, { cpuPct: string; memUsage: string }>();
          for (const row of statsOut.split('\n')) {
            const [sId, sName, cpuPct, memUsage] = row.trim().split('|||');
            if (sId) statsMap.set(sId, { cpuPct: cpuPct || '0%', memUsage: memUsage || '' });
            if (sName) statsMap.set(sName, { cpuPct: cpuPct || '0%', memUsage: memUsage || '' });
          }
          for (const c of containers) {
            const st = statsMap.get(c.id) || statsMap.get(c.name);
            if (st) {
              c.cpuPct = st.cpuPct;
              c.memUsage = st.memUsage.split('/')[0]?.trim() || st.memUsage;
            }
          }
        } catch {
          // Ignore stats timeout
        }
      }

      this.dockerAvailable = true;
      this.latestContainers = containers;
      this.onDocker(true, containers);
      return { available: true, containers };
    } catch {
      this.dockerAvailable = false;
      this.latestContainers = [];
      this.onDocker(false, []);
      return { available: false, containers: [] };
    } finally {
      this.busyDocker = false;
    }
  }

  async runDockerAction(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'remove' | 'prune' | 'launch_daemon' | 'start_all' | 'stop_all',
  ): Promise<{ ok: boolean; message: string }> {
    const dockerBin = resolveDockerBin();

    if (action === 'launch_daemon') {
      try {
        if (IS_WIN) {
          const child = spawn(
            'cmd.exe',
            ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'],
            { detached: true, stdio: 'ignore', windowsHide: true },
          );
          child.unref();
        } else {
          // Try OrbStack first if installed, otherwise Docker Desktop
          const app = fs.existsSync('/Applications/OrbStack.app') ? 'OrbStack' : 'Docker';
          await execFileAsync('open', ['-a', app], { timeout: 3000 });
        }
        setTimeout(() => void this.scanDocker(), 3500);
        return { ok: true, message: 'Launching Docker Engine daemon…' };
      } catch (err) {
        return {
          ok: false,
          message: `Could not launch Docker Desktop: ${err instanceof Error ? err.message : 'not installed'}`,
        };
      }
    }

    if (action === 'prune') {
      try {
        await execFileAsync(dockerBin, ['container', 'prune', '-f'], { timeout: 12_000 });
        await this.scanDocker();
        return { ok: true, message: 'Pruned all stopped Docker containers' };
      } catch (err) {
        return {
          ok: false,
          message: `Docker prune failed: ${err instanceof Error ? err.message : 'error'}`,
        };
      }
    }

    if (action === 'start_all' || action === 'stop_all') {
      const wantStart = action === 'start_all';
      const targets = this.latestContainers.filter((c) =>
        wantStart ? c.state.toLowerCase() !== 'running' : c.state.toLowerCase() === 'running',
      );
      if (targets.length === 0) {
        return {
          ok: true,
          message: wantStart ? 'All containers already running' : 'No running containers to stop',
        };
      }
      try {
        await execFileAsync(
          dockerBin,
          [wantStart ? 'start' : 'stop', ...targets.map((c) => c.id)],
          { timeout: 20_000 },
        );
        await this.scanDocker();
        return {
          ok: true,
          message: `${wantStart ? 'Started' : 'Stopped'} ${targets.length} container(s)`,
        };
      } catch (err) {
        return {
          ok: false,
          message: `Docker batch action failed: ${err instanceof Error ? err.message : 'error'}`,
        };
      }
    }

    const target = this.latestContainers.find((c) => c.id === id);
    if (!target) {
      return { ok: false, message: 'Container not found in current Docker list' };
    }
    try {
      const args = action === 'remove' ? ['rm', '-f', target.id] : [action, target.id];
      await execFileAsync(dockerBin, args, { timeout: 15_000 });
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
