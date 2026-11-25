import { type ChildProcess, execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/**
 * Persistent background PowerShell worker on Windows 10/11:
 * Pre-compiles Win32 P/Invoke helpers (DevDeckWinApi) ONCE at startup and executes
 * short PowerShell commands over stdin/stdout pipes in <5ms with zero process-spawn overhead.
 */
let psWorker: ChildProcess | null = null;
let psReqCounter = 0;
const psPending = new Map<
  string,
  { resolve: (out: string) => void; timer: NodeJS.Timeout }
>();

const PS_WORKER_BOOT = `
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Add-Type @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class DevDeckWinApi {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  public static string GetFrontProcessName() {
    try {
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "Windows";
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      if (pid == 0) return "Windows";
      return Process.GetProcessById((int)pid).ProcessName;
    } catch {
      return "Windows";
    }
  }

  public static string GetFrontWindowTitle() {
    try {
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "";
      StringBuilder sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      return sb.ToString();
    } catch {
      return "";
    }
  }
}
"@ -ErrorAction SilentlyContinue

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $idx = $line.IndexOf('|')
  if ($idx -lt 1) { continue }
  $id = $line.Substring(0, $idx)
  $b64 = $line.Substring($idx + 1)
  $outStr = ""
  try {
    $script = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
    $res = Invoke-Expression $script 2>$null | Out-String
    if ($null -ne $res) { $outStr = $res }
  } catch {
    $outStr = ""
  }
  $outB64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($outStr))
  [Console]::Out.WriteLine("$id|$outB64")
  [Console]::Out.Flush()
}
`;

function ensurePsWorker(): ChildProcess | null {
  if (!IS_WIN) return null;
  if (psWorker && !psWorker.killed && psWorker.stdin?.writable) {
    return psWorker;
  }
  try {
    const encoded = Buffer.from(PS_WORKER_BOOT, 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encoded,
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    if (proc.stdout) {
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const sep = line.indexOf('|');
        if (sep < 1) return;
        const id = line.slice(0, sep);
        const b64 = line.slice(sep + 1);
        const entry = psPending.get(id);
        if (!entry) return;
        psPending.delete(id);
        clearTimeout(entry.timer);
        try {
          entry.resolve(Buffer.from(b64, 'base64').toString('utf8'));
        } catch {
          entry.resolve('');
        }
      });
    }
    proc.on('exit', () => {
      if (psWorker === proc) psWorker = null;
      for (const [id, entry] of psPending.entries()) {
        psPending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve('');
      }
    });
    if (proc.unref) proc.unref();
    psWorker = proc;
    return proc;
  } catch {
    return null;
  }
}

async function runOneShotPowerShell(script: string, timeout = 5000): Promise<string> {
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encoded,
      ],
      { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return stdout || '';
  } catch {
    return '';
  }
}

/**
 * Fast PowerShell execution:
 * Routes fast queries (<= 5s timeout, no UAC RunAs elevation) through the persistent
 * background PowerShell worker (<5ms latency), falling back to one-shot powershell.exe
 * for long or elevated commands.
 */
export async function runPowerShell(script: string, timeout = 5000): Promise<string> {
  if (!IS_WIN) return '';
  const needsIsolatedProcess =
    timeout > 6500 || /Start-Process|RunAs|SetSuspendState/i.test(script);
  const worker = !needsIsolatedProcess ? ensurePsWorker() : null;
  if (!worker || !worker.stdin?.writable) {
    return runOneShotPowerShell(script, timeout);
  }

  return new Promise<string>((resolve) => {
    const id = `r${++psReqCounter}`;
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const timer = setTimeout(() => {
      if (psPending.delete(id)) {
        resolve('');
      }
    }, timeout);
    psPending.set(id, { resolve, timer });
    try {
      worker.stdin!.write(`${id}|${b64}\n`);
    } catch {
      psPending.delete(id);
      clearTimeout(timer);
      void runOneShotPowerShell(script, timeout).then(resolve);
    }
  });
}

/**
 * Persistent low-latency Win32 mouse daemon
 * Uses compiled C# P/Invoke into user32.dll for <1ms response time
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

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT p);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

  public const uint LEFTDOWN   = 0x0002;
  public const uint LEFTUP     = 0x0004;
  public const uint RIGHTDOWN  = 0x0008;
  public const uint RIGHTUP    = 0x0010;
  public const uint WHEEL      = 0x0800;
  public const uint HWHEEL     = 0x01000;
}
"@

[DevDeckMouse]::SetProcessDPIAware() | Out-Null
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$rx = 0.0
$ry = 0.0
$lastSuccess = Get-Date
$crashCount = 0
$maxCrashes = 5

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $parts = $line.Trim().Split(' ')
    if ($parts.Length -eq 0) { continue }
    $cmd = $parts[0]

    if ($cmd -eq 'M' -or $cmd -eq 'G') {
      if ($parts.Length -lt 3) { continue }
      $dx = [double]::Parse($parts[1], $inv) + $rx
      $dy = [double]::Parse($parts[2], $inv) + $ry
      $ix = [int][Math]::Truncate($dx)
      $iy = [int][Math]::Truncate($dy)
      $rx = $dx - $ix
      $ry = $dy - $iy
      if ($ix -ne 0 -or $iy -ne 0) {
        $pt = New-Object DevDeckMouse+POINT
        [DevDeckMouse]::GetCursorPos([ref]$pt) | Out-Null
        [DevDeckMouse]::SetCursorPos($pt.X + $ix, $pt.Y + $iy) | Out-Null
        $lastSuccess = Get-Date
        $crashCount = 0
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
  } catch {
    $crashCount++
    if ($crashCount -ge $maxCrashes) {
      exit 1
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
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encoded,
      ],
      {
        stdio: ['pipe', 'ignore', 'ignore'],
        detached: false,
        windowsHide: true,
      },
    );

    proc.on('exit', (code) => {
      if (winMouseDaemon === proc) {
        winMouseDaemon = null;
        console.warn('[win32] Mouse daemon exited with code:', code);
      }
    });

    if (proc.unref) {
      proc.unref();
    }

    winMouseDaemon = proc;
    return proc;
  } catch (error) {
    console.error('[win32] Failed to start mouse daemon:', error);
    return null;
  } finally {
    winDaemonStarting = false;
  }
}

export async function sendWinKeystroke(sendKeysExpr: string): Promise<void> {
  try {
    const escaped = sendKeysExpr.replace(/'/g, "''");
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
      2500,
    );
  } catch (error) {
    console.error('[win32] Keystroke error:', error);
  }
}

export async function sendWinVirtualKey(vkHex: string): Promise<void> {
  try {
    await runPowerShell(
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }' -ErrorAction SilentlyContinue; [K]::keybd_event(${vkHex}, 0, 0, [UIntPtr]::Zero); [K]::keybd_event(${vkHex}, 0, 2, [UIntPtr]::Zero)`,
      2500,
    );
  } catch (error) {
    console.error('[win32] Virtual key error:', error);
  }
}
