import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/**
 * Runs a PowerShell script safely using UTF-16LE Base64 -EncodedCommand
 * so quotes, newlines, and special characters never break or inject.
 */
export async function runPowerShell(script: string, timeout = 4000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { timeout, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Persistent low-latency Win32 mouse/scroll daemon (<1ms per event).
 * Compiles inline C# P/Invoke into user32.dll once at startup and reads
 * line-delimited commands (M dx dy | G dx dy | C L/R | D | U | S dx dy) from stdin.
 */
let winMouseDaemon: ChildProcess | null = null;
let winDaemonStarting = false;

const WIN_MOUSE_DAEMON_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DevDeckMouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

  public const uint LEFTDOWN   = 0x0002;
  public const uint LEFTUP     = 0x0004;
  public const uint RIGHTDOWN  = 0x0008;
  public const uint RIGHTUP    = 0x0010;
  public const uint WHEEL      = 0x0800;
  public const uint HWHEEL     = 0x01000;
}
"@

$rx = 0.0
$ry = 0.0
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim().Split(' ')
  if ($parts.Length -eq 0) { continue }
  $cmd = $parts[0]
  if ($cmd -eq 'M' -or $cmd -eq 'G') {
    if ($parts.Length -lt 3) { continue }
    $dx = [double]$parts[1] + $rx
    $dy = [double]$parts[2] + $ry
    $ix = [int][Math]::Truncate($dx)
    $iy = [int][Math]::Truncate($dy)
    $rx = $dx - $ix
    $ry = $dy - $iy
    if ($ix -ne 0 -or $iy -ne 0) {
      $pt = New-Object DevDeckMouse+POINT
      [DevDeckMouse]::GetCursorPos([ref]$pt) | Out-Null
      [DevDeckMouse]::SetCursorPos($pt.X + $ix, $pt.Y + $iy) | Out-Null
    }
  } elseif ($cmd -eq 'C') {
    $btn = if ($parts.Length -ge 2) { $parts[1] } else { 'L' }
    if ($btn -eq 'R') {
      [DevDeckMouse]::mouse_event([DevDeckMouse]::RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      [DevDeckMouse]::mouse_event([DevDeckMouse]::RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
    } else {
      [DevDeckMouse]::mouse_event([DevDeckMouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      [DevDeckMouse]::mouse_event([DevDeckMouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
  } elseif ($cmd -eq 'D') {
    [DevDeckMouse]::mouse_event([DevDeckMouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  } elseif ($cmd -eq 'U') {
    [DevDeckMouse]::mouse_event([DevDeckMouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  } elseif ($cmd -eq 'S') {
    if ($parts.Length -lt 3) { continue }
    $sx = [int]$parts[1]
    $sy = [int]$parts[2]
    if ($sy -ne 0) {
      [DevDeckMouse]::mouse_event([DevDeckMouse]::WHEEL, 0, 0, $sy * 6, [UIntPtr]::Zero)
    }
    if ($sx -ne 0) {
      [DevDeckMouse]::mouse_event([DevDeckMouse]::HWHEEL, 0, 0, -$sx * 6, [UIntPtr]::Zero)
    }
  }
}
`;

export function ensureWinMouseDaemon(): ChildProcess | null {
  if (!IS_WIN) return null;
  if (winMouseDaemon && !winMouseDaemon.killed && winMouseDaemon.stdin?.writable) {
    return winMouseDaemon;
  }
  if (winDaemonStarting) return winMouseDaemon;
  winDaemonStarting = true;
  try {
    const encoded = Buffer.from(WIN_MOUSE_DAEMON_PS, 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    proc.on('exit', () => {
      if (winMouseDaemon === proc) winMouseDaemon = null;
    });
    winMouseDaemon = proc;
    return proc;
  } catch {
    return null;
  } finally {
    winDaemonStarting = false;
  }
}

export async function sendWinKeystroke(sendKeysExpr: string): Promise<void> {
  const escaped = sendKeysExpr.replace(/'/g, "''");
  await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
    2500,
  );
}

export async function sendWinVirtualKey(vkHex: string): Promise<void> {
  await runPowerShell(
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [K]::keybd_event(${vkHex}, 0, 0, [UIntPtr]::Zero); [K]::keybd_event(${vkHex}, 0, 2, [UIntPtr]::Zero)`,
    2500,
  );
}
