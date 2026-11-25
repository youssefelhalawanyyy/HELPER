import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type { DeckProfile, ProfileId } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(): Promise<string> {
  if (IS_WIN) {
    try {
      // Uses pre-compiled DevDeckWinApi inside persistent PowerShell worker (<3ms!)
      const out = await runPowerShell('[DevDeckWinApi]::GetFrontProcessName()', 1500);
      return out.trim() || 'Windows';
    } catch {
      return 'Windows';
    }
  }

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ],
      { timeout: 1200 },
    );
    return stdout.trim() || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

export function resolveProfileForApp(appName: string, profiles: DeckProfile[]): ProfileId {
  const lower =
    (
      {
        chrome: 'google chrome',
        msedge: 'google chrome',
        windowsterminal: 'terminal',
        pwsh: 'terminal',
        powershell: 'terminal',
        cmd: 'terminal',
      } as Record<string, string>
    )[appName.toLowerCase()] || appName.toLowerCase();
  for (const profile of profiles) {
    if (profile.id === 'general') continue;
    for (const candidate of profile.matchApps) {
      if (lower === candidate.toLowerCase() || lower.includes(candidate.toLowerCase())) {
        return profile.id;
      }
    }
  }
  return 'general';
}

export class ActiveAppPoller {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastApp = '';
  private lastProfile: ProfileId = 'general';

  constructor(
    private getProfiles: () => DeckProfile[],
    private onChange: (appName: string, profileId: ProfileId) => void,
  ) {}

  getCurrent(): { appName: string; profileId: ProfileId } {
    return {
      appName: this.lastApp || (IS_WIN ? 'Windows' : 'macOS'),
      profileId: this.lastProfile,
    };
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    const poll = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const appName = await getFrontmostAppName();
        const profileId = resolveProfileForApp(appName, this.getProfiles());
        if (appName !== this.lastApp || profileId !== this.lastProfile) {
          this.lastApp = appName;
          this.lastProfile = profileId;
          this.onChange(appName, profileId);
        }
      } finally {
        this.busy = false;
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
