import { type ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ensureWinMouseDaemon,
  IS_WIN,
  runPowerShell,
  sendWinKeystroke,
} from '../platform/win32.js';

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
  'Microsoft Edge',
  'Safari',
  'Arc',
  'Spotify',
  'Anghami',
  'Music',
  'Finder',
  'Explorer',
  'Notes',
  'Notepad',
  'WhatsApp',
  'Calendar',
  'Messages',
  'Mail',
  'System Settings',
  'Terminal',
  'Windows Terminal',
  'iTerm',
  'iTerm2',
  'Slack',
  'Discord',
  'Keynote',
  'Microsoft PowerPoint',
]);

// Map friendly app names to Windows process names & launch commands
const WIN_APP_MAP: Record<string, { procs: string[]; launch: string[] }> = {
  'Antigravity IDE': {
    procs: ['Antigravity', 'Antigravity IDE'],
    launch: [
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Antigravity IDE\\Antigravity IDE.exe`,
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Antigravity\\Antigravity.exe`,
      'antigravity',
    ],
  },
  Antigravity: {
    procs: ['Antigravity', 'Antigravity IDE'],
    launch: [
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Antigravity IDE\\Antigravity IDE.exe`,
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Antigravity\\Antigravity.exe`,
      'antigravity',
    ],
  },
  'Visual Studio Code': { procs: ['Code'], launch: ['code'] },
  'Google Chrome': { procs: ['chrome'], launch: ['chrome'] },
  'Microsoft Edge': { procs: ['msedge'], launch: ['msedge'] },
  Spotify: { procs: ['Spotify'], launch: ['spotify:'] },
  Anghami: { procs: ['Anghami'], launch: ['anghami:'] },
  Finder: { procs: ['explorer'], launch: ['explorer.exe'] },
  Explorer: { procs: ['explorer'], launch: ['explorer.exe'] },
  Terminal: { procs: ['WindowsTerminal', 'pwsh', 'powershell'], launch: ['wt.exe', 'powershell.exe'] },
  'Windows Terminal': { procs: ['WindowsTerminal'], launch: ['wt.exe'] },
  Notes: { procs: ['Notepad'], launch: ['notepad.exe'] },
  Notepad: { procs: ['Notepad'], launch: ['notepad.exe'] },
  WhatsApp: { procs: ['WhatsApp'], launch: ['whatsapp:'] },
  Discord: { procs: ['Discord'], launch: ['discord:'] },
  Slack: { procs: ['slack'], launch: ['slack:'] },
  'System Settings': { procs: ['SystemSettings'], launch: ['ms-settings:'] },
};

// Persistent native CoreGraphics mouse daemon on macOS (<0.1ms per event)
let mouseDaemon: ChildProcess | null = null;
let daemonCompileAttempted = false;
let daemonReadyPromise: Promise<ChildProcess | null> | null = null;

async function ensureMouseDaemon(): Promise<ChildProcess | null> {
  if (IS_WIN) {
    return ensureWinMouseDaemon();
  }
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

// Pre-warm mouse daemon on bridge startup
void ensureMouseDaemon();

async function focusWindowsApp(clean: string): Promise<string> {
  const entry = WIN_APP_MAP[clean];
  const procNames = entry ? entry.procs : [clean];
  const procFilter = procNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');

  // 1. Try focusing an existing window first
  const psFocus = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$names = @(${procFilter})
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($names -contains $_.ProcessName -or ($names | Where-Object { $_.ToLower() -eq $PSItem.ProcessName.ToLower() })) } | Select-Object -First 1
if ($p) {
  [WinFocus]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
  [WinFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Write-Output "FOCUSED"
}
`;
  try {
    const out = await runPowerShell(psFocus, 3000);
    if (out.includes('FOCUSED')) {
      return `Focused ${clean}`;
    }
  } catch {
    // Fall through to launch
  }

  // 2. Otherwise launch the app
  const candidates = entry ? entry.launch : [clean];
  for (const target of candidates) {
    if (!target) continue;
    if (target.includes('\\') && !fs.existsSync(target)) continue;
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return `Opened ${clean}`;
    } catch {
      // Try next candidate
    }
  }
  throw new Error(`Could not open ${clean} on Windows`);
}

export async function focusMacApp(appName: string, runningApps: string[]): Promise<string> {
  const clean = appName.trim();
  const allowed = FAVORITE_APPS.has(clean) || runningApps.includes(clean);
  if (!allowed) {
    throw new Error(`App "${clean}" is not in the allowed launcher list`);
  }

  if (IS_WIN) {
    return focusWindowsApp(clean);
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
  if (IS_WIN) return;

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
  if (IS_WIN) return;

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
  if (IS_WIN) {
    const winMap: Record<typeof action, string> = {
      next: '{RIGHT}',
      prev: '{LEFT}',
      start: '{F5}',
      escape: '{ESC}',
    };
    await sendWinKeystroke(winMap[action]);
    return `Slide: ${action}`;
  }

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
  if (IS_WIN) {
    const out = await runPowerShell(
      `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $cur=(Get-ItemProperty -Path $p -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme; $next = if ($cur -eq 0) { 1 } else { 0 }; Set-ItemProperty -Path $p -Name AppsUseLightTheme -Value $next; Set-ItemProperty -Path $p -Name SystemUsesLightTheme -Value $next; Write-Output ($next -eq 0)`,
      3000,
    );
    return out.trim().toLowerCase() === 'true';
  }

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
  if (IS_WIN) {
    return { micMuted: false, micInputPct: 80 };
  }
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
