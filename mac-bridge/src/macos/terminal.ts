import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Escapes a string safely for AppleScript double-quoted string literals.
 */
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

/**
 * Sends a configured command to the active macOS Terminal (or iTerm2 if running) window
 * via AppleScript. Only invoked for locally configured macro payloads.
 */
export async function sendToActiveMacTerminal(command: string): Promise<string> {
  const safeCmd = escapeAppleScript(command.trim());
  if (!safeCmd) {
    throw new Error('Empty terminal command');
  }

  // Prefer iTerm2 if it is currently running and has a window
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
      return `Sent to iTerm2: ${command.slice(0, 48)}`;
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
  return `Sent to Terminal: ${command.slice(0, 48)}`;
}
