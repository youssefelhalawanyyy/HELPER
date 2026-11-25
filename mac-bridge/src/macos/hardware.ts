import { execFile, spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ensureWinMouseDaemon, IS_WIN, runPowerShell, sendWinVirtualKey } from '../platform/win32.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const DISPLAY_CTL_SRC = path.join(BRIDGE_ROOT, 'native', 'display_ctl.c');
const DISPLAY_CTL_BIN = path.join(BRIDGE_ROOT, 'data', 'display_ctl');

let displayCompilePromise: Promise<string | null> | null = null;
let displayCompileFailed = false;

async function ensureMacDisplayCtlBinary(): Promise<string | null> {
  if (IS_WIN || process.platform !== 'darwin') return null;
  if (displayCompileFailed) return null;

  const needsCompile =
    !fs.existsSync(DISPLAY_CTL_BIN) ||
    (fs.existsSync(DISPLAY_CTL_SRC) &&
      fs.statSync(DISPLAY_CTL_SRC).mtimeMs > fs.statSync(DISPLAY_CTL_BIN).mtimeMs);

  if (!needsCompile && fs.existsSync(DISPLAY_CTL_BIN)) {
    return DISPLAY_CTL_BIN;
  }
  if (displayCompilePromise) return displayCompilePromise;

  displayCompilePromise = (async () => {
    try {
      if (!fs.existsSync(DISPLAY_CTL_SRC)) return null;
      fs.mkdirSync(path.dirname(DISPLAY_CTL_BIN), { recursive: true });
      await execFileAsync(
        'clang',
        [
          '-O2',
          '-framework',
          'CoreGraphics',
          '-F/System/Library/PrivateFrameworks',
          '-framework',
          'DisplayServices',
          DISPLAY_CTL_SRC,
          '-o',
          DISPLAY_CTL_BIN,
        ],
        { timeout: 10_000 },
      );
      return DISPLAY_CTL_BIN;
    } catch {
      displayCompileFailed = true;
      return null;
    } finally {
      displayCompilePromise = null;
    }
  })();

  return displayCompilePromise;
}

// Pre-warm native display brightness binary on macOS load
void ensureMacDisplayCtlBinary();

let trackedBrightness = 75;
let lastBrightnessReadTs = 0;
let trackedWinVolume = 50;
let trackedWinMuted = false;

export async function getMacVolumeState(): Promise<{ volume: number; muted: boolean }> {
  if (IS_WIN) {
    return { volume: trackedWinVolume, muted: trackedWinMuted };
  }

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'set s to get volume settings\nreturn (output volume of s as text) & "," & (output muted of s as text)'],
      { timeout: 1500 },
    );
    const [volStr, muteStr] = stdout.trim().split(',');
    const volume = Math.max(0, Math.min(100, Number(volStr) || 0));
    const muted = muteStr === 'true';
    return { volume, muted };
  } catch {
    return { volume: 50, muted: false };
  }
}

export async function setMacVolume(level: number): Promise<number> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  if (IS_WIN) {
    const diff = clamped - trackedWinVolume;
    const steps = Math.min(12, Math.max(1, Math.round(Math.abs(diff) / 2)));
    const vk = diff >= 0 ? '0xAF' : '0xAE'; // VK_VOLUME_UP / VK_VOLUME_DOWN
    try {
      await runPowerShell(
        `for($i=0;$i -lt ${steps};$i++){ [DevDeckWinApi]::TapKey(${vk}) }`,
        1800,
      );
    } catch {
      // Ignore transient error
    }
    trackedWinVolume = clamped;
    return clamped;
  }

  await execFileAsync('osascript', ['-e', `set volume output volume ${clamped}`], { timeout: 1500 });
  return clamped;
}

export async function setMacMicVolume(level: number): Promise<number> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  if (IS_WIN) {
    return clamped;
  }
  await execFileAsync('osascript', ['-e', `set volume input volume ${clamped}`], { timeout: 1500 }).catch(() => {});
  return clamped;
}

export async function setMacMute(muted: boolean): Promise<boolean> {
  if (IS_WIN) {
    if (muted !== trackedWinMuted) {
      await sendWinVirtualKey('0xAD'); // VK_VOLUME_MUTE
      trackedWinMuted = muted;
    }
    return trackedWinMuted;
  }

  await execFileAsync('osascript', ['-e', `set volume output muted ${muted ? 'true' : 'false'}`], {
    timeout: 1500,
  });
  return muted;
}

