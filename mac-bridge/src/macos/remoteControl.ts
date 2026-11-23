import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FAVORITE_APPS = new Set([
  'Antigravity',
  'Google Antigravity',
  'Visual Studio Code',
  'Google Chrome',
  'Safari',
  'Arc',
  'Spotify',
  'Anghami',
  'Music',
  'Finder',
  'Notes',
  'WhatsApp',
  'Calendar',
  'Messages',
  'Mail',
  'System Settings',
  'Terminal',
  'iTerm',
  'iTerm2',
  'Slack',
  'Discord',
  'Keynote',
  'Microsoft PowerPoint',
]);

export async function focusMacApp(appName: string, runningApps: string[]): Promise<string> {
  const clean = appName.trim();
  const allowed = FAVORITE_APPS.has(clean) || runningApps.includes(clean);
  if (!allowed) {
    throw new Error(`App "${clean}" is not in the allowed launcher list`);
  }

  // Handle Antigravity IDE app bundle naming variants automatically
  if (clean === 'Antigravity' || clean === 'Google Antigravity') {
    for (const candidate of ['Antigravity', 'Google Antigravity']) {
      try {
        await execFileAsync('open', ['-a', candidate], { timeout: 2500 });
        return `Opened ${candidate} IDE`;
      } catch {
        // Try next candidate
      }
    }
    throw new Error('Antigravity IDE app not found in /Applications');
  }

  await execFileAsync('open', ['-a', clean], { timeout: 2500 });
  return `Opened ${clean}`;
}

export async function moveMacCursor(dx: number, dy: number): Promise<void> {
  const clampedX = Math.max(-180, Math.min(180, Math.round(dx)));
  const clampedY = Math.max(-180, Math.min(180, Math.round(dy)));
  if (clampedX === 0 && clampedY === 0) return;

  const jxa = `
    ObjC.import('ApplicationServices');
    const curEv = $.CGEventCreate($());
    const pos = $.CGEventGetLocation(curEv);
    const nx = Math.max(0, pos.x + ${clampedX});
    const ny = Math.max(0, pos.y + ${clampedY});
    const moveEv = $.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, {x: nx, y: ny}, $.kCGMouseButtonLeft);
    if (moveEv) $.CGEventPost($.kCGHIDEventTap, moveEv);
  `;
  try {
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 1000 });
  } catch {
    // Requires Accessibility permission
  }
}

export async function clickMacCursor(button: 'left' | 'right'): Promise<void> {
  const downType = button === 'right' ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
  const upType = button === 'right' ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
  const btn = button === 'right' ? '$.kCGMouseButtonRight' : '$.kCGMouseButtonLeft';

  const jxa = `
    ObjC.import('ApplicationServices');
    const curEv = $.CGEventCreate($());
    const pos = $.CGEventGetLocation(curEv);
    const down = $.CGEventCreateMouseEvent($(), ${downType}, pos, ${btn});
    const up = $.CGEventCreateMouseEvent($(), ${upType}, pos, ${btn});
    if (down) $.CGEventPost($.kCGHIDEventTap, down);
    if (up) $.CGEventPost($.kCGHIDEventTap, up);
  `;
  try {
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 1000 });
  } catch {
    // Requires Accessibility permission
  }
}

export async function sendPresentationKey(
  action: 'next' | 'prev' | 'start' | 'escape',
): Promise<string> {
  const scriptMap: Record<typeof action, string> = {
    next: 'tell application "System Events" to key code 124', // Right Arrow
    prev: 'tell application "System Events" to key code 123', // Left Arrow
    start: 'tell application "System Events" to keystroke "p" using {option down, command down}',
    escape: 'tell application "System Events" to key code 53', // Escape
  };
  await execFileAsync('osascript', ['-e', scriptMap[action]], { timeout: 1500 });
  return `Slide: ${action}`;
}

export async function toggleMacDarkMode(): Promise<boolean> {
  const { stdout } = await execFileAsync(
    'osascript',
    [
      '-e',
      'tell application "System Events" to tell appearance preferences\nset dark mode to not dark mode\nreturn dark mode as text\nend tell',
    ],
    { timeout: 2000 },
  );
  return stdout.trim() === 'true';
}

export async function toggleMacMicMute(): Promise<{ micMuted: boolean; micInputPct: number }> {
  const { stdout } = await execFileAsync(
    'osascript',
    ['-e', 'return input volume of (get volume settings) as text'],
    { timeout: 1500 },
  );
  const current = Number(stdout.trim()) || 0;
  const nextLevel = current > 0 ? 0 : 80;
  await execFileAsync('osascript', ['-e', `set volume input volume ${nextLevel}`], { timeout: 1500 });
  return { micMuted: nextLevel === 0, micInputPct: nextLevel };
}
