import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type { DeckProfile, ProfileId } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(): Promise<string> {
  if (IS_WIN) {
    try {
      const out = await runPowerShell(
        `Add-Type 'using System; using System.Runtime.InteropServices; public class Fg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $h=[Fg]::GetForegroundWindow(); $foregroundPid=0; [Fg]::GetWindowThreadProcessId($h, [ref]$foregroundPid) | Out-Null; (Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue).ProcessName`,
        1800,
      );
      return out.trim() || 'Windows';
    } catch {
      return 'Windows';
    }
  }

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
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
  private lastApp = '';
  private lastProfile: ProfileId = 'general';

  constructor(
    private getProfiles: () => DeckProfile[],
    private onChange: (appName: string, profileId: ProfileId) => void,
  ) {}

  getCurrent(): { appName: string; profileId: ProfileId } {
    return { appName: this.lastApp || (IS_WIN ? 'Windows' : 'macOS'), profileId: this.lastProfile };
  }

  start(intervalMs = 1500): void {
    if (this.timer) return;
    const poll = async () => {
      const appName = await getFrontmostAppName();
      const profileId = resolveProfileForApp(appName, this.getProfiles());
      if (appName !== this.lastApp || profileId !== this.lastProfile) {
        this.lastApp = appName;
        this.lastProfile = profileId;
        this.onChange(appName, profileId);
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