export async function toggleMacMute(): Promise<boolean> {
  if (IS_WIN) {
    await sendWinVirtualKey('0xAD'); // VK_VOLUME_MUTE
    trackedWinMuted = !trackedWinMuted;
    return trackedWinMuted;
  }
  const current = await getMacVolumeState();
  return setMacMute(!current.muted);
}

export async function getMacBrightness(): Promise<number> {
  const now = Date.now();
  if (now - lastBrightnessReadTs < 2500) {
    return trackedBrightness;
  }
  lastBrightnessReadTs = now;

  if (IS_WIN) {
    try {
      const out = await runPowerShell(
        '$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness; if ($null -ne $b) { Write-Output $b }',
        1800,
      );
      const val = Number(out.trim());
      if (Number.isFinite(val) && val >= 0 && val <= 100) {
        trackedBrightness = Math.round(val);
      }
    } catch {
      // Desktop monitors without WMI keep trackedBrightness
    }
    return trackedBrightness;
  }

  const bin = await ensureMacDisplayCtlBinary();
  if (bin) {
    try {
      const { stdout } = await execFileAsync(bin, [], { timeout: 1000 });
      const val = Number(stdout.trim());
      if (Number.isFinite(val) && val >= 0 && val <= 100) {
        trackedBrightness = Math.round(val);
      }
    } catch {
      // Ignore
    }
  }
  return trackedBrightness;
}

