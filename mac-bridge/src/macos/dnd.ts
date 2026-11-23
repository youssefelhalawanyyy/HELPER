import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setMacMute } from './hardware.js';

const execFileAsync = promisify(execFile);

/**
 * Triggers macOS Focus / Do Not Disturb.
 * Attempts an optional user-created macOS Shortcut named "DevDeck Focus On" / "DevDeck Focus Off",
 * and falls back cleanly to muting Mac audio during Deep Work Focus sessions.
 */
export async function setMacFocusMode(enabled: boolean): Promise<{ dndEnabled: boolean; note: string }> {
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
