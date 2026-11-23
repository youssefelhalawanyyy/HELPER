import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MediaState } from '../types/protocol.js';
import { getMacVolumeState, getTrackedBrightness } from './hardware.js';

const execFileAsync = promisify(execFile);

async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', `tell application "System Events" to (name of processes) contains "${appName}"`],
      { timeout: 1200 },
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getMediaState(): Promise<MediaState> {
  const { volume, muted } = await getMacVolumeState();
  const brightness = getTrackedBrightness();

  for (const player of ['Spotify', 'Music'] as const) {
    if (await isAppRunning(player)) {
      try {
        const script = `
          tell application "${player}"
            set st to player state as string
            if st is "playing" or st is "paused" then
              set tr to name of current track
              set ar to artist of current track
              return st & "|||" & tr & "|||" & ar
            else
              return "stopped|||No Track|||${player}"
            end if
          end tell
        `;
        const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1500 });
        const [st, track, artist] = stdout.trim().split('|||');
        return {
          volume,
          muted,
          brightness,
          playing: st === 'playing',
          track: track || 'No Track',
          artist: artist || player,
          player,
        };
      } catch {
        // Continue to next player
      }
    }
  }

  return {
    volume,
    muted,
    brightness,
    playing: false,
    track: 'No Media Active',
    artist: 'Spotify / Apple Music',
    player: 'System',
  };
}

export async function controlMacMedia(action: 'playpause' | 'next' | 'prev'): Promise<string> {
  const cmd =
    action === 'playpause'
      ? 'playpause'
      : action === 'next'
        ? 'next track'
        : 'previous track';

  for (const player of ['Spotify', 'Music'] as const) {
    if (await isAppRunning(player)) {
      await execFileAsync('osascript', ['-e', `tell application "${player}" to ${cmd}`], {
        timeout: 1500,
      });
      return `${player}: ${action}`;
    }
  }

  return 'No active media player (open Spotify or Music)';
}