export async function setMacBrightness(level: number): Promise<number> {
  const clamped = Math.max(2, Math.min(100, Math.round(level)));
  trackedBrightness = clamped;
  lastBrightnessReadTs = Date.now();

  if (IS_WIN) {
    try {
      await runPowerShell(
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue).WmiSetBrightness(1, ${clamped})`,
        2000,
      );
    } catch {
      // Desktop monitors without WMI brightness ignore gracefully
    }
    return trackedBrightness;
  }

  // Primary on macOS: Native DisplayServices private framework (<2ms exact 0-100% hardware control!)
  const bin = await ensureMacDisplayCtlBinary();
  if (bin) {
    try {
      await execFileAsync(bin, [String(clamped)], { timeout: 1000 });
      return trackedBrightness;
    } catch {
      // Fall back to key codes below
    }
  }

  const keyCode = clamped >= 50 ? 144 : 145;
  try {
    await execFileAsync(
      'osascript',
      ['-e', `tell application "System Events" to key code ${keyCode}`],
      { timeout: 1200 },
    );
  } catch {
    // Graceful fallback
  }
  return trackedBrightness;
}

export async function adjustMacBrightness(deltaSteps: number): Promise<number> {
  const cur = await getMacBrightness();
  const next = Math.max(2, Math.min(100, cur + Math.round(deltaSteps * 6)));
  return setMacBrightness(next);
}

export function getTrackedBrightness(): number {
  return trackedBrightness;
}

export async function scrollMacVertical(delta: number): Promise<void> {
  const clamped = Math.max(-15, Math.min(15, Math.round(delta)));
  if (clamped === 0) return;

  if (IS_WIN) {
    const daemon = ensureWinMouseDaemon();
    if (daemon?.stdin?.writable) {
      daemon.stdin.write(`S 0 ${clamped * 20}\n`);
    }
    return;
  }

  const jxa = `
    ObjC.import('ApplicationServices');
    const ev = $.CGEventCreateScrollWheelEvent($(), $.kCGScrollEventUnitLine, 1, ${clamped});
    if (ev) {
      $.CGEventPost($.kCGHIDEventTap, ev);
    }
  `;
  try {
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 1200 });
  } catch {
    // Requires Accessibility permission
  }
}

export async function lockMacScreen(): Promise<void> {
  if (IS_WIN) {
    await execFileAsync('rundll32.exe', ['user32.dll,LockWorkStation'], { timeout: 2000 });
    return;
  }

  try {
    await execFileAsync('pmset', ['displaysleepnow'], { timeout: 1500 });
  } catch {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "q" using {control down, command down}'],
      { timeout: 1500 },
    );
  }
}

export async function wakeMacDisplay(): Promise<void> {
  if (IS_WIN) {
    await runPowerShell(
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); [DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam); [DllImport("user32.dll")] public static extern void mouse_event(uint f,int x,int y,int d,UIntPtr e); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }' -ErrorAction SilentlyContinue; [W]::SetThreadExecutionState(0x80000003) | Out-Null; [W]::SendMessage(-1, 0x0112, 0xF170, -1) | Out-Null; [W]::mouse_event(1,2,0,0,[UIntPtr]::Zero); [W]::mouse_event(1,-2,0,0,[UIntPtr]::Zero); [W]::keybd_event(0x10,0,0,[UIntPtr]::Zero); [W]::keybd_event(0x10,0,2,[UIntPtr]::Zero)`,
      3000,
    );
    return;
  }
  const child = spawn('caffeinate', ['-u', '-t', '8'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  await execFileAsync(
    'osascript',
    ['-e', 'tell application "System Events" to key code 63'],
    { timeout: 1500 },
  ).catch(() => {});
}

export async function wakeAndUnlockComputer(password?: string): Promise<string> {
  await wakeMacDisplay();
  const pwd = typeof password === 'string' ? password : '';
  if (!pwd) {
    return IS_WIN ? 'Windows PC screen woken from sleep' : 'Mac display woken from sleep';
  }

  // Wait for the lock screen password field to wake and receive keyboard focus
  await new Promise((r) => setTimeout(r, 900));

  if (IS_WIN) {
    // Escape SendKeys special characters: + ^ % ~ ( ) { } [ ]
    const escaped = pwd.replace(/([+^%~(){}[\]])/g, '{$1}');
    const b64 = Buffer.from(escaped, 'utf8').toString('base64');
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 550
[System.Windows.Forms.SendKeys]::SendWait('^a{BACKSPACE}')
Start-Sleep -Milliseconds 80
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
[System.Windows.Forms.SendKeys]::SendWait($p)
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`;
    await runPowerShell(ps, 5000).catch(() => {});
    return 'Windows PC woken & unlock password submitted';
  }

  // macOS: Never press spacebar (key code 49) because it types a leading space into the focused password box!
  // Instead: clear any leftover text (Cmd+A + Delete), type each character with a short lock-screen-safe cadence, then press Return.
  const script = `
on run argv
  set pwd to item 1 of argv
  tell application "System Events"
    keystroke "a" using {command down}
    delay 0.06
    key code 51
    delay 0.14
    repeat with ch in characters of pwd
      keystroke (ch as text)
      delay 0.025
    end repeat
    delay 0.15
    key code 36
  end tell
end run
`;
  try {
    await execFileAsync('osascript', ['-e', script, pwd], { timeout: 8000 });
    return 'Mac woken & unlock password submitted';
  } catch {
    return 'Mac display woken (grant Accessibility permission to Terminal for auto-password typing)';
  }
}

export function captureSelectionToClipboard(): void {
  if (IS_WIN) {
    const child = spawn('cmd.exe', ['/c', 'start', '', 'ms-screenclip:'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  const child = spawn('screencapture', ['-i', '-c'], { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function typeTextOnHost(text: string, pressEnter = false): Promise<void> {
  if (!text && !pressEnter) return;
  if (IS_WIN) {
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}');
    const b64 = Buffer.from(escaped, 'utf8').toString('base64');
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
if ($t.Length -gt 0) { [System.Windows.Forms.SendKeys]::SendWait($t) }
${pressEnter ? "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')" : ''}
`;
    await runPowerShell(ps, 3000).catch(() => {});
    return;
  }

  const script = `
on run argv
  set txt to item 1 of argv
  tell application "System Events"
    if length of txt > 0 then keystroke txt
    ${pressEnter ? 'key code 36' : ''}
  end tell
end run
`;
  await execFileAsync('osascript', ['-e', script, text], { timeout: 2500 }).catch(() => {});
}

export async function pressSpecialKeyOnHost(
  key:
    | 'esc'
    | 'tab'
    | 'enter'
    | 'backspace'
    | 'up'
    | 'down'
    | 'left'
    | 'right'
    | 'undo'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'spotlight',
): Promise<void> {
  if (IS_WIN) {
    const winMap: Record<typeof key, string> = {
      esc: '{ESC}',
      tab: '{TAB}',
      enter: '{ENTER}',
      backspace: '{BACKSPACE}',
      up: '{UP}',
      down: '{DOWN}',
      left: '{LEFT}',
      right: '{RIGHT}',
      undo: '^z',
      copy: '^c',
      paste: '^v',
      selectAll: '^a',
      spotlight: '^{ESC}',
    };
    const seq = winMap[key];
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${seq}')`,
      2000,
    ).catch(() => {});
    return;
  }

  const macMap: Record<typeof key, string> = {
    esc: 'key code 53',
    tab: 'key code 48',
    enter: 'key code 36',
    backspace: 'key code 51',
    up: 'key code 126',
    down: 'key code 125',
    left: 'key code 123',
    right: 'key code 124',
    undo: 'keystroke "z" using {command down}',
    copy: 'keystroke "c" using {command down}',
    paste: 'keystroke "v" using {command down}',
    selectAll: 'keystroke "a" using {command down}',
    spotlight: 'key code 49 using {command down}',
  };
  await execFileAsync('osascript', ['-e', `tell application "System Events" to ${macMap[key]}`], {
    timeout: 1800,
  }).catch(() => {});
}

export async function captureScreenPeekJpeg(maxWidth = 720): Promise<Buffer | null> {
  const width = Math.max(320, Math.min(1280, Math.round(maxWidth)));
  const tmpFile = path.join(os.tmpdir(), `devdeck-peek-${process.pid}.jpg`);
  try {
    if (IS_WIN) {
      const escaped = tmpFile.replace(/'/g, "''");
      const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$h = [int]([Math]::Round($b.Height * (${width} / [double]$b.Width)))
$small = New-Object System.Drawing.Bitmap($bmp, ${width}, $h)
$small.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $bmp.Dispose(); $small.Dispose()
`;
      await runPowerShell(ps, 3000);
      return fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile) : null;
    }

    await execFileAsync('screencapture', ['-x', '-t', 'jpg', tmpFile], { timeout: 2000 });
    await execFileAsync('sips', ['-Z', String(width), '-s', 'formatOptions', '55', tmpFile], {
      timeout: 2000,
    }).catch(() => {});
    return fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile) : null;
  } catch {
    return null;
  }
}

export async function readClipboardImageBase64(): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `devdeck-clip-in-${process.pid}.png`);
  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (IS_WIN) {
      const escaped = tmpFile.replace(/'/g, "''");
      const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  $img.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  Write-Output 'OK'
}
`;
      await runPowerShell(ps, 2500);
    } else {
      const script = `
set outPath to POSIX file "${tmpFile}"
try
  set imgData to the clipboard as «class PNGf»
  set f to open for access outPath with write permission
  set eof of f to 0
  write imgData to f
  close access f
  return "OK"
on error
  return "NO_IMAGE"
end try
`;
      await execFileAsync('osascript', ['-e', script], { timeout: 2200 });
    }
    if (!fs.existsSync(tmpFile)) return null;
    const buf = fs.readFileSync(tmpFile);
    if (buf.byteLength < 16) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function writeClipboardImageBase64(dataUrl: string): Promise<boolean> {
  const stripped = dataUrl.includes(',') ? dataUrl.split(',')[1] || '' : dataUrl;
  const buf = Buffer.from(stripped, 'base64');
  if (buf.byteLength < 16 || buf.byteLength > 15 * 1024 * 1024) return false;
  const tmpFile = path.join(os.tmpdir(), `devdeck-clip-out-${process.pid}.png`);
  fs.writeFileSync(tmpFile, buf);
  try {
    if (IS_WIN) {
      const escaped = tmpFile.replace(/'/g, "''");
      const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$img = [System.Drawing.Image]::FromFile('${escaped}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`;
      await runPowerShell(ps, 2500);
      return true;
    }
    const script = `set the clipboard to (read (POSIX file "${tmpFile}") as «class PNGf»)`;
    await execFileAsync('osascript', ['-e', script], { timeout: 2200 });
    return true;
  } catch {
    return false;
  }
}

export function sendWakeOnLanPacket(rawMac: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hex = rawMac.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length !== 12) {
      reject(new Error('Invalid MAC address (use format AA:BB:CC:DD:EE:FF)'));
      return;
    }
    const macBytes = Buffer.from(hex, 'hex');
    const magic = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i += 1) {
      macBytes.copy(magic, 6 + i * 6);
    }

    const socket = dgram.createSocket('udp4');
    socket.on('error', (err) => {
      try {
        socket.close();
      } catch {
        // Ignore
      }
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(magic, 0, magic.length, 9, '255.255.255.255', (err) => {
        try {
          socket.close();
        } catch {
          // Ignore
        }
        if (err) reject(err);
        else resolve(`Wake-on-LAN magic packet broadcast to ${rawMac.toUpperCase()}`);
      });
    });
  });
}
