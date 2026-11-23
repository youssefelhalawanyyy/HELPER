import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitStatus } from '../types/protocol.js';
import { runConfiguredShellCommand } from './logStreamer.js';

const execFileAsync = promisify(execFile);

export class GitService {
  private timer: NodeJS.Timeout | null = null;
  private latest: GitStatus;

  constructor(
    private getProjectDir: () => string,
    private getDeployCommand: () => string,
    private onUpdate: (status: GitStatus) => void,
  ) {
    const dir = getProjectDir();
    this.latest = {
      isGitRepo: false,
      repoName: path.basename(dir),
      path: dir,
      branch: 'detached',
      uncommitted: 0,
      ahead: 0,
      behind: 0,
      files: [],
      lastUpdated: Date.now(),
    };
  }

  getLatest(): GitStatus {
    return this.latest;
  }

  async refresh(): Promise<GitStatus> {
    const dir = this.getProjectDir();
    const repoName = path.basename(dir);
    try {
      const { stdout: branchOut } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: dir, timeout: 2500 },
      );
      const branch = branchOut.trim() || 'HEAD';

      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: dir,
        timeout: 2500,
      });
      const files = statusOut
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      let ahead = 0;
      let behind = 0;
      try {
        const { stdout: revOut } = await execFileAsync(
          'git',
          ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
          { cwd: dir, timeout: 2500 },
        );
        const [behindStr, aheadStr] = revOut.trim().split(/\s+/);
        behind = Number(behindStr) || 0;
        ahead = Number(aheadStr) || 0;
      } catch {
        // Upstream branch may not be set yet
      }

      this.latest = {
        isGitRepo: true,
        repoName,
        path: dir,
        branch,
        uncommitted: files.length,
        ahead,
        behind,
        files: files.slice(0, 20),
        lastUpdated: Date.now(),
      };
    } catch {
      this.latest = {
        isGitRepo: false,
        repoName,
        path: dir,
        branch: 'no-git',
        uncommitted: 0,
        ahead: 0,
        behind: 0,
        files: [],
        lastUpdated: Date.now(),
      };
    }

    this.onUpdate(this.latest);
    return this.latest;
  }

  async deploy(action: 'push' | 'deploy'): Promise<{ ok: boolean; message: string }> {
    const dir = this.getProjectDir();
    if (action === 'push') {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['push'], {
          cwd: dir,
          timeout: 25_000,
        });
        await this.refresh();
        return { ok: true, message: (stdout || stderr || 'git push succeeded').trim().slice(0, 200) };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message.slice(0, 200) : 'git push failed',
        };
      }
    }

    const cmd = this.getDeployCommand();
    const res = await runConfiguredShellCommand(cmd, dir);
    await this.refresh();
    return { ok: res.ok, message: res.output };
  }

  start(intervalMs = 5000): void {
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
