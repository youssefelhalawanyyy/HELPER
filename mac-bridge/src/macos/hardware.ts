import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let trackedBrightness = 70;

export async function getMacVolumeState(): Promise<{ volume: number; muted: boolean }> {
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
  await execFileAsync('osascript', ['-e', `set volume output volume ${clamped}`], { timeout: 1500 });
  return clamped;
}

export async function setMacMute(muted: boolean): Promise<boolean> {
  await execFileAsync('osascript', ['-e', `set volume output muted ${muted ? 'true' : 'false'}`], {
    timeout: 1500,
  });
  return muted;
}

export async function toggleMacMute(): Promise<boolean> {
  const current = await getMacVolumeState();
  return setMacMute(!current.muted);
}

export async function adjustMacBrightness(deltaSteps: number): Promise<number> {
  const steps = Math.max(-4, Math.min(4, Math.round(deltaSteps)));
  if (steps === 0) return trackedBrightness;
  const keyCode = steps > 0 ? 144 : 145; // macOS Brightness Up / Down key codes
  const count = Math.abs(steps);
  const script = `tell application "System Events" to repeat ${count} times\nkey code ${keyCode}\nend repeat`;
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 1500 });
  } catch {
    // Graceful fallback if Accessibility permission is not yet granted
  }
  trackedBrightness = Math.max(0, Math.min(100, trackedBrightness + steps * 6));
  return trackedBrightness;
}

export function getTrackedBrightness(): number {
  return trackedBrightness;
}

export async function scrollMacVertical(delta: number): Promise<void> {
  const clamped = Math.max(-15, Math.min(15, Math.round(delta)));
  if (clamped === 0) return;
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
