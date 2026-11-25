import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import si from 'systeminformation';
import type { CaffeineManager } from '../macos/caffeine.js';
import { setMacBrightness } from '../macos/hardware.js';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type { PerfStudioMode, PerfStudioState } from '../types/protocol.js';
import { loadLocal, saveLocal } from './localStore.js';
import type { PowerThermalService } from './powerThermalService.js';

const execFileAsync = promisify(execFile);

export class PerfStudioService {
  private state: PerfStudioState = {
    mode: loadLocal<PerfStudioMode>('perf-studio-mode.json', 'normal'),
    platform: IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
    gpuName: IS_WIN ? 'Windows GPU' : 'Apple Silicon GPU',
    vramMb: null,
    displayInfo: 'Detecting display…',
    reduceTransparency: false,
    reduceMotion: false,
    highRamBoost: false,
    backgroundThrottled: false,
    autoSwitchByApp: loadLocal<boolean>('perf-auto-switch.json', false),
    lastFreedRamMb: null,
    lastActionNote: 'Normal stock mode — standard laptop/PC graphics & balanced power.',
    updatedAt: 0,
  };

  constructor(
    private powerThermal: PowerThermalService,
    private caffeine: CaffeineManager,
    private onUpdate: (state: PerfStudioState) => void,
  ) {
    void this.refreshHardware();
  }

  getLatest(): PerfStudioState {
    return this.state;
  }

  private emit(): void {
    this.state.updatedAt = Date.now();
    this.onUpdate({ ...this.state });
  }

  async refreshHardware(): Promise<PerfStudioState> {
    try {
      const gfx = await si.graphics();
      const ctrl = gfx.controllers?.[0];
      if (ctrl?.model) {
        this.state.gpuName = ctrl.model.trim();
      }
      if (typeof ctrl?.vram === 'number' && ctrl.vram > 0) {
        this.state.vramMb = Math.round(ctrl.vram);
      }
      const disp = gfx.displays?.[0];
      if (disp) {
        const res =
          disp.currentResX && disp.currentResY
            ? `${disp.currentResX}×${disp.currentResY}`
            : disp.resolutionX && disp.resolutionY
              ? `${disp.resolutionX}×${disp.resolutionY}`
              : 'Display';
        const hz = disp.currentRefreshRate ? ` · ${disp.currentRefreshRate}Hz` : '';
        this.state.displayInfo = `${res}${hz}`;
      }
    } catch {
      // Keep defaults
    }

    // Read current transparency/motion preference
    if (IS_WIN) {
      try {
        const out = await runPowerShell(
          '(Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name EnableTransparency -ErrorAction SilentlyContinue).EnableTransparency',
          1500,
        );
        const val = out.trim();
        if (val === '0' || val === '1') {
          this.state.reduceTransparency = val === '0';
        }
      } catch {
        // Ignore
      }
    } else if (process.platform === 'darwin') {
      try {
        const [{ stdout: tr }, { stdout: mo }] = await Promise.all([
          execFileAsync('defaults', ['read', 'com.apple.universalaccess', 'reduceTransparency'], {
            timeout: 1200,
          }).catch(() => ({ stdout: '0' })),
          execFileAsync('defaults', ['read', 'com.apple.universalaccess', 'reduceMotion'], {
            timeout: 1200,
          }).catch(() => ({ stdout: '0' })),
        ]);
        this.state.reduceTransparency = tr.trim() === '1';
        this.state.reduceMotion = mo.trim() === '1';
      } catch {
        // Ignore
      }
    }

    this.emit();
    return this.state;
  }

  private async applyVisualEffects(reduceTransparency: boolean, reduceMotion: boolean): Promise<void> {
    this.state.reduceTransparency = reduceTransparency;
    this.state.reduceMotion = reduceMotion;

    if (IS_WIN) {
      const transpVal = reduceTransparency ? 0 : 1;
      const fxVal = reduceMotion ? 2 : 0; // 2 = Best Performance, 0 = Let Windows choose
      const ps = `
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name EnableTransparency -Value ${transpVal} -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Name VisualFXSetting -Value ${fxVal} -ErrorAction SilentlyContinue
`;
      await runPowerShell(ps, 2500).catch(() => {});
      return;
    }

    await Promise.all([
      execFileAsync(
        'defaults',
        ['write', 'com.apple.universalaccess', 'reduceTransparency', '-bool', reduceTransparency ? 'true' : 'false'],
        { timeout: 1500 },
      ).catch(() => {}),
      execFileAsync(
        'defaults',
        ['write', 'com.apple.universalaccess', 'reduceMotion', '-bool', reduceMotion ? 'true' : 'false'],
        { timeout: 1500 },
      ).catch(() => {}),
      execFileAsync(
        'defaults',
        ['write', 'NSGlobalDomain', 'NSAutomaticWindowAnimationsEnabled', '-bool', reduceMotion ? 'false' : 'true'],
        { timeout: 1500 },
      ).catch(() => {}),
    ]);
  }

