import { type ChildProcess, spawn } from 'node:child_process';
import { IS_WIN } from '../platform/win32.js';

const WIN_KEEP_AWAKE_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Awake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
while ($true) {
  [Awake]::SetThreadExecutionState(0x80000003) | Out-Null
  Start-Sleep -Seconds 30
}
`;

export class CaffeineManager {
  private child: ChildProcess | null = null;

  constructor(private onChange: (active: boolean) => void) {}

  isActive(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  setActive(active: boolean): boolean {
    if (active) {
      if (!this.isActive()) {
        if (IS_WIN) {
          const encoded = Buffer.from(WIN_KEEP_AWAKE_PS, 'utf16le').toString('base64');
          this.child = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
            { stdio: 'ignore' },
          );
        } else {
          this.child = spawn('caffeinate', ['-di'], { stdio: 'ignore' });
        }
        this.child.on('exit', () => {
          this.child = null;
          this.onChange(false);
        });
      }
      this.onChange(true);
      return true;
    }

    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    this.onChange(false);
    return false;
  }

  stop(): void {
    this.setActive(false);
  }
}
