import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureWinMouseDaemon, IS_WIN, runPowerShell, sendWinVirtualKey } from '../platform/win32.js';

const execFileAsync = promisify(execFile);

let trackedBrightness = 70;
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
    const steps = Math.min(10, Math.max(1, Math.round(Math.abs(diff) / 2)));
    const vk = diff >= 0 ? '0xAF' : '0xAE'; // VK_VOLUME_UP / VK_VOLUME_DOWN
    try {
      await runPowerShell(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class V { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; for($i=0;$i -lt ${steps};$i++){ [V]::keybd_event(${vk},0,0,[UIntPtr]::Zero); [V]::keybd_event(${vk},0,2,[UIntPtr]::Zero) }`,
        2000,
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

export async function adjustMacBrightness(deltaSteps: number): Promise<number> {
  const steps = Math.max(-4, Math.min(4, Math.round(deltaSteps)));
  if (steps === 0) return trackedBrightness;
  trackedBrightness = Math.max(0, Math.min(100, trackedBrightness + steps * 6));

  if (IS_WIN) {
    try {
      await runPowerShell(
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue).WmiSetBrightness(1, ${trackedBrightness})`,
        2000,
      );
    } catch {
      // Desktop monitors without WMI brightness ignore gracefully
    }
    return trackedBrightness;
  }

  const keyCode = steps > 0 ? 144 : 145;
  const count = Math.abs(steps);
  const script = `tell application "System Events" to repeat ${count} times\nkey code ${keyCode}\nend repeat`;
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 1500 });
  } catch {
    // Graceful fallback
  }
  return trackedBrightness;
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
  // macOS: assert user activity via caffeinate -u + nudge HID event tap so display lights up immediately
  const child = spawn('caffeinate', ['-u', '-t', '5'], {
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
