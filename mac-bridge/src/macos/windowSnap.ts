import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, runPowerShell } from '../platform/win32.js';

const execFileAsync = promisify(execFile);

export type WindowSnapPosition = 'left' | 'right' | 'maximize' | 'center' | 'top' | 'bottom';

async function snapWindowsFrontmostWindow(position: WindowSnapPosition): Promise<string> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinSnap {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
$hwnd = [WinSnap]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "No active window"; exit 0 }
$screen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
$wa = $screen.WorkingArea
$sx = $wa.X; $sy = $wa.Y; $sw = $wa.Width; $sh = $wa.Height
$tx = $sx; $ty = $sy; $tw = $sw; $th = $sh
$pos = "${position}"

if ($pos -eq "maximize") {
  [WinSnap]::ShowWindow($hwnd, 3) | Out-Null
  Write-Output "Window maximized"
  exit 0
}

[WinSnap]::ShowWindow($hwnd, 9) | Out-Null
if ($pos -eq "left") {
  $tw = [int]($sw / 2)
} elseif ($pos -eq "right") {
  $tw = [int]($sw / 2)
  $tx = $sx + $tw
} elseif ($pos -eq "center") {
  $tw = [int]($sw * 0.8)
  $th = [int]($sh * 0.86)
  $tx = $sx + [int](($sw - $tw) / 2)
  $ty = $sy + [int](($sh - $th) / 2)
} elseif ($pos -eq "top") {
  $th = [int]($sh / 2)
} elseif ($pos -eq "bottom") {
  $th = [int]($sh / 2)
  $ty = $sy + $th
}

[WinSnap]::MoveWindow($hwnd, $tx, $ty, $tw, $th, $true) | Out-Null
Write-Output ("Window snapped to " + $pos)
`;
  const out = await runPowerShell(ps, 5000);
  return out.trim() || `Window snapped to ${position}`;
}

export async function snapFrontmostWindow(position: WindowSnapPosition): Promise<string> {
  if (IS_WIN) {
    try {
      return await snapWindowsFrontmostWindow(position);
    } catch (err) {
      throw new Error(`Window snap failed: ${err instanceof Error ? err.message.slice(0, 100) : 'error'}`);
    }
  }

  // macOS: AppKit NSScreen.visibleFrame (instant, respects Menu Bar + Dock)
  const jxa = `
    ObjC.import('AppKit');
    const screen = $.NSScreen.mainScreen;
    const frame = screen.frame;
    const vis = screen.visibleFrame;
    const sx = Math.round(vis.origin.x);
    const sy = Math.round(frame.size.height - (vis.origin.y + vis.size.height));
    const sw = Math.round(vis.size.width);
    const sh = Math.round(vis.size.height);

    let tx = sx, ty = sy, tw = sw, th = sh;
    const pos = "${position}";
    if (pos === "left") {
      tw = Math.round(sw / 2);
    } else if (pos === "right") {
      tw = Math.round(sw / 2);
      tx = sx + tw;
    } else if (pos === "center") {
      tw = Math.round(sw * 0.8);
      th = Math.round(sh * 0.86);
      tx = sx + Math.round((sw - tw) / 2);
      ty = sy + Math.round((sh - th) / 2);
    } else if (pos === "top") {
      th = Math.round(sh / 2);
    } else if (pos === "bottom") {
      th = Math.round(sh / 2);
      ty = sy + th;
    }

    const se = Application('System Events');
    const procs = se.applicationProcesses.whose({ frontmost: true });
    if (procs.length === 0) {
      "No active app";
    } else {
      const frontApp = procs[0];
      const appName = frontApp.name();
      const wins = frontApp.windows();
      if (wins.length === 0) {
        appName + " has no resizable window";
      } else {
        const w = wins[0];
        w.position = [tx, ty];
        w.size = [tw, th];
        appName + " snapped to " + pos;
      }
    }
  `;

  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], {
      timeout: 6000,
    });
    return stdout.trim() || `Snapped window to ${position}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not allowed assistive access|1002|accessibility/i.test(msg)) {
      throw new Error('Enable Accessibility for Terminal in System Settings → Privacy & Security');
    }
    throw new Error(`Window snap failed: ${msg.slice(0, 100)}`);
  }
}
