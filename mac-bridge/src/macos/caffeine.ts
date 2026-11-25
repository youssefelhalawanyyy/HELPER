import { type ChildProcess, spawn } from 'node:child_process';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import { loadLocal, saveLocal } from '../services/localStore.js';

const WIN_KEEP_AWAKE_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Awake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
}
"@ -ErrorAction SilentlyContinue
while ($true) {
  [Awake]::SetThreadExecutionState(0x80000003) | Out-Null
  Start-Sleep -Seconds 25
}
`;

export class CaffeineManager {
  private child: ChildProcess | null = null;
  private desiredActive = false;
  private shuttingDown = false;
  private respawnTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private onChange: (active: boolean) => void) {
    // Restore persisted Caffeine state across bridge restarts & hot-reloads
    const saved = Boolean(loadLocal('caffeine.json', false));
    if (saved) {
      this.setActive(true);
    }
  }

  isActive(): boolean {
    return this.desiredActive;
  }

  private spawnKeepAwakeChild(): void {
    if (this.shuttingDown || !this.desiredActive) return;
    if (this.child && !this.child.killed) return;

    try {
      if (IS_WIN) {
        const encoded = Buffer.from(WIN_KEEP_AWAKE_PS, 'utf16le').toString('base64');
        this.child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
          { stdio: 'ignore', windowsHide: true },
        );
      } else {
        // -d: prevent display sleep, -i: prevent idle sleep, -m: prevent disk sleep, -s: prevent system sleep
        this.child = spawn('caffeinate', ['-dims'], { stdio: 'ignore' });
      }

      const spawned = this.child;
      spawned.on('exit', () => {
        if (this.child === spawned) {
          this.child = null;
        }
        // Never allow Caffeine to close on its own: if user still wants it active, auto-respawn!
        if (this.desiredActive && !this.shuttingDown) {
          if (this.respawnTimer) clearTimeout(this.respawnTimer);
          this.respawnTimer = setTimeout(() => {
            this.respawnTimer = null;
            this.spawnKeepAwakeChild();
          }, 400);
        }
      });
      spawned.on('error', () => {
        if (this.child === spawned) {
          this.child = null;
        }
      });
    } catch {
      // Watchdog heartbeat will retry
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.desiredActive || this.shuttingDown) return;
      if (!this.child || this.child.killed) {
        this.spawnKeepAwakeChild();
      }
      if (IS_WIN) {
        void runPowerShell('[DevDeckWinApi]::SetThreadExecutionState(0x80000003) | Out-Null', 1500).catch(
          () => {},
        );
      }
    }, 15_000);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
  }

  setActive(active: boolean): boolean {
    this.shuttingDown = false;
    this.desiredActive = Boolean(active);
    saveLocal('caffeine.json', this.desiredActive);

    if (this.desiredActive) {
      this.spawnKeepAwakeChild();
      this.startHeartbeat();
      this.onChange(true);
      return true;
    }

    this.stopHeartbeat();
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // Ignore
      }
      this.child = null;
    }
    if (IS_WIN) {
      void runPowerShell('[DevDeckWinApi]::SetThreadExecutionState(0x80000000) | Out-Null', 1500).catch(
        () => {},
      );
    }
    this.onChange(false);
    return false;
  }

  /**
   * Called ONLY when the bridge process itself is shutting down/hot-reloading.
   * Terminates the child OS process cleanly WITHOUT clearing persisted `caffeine.json`
   * so the next bridge instance immediately resumes Caffeine!
   */
  stop(): void {
    this.shuttingDown = true;
    this.stopHeartbeat();
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // Ignore
      }
      this.child = null;
    }
  }
}
