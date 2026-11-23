import { type ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const NATIVE_SRC = path.join(BRIDGE_ROOT, 'native', 'mouse_daemon.c');
const NATIVE_BIN = path.join(BRIDGE_ROOT, 'data', 'mouse_daemon');

const FAVORITE_APPS = new Set([
  'Antigravity IDE',
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

// Persistent native CoreGraphics mouse daemon (<0.1ms per event -> silky 120Hz touchpad feel)
let mouseDaemon: ChildProcess | null = null;
let daemonCompileAttempted = false;
let daemonReadyPromise: Promise<ChildProcess | null> | null = null;

async function ensureMouseDaemon(): Promise<ChildProcess | null> {
  if (mouseDaemon && !mouseDaemon.killed && mouseDaemon.stdin?.writable) {
    return mouseDaemon;
  }
  if (daemonReadyPromise) return daemonReadyPromise;

  daemonReadyPromise = (async () => {
    try {
      if (!fs.existsSync(NATIVE_BIN)) {
        if (daemonCompileAttempted || !fs.existsSync(NATIVE_SRC)) return null;
        daemonCompileAttempted = true;
        fs.mkdirSync(path.dirname(NATIVE_BIN), { recursive: true });
        await execFileAsync(
          'clang',
          ['-O2', '-framework', 'ApplicationServices', NATIVE_SRC, '-o', NATIVE_BIN],
          { timeout: 10_000 },
        );
      }

      const proc = spawn(NATIVE_BIN, [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.on('exit', () => {
        if (mouseDaemon === proc) mouseDaemon = null;
      });
      mouseDaemon = proc;
      return proc;
    } catch {
      return null;
    } finally {
      daemonReadyPromise = null;
    }
  })();

  return daemonReadyPromise;
}

// Pre-warm native daemon on bridge startup
void ensureMouseDaemon();

export async function focusMacApp(appName: string, runningApps: string[]): Promise<string> {
  const clean = appName.trim();
  const allowed = FAVORITE_APPS.has(clean) || runningApps.includes(clean);
  if (!allowed) {
    throw new Error(`App "${clean}" is not in the allowed launcher list`);
  }

  if (clean === 'Antigravity' || clean === 'Antigravity IDE' || clean === 'Google Antigravity') {
    for (const candidate of ['/Applications/Antigravity IDE.app', 'Antigravity IDE', 'Antigravity']) {
      try {
        await execFileAsync('open', ['-a', candidate], { timeout: 2500 });
        return 'Opened Antigravity IDE';
      } catch {
        // Try next candidate
      }
    }
    throw new Error('Antigravity IDE app not found in /Applications');
  }

  await execFileAsync('open', ['-a', clean], { timeout: 2500 });
  return `Opened ${clean}`;
}

export async function moveMacCursor(dx: number, dy: number, drag = false): Promise<void> {
  const clampedX = Math.max(-280, Math.min(280, dx));
  const clampedY = Math.max(-280, Math.min(280, dy));
  if (Math.abs(clampedX) < 0.1 && Math.abs(clampedY) < 0.1) return;

  const daemon = await ensureMouseDaemon();
  if (daemon?.stdin?.writable) {
    daemon.stdin.write(`${drag ? 'G' : 'M'} ${clampedX.toFixed(2)} ${clampedY.toFixed(2)}\n`);
    return;
  }

  // Fallback to JXA if clang wasn't available
  const jxa = `
    ObjC.import('ApplicationServices');
    const curEv = $.CGEventCreate($());
    const pos = $.CGEventGetLocation(curEv);
    const moveEv = $.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, {x: Math.max(0, pos.x + ${Math.round(clampedX)}), y: Math.max(0, pos.y + ${Math.round(clampedY)})}, $.kCGMouseButtonLeft);
    if (moveEv) $.CGEventPost($.kCGHIDEventTap, moveEv);
  `;
  try {
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 1000 });
  } catch {
    // Requires Accessibility permission
  }
}

export async function clickMacCursor(button: 'left' | 'right'): Promise<void> {
  const daemon = await ensureMouseDaemon();
  if (daemon?.stdin?.writable) {
    daemon.stdin.write(`C ${button === 'right' ? 'R' : 'L'}\n`);
    return;
  }

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

export async function setMacMouseDrag(down: boolean): Promise<void> {
  const daemon = await ensureMouseDaemon();
  if (daemon?.stdin?.writable) {
    daemon.stdin.write(down ? 'D\n' : 'U\n');
  }
}

export async function scrollMacSmooth(dx: number, dy: number): Promise<void> {
  const cx = Math.max(-160, Math.min(160, Math.round(dx)));
  const cy = Math.max(-160, Math.min(160, Math.round(dy)));
  if (cx === 0 && cy === 0) return;
  const daemon = await ensureMouseDaemon();
  if (daemon?.stdin?.writable) {
    daemon.stdin.write(`S ${cx} ${cy}\n`);
  }
}

export async function sendPresentationKey(
  action: 'next' | 'prev' | 'start' | 'escape',
): Promise<string> {
  const scriptMap: Record<typeof action, string> = {
    next: 'tell application "System Events" to key code 124',
    prev: 'tell application "System Events" to key code 123',
    start: 'tell application "System Events" to keystroke "p" using {option down, command down}',
    escape: 'tell application "System Events" to key code 53',
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
