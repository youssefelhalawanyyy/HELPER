import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN } from '../platform/win32.js';
import { setMacMute } from './hardware.js';

const execFileAsync = promisify(execFile);

export async function setMacFocusMode(enabled: boolean): Promise<{ dndEnabled: boolean; note: string }> {
  if (IS_WIN) {
    try {
      await setMacMute(enabled);
    } catch {
      // Ignore
    }
    return {
      dndEnabled: enabled,
      note: enabled ? 'Focus active (Windows audio muted)' : 'Focus ended (Windows audio restored)',
    };
  }

  const shortcutName = enabled ? 'DevDeck Focus On' : 'DevDeck Focus Off';
  try {
    await execFileAsync('shortcuts', ['run', shortcutName], { timeout: 3000 });
    return { dndEnabled: enabled, note: `Ran macOS Shortcut "${shortcutName}"` };
  } catch {
    try {
      await setMacMute(enabled);
    } catch {
      // Ignore audio errors
    }
    return {
      dndEnabled: enabled,
      note: enabled
        ? 'Focus active (Mac audio muted; create "DevDeck Focus On/Off" Shortcut for system DND)'
        : 'Focus ended (Mac audio restored)',
    };
  }
}
