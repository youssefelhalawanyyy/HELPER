import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, sendWinKeystroke } from '../platform/win32.js';
import { copyToMacClipboard, triggerMacPaste } from './clipboard.js';
import { focusMacApp } from './remoteControl.js';

const execFileAsync = promisify(execFile);

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', `tell application "System Events" to (name of processes) contains "${escapeAppleScript(appName)}"`],
      { timeout: 1200 },
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function sendToActiveMacTerminal(command: string): Promise<string> {
  const clean = command.trim();
  if (!clean) {
    throw new Error('Empty terminal command');
  }

  if (IS_WIN) {
    await focusMacApp('Terminal', []);
    await new Promise((r) => setTimeout(r, 160));
    await copyToMacClipboard(clean);
    await triggerMacPaste();
    await new Promise((r) => setTimeout(r, 80));
    await sendWinKeystroke('{ENTER}');
    return `Sent to Windows Terminal: ${clean.slice(0, 48)}`;
  }

  const safeCmd = escapeAppleScript(clean);

  if (await isAppRunning('iTerm2')) {
    const itermScript = `
      tell application "iTerm2"
        activate
        if (count of windows) = 0 then
          create window with default profile
        end if
        tell current session of current window
          write text "${safeCmd}"
        end tell
      end tell
    `;
    try {
      await execFileAsync('osascript', ['-e', itermScript], { timeout: 2500 });
      return `Sent to iTerm2: ${clean.slice(0, 48)}`;
    } catch {
      // Fall back to Apple Terminal
    }
  }

  const terminalScript = `
    tell application "Terminal"
      activate
      if (count of windows) = 0 then
        do script "${safeCmd}"
      else
        do script "${safeCmd}" in front window
      end if
    end tell
  `;
  await execFileAsync('osascript', ['-e', terminalScript], { timeout: 2500 });
  return `Sent to Terminal: ${clean.slice(0, 48)}`;
}
