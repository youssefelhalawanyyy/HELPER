import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeckProfile, ProfileId } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(): Promise<string> {
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
  const lower = appName.toLowerCase();
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
    return { appName: this.lastApp || 'macOS', profileId: this.lastProfile };
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
