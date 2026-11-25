import { windowsMedia } from '../platform/windowsMedia.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, sendWinVirtualKey } from '../platform/win32.js';
import type { MediaState } from '../types/protocol.js';
import { getMacBrightness, getMacVolumeState } from './hardware.js';

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

let selectedPlayer: 'Music' | 'Spotify' = 'Spotify';
let cachedArt = { key: '', url: '' };
async function musicArt(key: string) {
  if (cachedArt.key === key) return cachedArt.url;
  let url = '';
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-s', 's', '-e', 'tell application "Music" to get raw data of artwork 1 of current track'],
      { timeout: 1500, maxBuffer: 900000 },
    );
    const hex = stdout.match(/(FFD8FF[0-9A-F]+|89504E470D0A1A0A[0-9A-F]+)/i)?.[1];
    if (hex)
      url =
        'data:image/' +
        (hex.startsWith('89') ? 'png' : 'jpeg') +
        ';base64,' +
        Buffer.from(hex, 'hex').toString('base64');
  } catch {}
  cachedArt = { key, url };
  return url;
}
export async function getMediaState(): Promise<MediaState> {
  const [{ volume, muted }, brightness] = await Promise.all([
    getMacVolumeState(),
    getMacBrightness(),
  ]);

  if (IS_WIN) {
    return {
      volume,
      muted,
      brightness,
      playing: false,
      track: 'Windows Media Controls',
      artist: 'Spotify / Browser / Anghami',
      player: 'Windows',
      ...(await windowsMedia()),
    };
  }

  let paused: MediaState | undefined;
  for (const player of ['Spotify', 'Music'] as const) {
    if (await isAppRunning(player)) {
      try {
        const script = `
          tell application "${player}"
            set st to player state as string
            if st is "playing" or st is "paused" then
              set tr to name of current track
              set ar to artist of current track
              set pos to (player position as integer)
              set dur to (duration of current track as integer)
              set art to ""
              ${player === 'Spotify' ? 'try\nset art to artwork url of current track\nend try' : ''}
              return st & "|||" & tr & "|||" & ar & "|||" & pos & "|||" & dur & "|||" & art
            else
              return "stopped|||No Track|||${player}"
            end if
          end tell
        `;
        const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1500 });
        const [st, track, artist, position, duration, artwork] = stdout.trim().split('|||');
        if (st === 'stopped') continue;
        const state: MediaState = {
          positionSec: Number(position) || 0,
          durationSec: (Number(duration) || 0) / (player === 'Spotify' ? 1000 : 1),
          artworkUrl:
            player === 'Music'
              ? await musicArt(track + '|' + artist + '|' + duration)
              : artwork?.startsWith('https://')
                ? artwork
                : undefined,
          volume,
          muted,
          brightness,
          playing: st === 'playing',
          track: track || 'No Track',
          artist: artist || player,
          player,
        };
        if (state.playing) {
          selectedPlayer = player;
          return state;
        }
        paused ??= state;
      } catch {
        // Continue to next player
      }
    }
  }

  if (paused) {
    selectedPlayer = paused.player as 'Spotify' | 'Music';
    return paused;
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
  if (IS_WIN) {
    // Universal Windows media keys work with Spotify, Chrome, Edge, Anghami, Apple Music, etc.
    const vk = action === 'playpause' ? '0xB3' : action === 'next' ? '0xB0' : '0xB1';
    await sendWinVirtualKey(vk);
    return `Windows Media: ${action}`;
  }

  const cmd =
    action === 'playpause'
      ? 'playpause'
      : action === 'next'
        ? 'next track'
        : 'previous track';

  for (const player of [selectedPlayer, selectedPlayer === 'Music' ? 'Spotify' : 'Music']) {
    if (await isAppRunning(player)) {
      await execFileAsync('osascript', ['-e', `tell application "${player}" to ${cmd}`], {
        timeout: 1500,
      });
      return `${player}: ${action}`;
    }
  }

  return 'No active media player (open Spotify or Music)';
}