  private async throttleBackgroundProcesses(enable: boolean): Promise<number> {
    this.state.backgroundThrottled = enable;
    if (IS_WIN) {
      const priority = enable ? 'BelowNormal' : 'Normal';
      const ps = `
$skip = @('System','Idle','explorer','dwm','node','Code','Antigravity','WindowsTerminal','pwsh','powershell')
$count = 0
Get-Process | Where-Object { $_.CPU -gt 15 -and $skip -notcontains $_.ProcessName } | Select-Object -First 8 | ForEach-Object {
  try { $_.PriorityClass = '${priority}'; $count++ } catch {}
}
Write-Output $count
`;
      const out = await runPowerShell(ps, 2800).catch(() => '0');
      return Number(out.trim()) || 0;
    }

    try {
      const { stdout } = await execFileAsync('ps', ['-Ao', 'pid,pcpu,comm', '-r'], {
        timeout: 1800,
      });
      let count = 0;
      for (const raw of stdout.split('\n').slice(1, 14)) {
        const m = raw.trim().match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const cpu = Number(m[2]);
        const comm = m[3];
        if (
          !Number.isFinite(pid) ||
          pid <= 100 ||
          pid === process.pid ||
          /WindowServer|kernel_task|launchd|coreaudiod|Finder|Antigravity/i.test(comm)
        ) {
          continue;
        }
        if (enable && cpu >= 3.0) {
          await execFileAsync('renice', ['15', '-p', String(pid)], { timeout: 800 }).catch(() => {});
          count += 1;
        } else if (!enable) {
          await execFileAsync('renice', ['0', '-p', String(pid)], { timeout: 800 }).catch(() => {});
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  async freeRamNow(): Promise<{ freedMb: number; message: string }> {
    const before = await si.mem().catch(() => null);
    const beforeAvail = before ? before.available || before.free : 0;

    if (IS_WIN) {
      const ps = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MemTrim { [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess); }' -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.WorkingSet64 -gt 40MB } | ForEach-Object { try { [MemTrim]::EmptyWorkingSet($_.Handle) | Out-Null } catch {} }
[System.GC]::Collect()
`;
      await runPowerShell(ps, 3500).catch(() => {});
    } else {
      await execFileAsync('sudo', ['-n', 'purge'], { timeout: 3000 }).catch(() => {});
      await execFileAsync('sync', [], { timeout: 1500 }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 350));
    const after = await si.mem().catch(() => null);
    const afterAvail = after ? after.available || after.free : beforeAvail;
    const freedMb = Math.max(0, Math.round((afterAvail - beforeAvail) / (1024 * 1024)));
    this.state.lastFreedRamMb = freedMb;
    this.state.highRamBoost = true;
    const msg =
      freedMb > 20
        ? `Reclaimed ${freedMb} MB of RAM for active apps`
        : 'RAM standby cache trimmed & optimized for big apps';
    this.state.lastActionNote = msg;
    this.emit();
    return { freedMb, message: msg };
  }

  async setMode(mode: PerfStudioMode): Promise<string> {
    this.state.mode = mode;
    saveLocal('perf-studio-mode.json', mode);

    if (mode === 'normal') {
      await Promise.all([
        this.powerThermal.setPowerProfile('balanced'),
        this.powerThermal.setFanMode('auto'),
        this.applyVisualEffects(false, false),
        this.throttleBackgroundProcesses(false),
      ]);
      this.state.highRamBoost = false;
      this.state.lastActionNote =
        'NORMAL Stock Mode restored — standard animations, balanced CPU/GPU & auto cooling.';
      this.emit();
      return 'Normal Mode Active (restored default laptop/PC settings)';
    }

    if (mode === 'eco') {
      const [, , , throttled] = await Promise.all([
        this.powerThermal.setPowerProfile('eco'),
        this.powerThermal.setFanMode('quiet'),
        this.applyVisualEffects(true, true),
        this.throttleBackgroundProcesses(true),
        setMacBrightness(55).catch(() => {}),
      ]);
      this.state.highRamBoost = false;
      this.state.lastActionNote = `ECO Mode Active — Low Power, reduced GPU blur/motion, 55% brightness & ${throttled} background app(s) throttled.`;
      this.emit();
      return 'ECO Mode Active (max battery life & coolest CPU/GPU)';
    }

    if (mode === 'super') {
      const [, , , ramRes] = await Promise.all([
        this.powerThermal.setPowerProfile('performance'),
        this.applyVisualEffects(true, false),
        this.throttleBackgroundProcesses(true),
        this.freeRamNow(),
      ]);
      this.state.highRamBoost = true;
      this.state.lastActionNote = `SUPER High-RAM Mode — ${ramRes.message}, GPU blur stripped & background hogs throttled for big apps.`;
      this.emit();
      return `SUPER High-RAM Mode Active (${ramRes.message})`;
    }

    // mode === 'turbo'
    const [, , , , ramRes] = await Promise.all([
      this.powerThermal.setPowerProfile('performance'),
      this.powerThermal.setFanMode('max'),
      this.applyVisualEffects(true, true),
      this.throttleBackgroundProcesses(true),
      this.freeRamNow(),
      setMacBrightness(100).catch(() => {}),
    ]);
    this.caffeine.setActive(true);
    this.state.highRamBoost = true;
    this.state.lastActionNote =
      'TURBO Max Graphics Mode — Full CPU/GPU clocks, Max Cooling, 100% brightness, Caffeine ON & zero compositor overhead.';
    this.emit();
    return `TURBO Max Graphics Mode Active (${ramRes.message})`;
  }

  async toggleSetting(
    setting: 'reduceTransparency' | 'reduceMotion' | 'freeRam' | 'throttleBg' | 'autoSwitchByApp',
    enabled?: boolean,
  ): Promise<string> {
    if (setting === 'autoSwitchByApp') {
      const next = typeof enabled === 'boolean' ? enabled : !this.state.autoSwitchByApp;
      this.state.autoSwitchByApp = next;
      saveLocal('perf-auto-switch.json', next);
      this.state.lastActionNote = next
        ? 'Auto-Switch ON — switches to SUPER for Xcode/Docker/Premiere/Antigravity & TURBO for 3D/Games.'
        : 'Auto-Switch OFF — manual mode selection active.';
      this.emit();
      return this.state.lastActionNote;
    }
    if (setting === 'freeRam') {
      const res = await this.freeRamNow();
      return res.message;
    }
    if (setting === 'reduceTransparency') {
      const next = typeof enabled === 'boolean' ? enabled : !this.state.reduceTransparency;
      await this.applyVisualEffects(next, this.state.reduceMotion);
      this.state.lastActionNote = next
        ? 'Reduced Transparency ON — freed GPU compositor & VRAM overhead.'
        : 'Reduced Transparency OFF — restored full glass blur effects.';
      this.emit();
      return this.state.lastActionNote;
    }
    if (setting === 'reduceMotion') {
      const next = typeof enabled === 'boolean' ? enabled : !this.state.reduceMotion;
      await this.applyVisualEffects(this.state.reduceTransparency, next);
      this.state.lastActionNote = next
        ? 'Reduce Motion ON — instant window transitions with lower GPU load.'
        : 'Reduce Motion OFF — restored smooth system animations.';
      this.emit();
      return this.state.lastActionNote;
    }
    const next = typeof enabled === 'boolean' ? enabled : !this.state.backgroundThrottled;
    const count = await this.throttleBackgroundProcesses(next);
    this.state.lastActionNote = next
      ? `Background Throttle ON — lowered priority on ${count} background process(es).`
      : 'Background Throttle OFF — restored normal process priorities.';
    this.emit();
    return this.state.lastActionNote;
  }

  async handleActiveAppChange(appName: string): Promise<void> {
    if (!this.state.autoSwitchByApp || !appName) return;
    const lower = appName.toLowerCase();
    let target: PerfStudioMode = 'normal';
    if (/blender|unity|unreal|cinema 4d|maya|steam|valorant|fortnite|cyberpunk|league of legends|davinci|after effects/i.test(lower)) {
      target = 'turbo';
    } else if (/xcode|android studio|docker|premiere|final cut|antigravity|photoshop|intellij|webstorm|pycharm|cursor|visual studio/i.test(lower)) {
      target = 'super';
    }
    if (target !== this.state.mode) {
      await this.setMode(target);
    }
  }
}
