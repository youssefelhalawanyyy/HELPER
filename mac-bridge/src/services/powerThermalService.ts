import { loadLocal, saveLocal } from './localStore.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { lockMacScreen } from '../macos/hardware.js';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type {
  FanMode,
  PowerAction,
  PowerProfile,
  PowerThermalState,
} from '../types/protocol.js';

const execFileAsync = promisify(execFile);

const SMC_CANDIDATES = [
  '/Applications/smcFanControl.app/Contents/Resources/smc',
  '/usr/local/bin/smc',
  '/opt/homebrew/bin/smc',
];

function findSmcBinary(): string | null {
  if (IS_WIN || process.platform !== 'darwin') return null;
  for (const p of SMC_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export class PowerThermalService {
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private smcBin: string | null = findSmcBinary();

  // Alert hysteresis flags so chimes fire once per crossing instead of spamming
  private ecoAttempted = false;
  private swapSample?: { used: number; ts: number };
  private chargeAlertFired = false;
  private overheatAlertFired = false;
  private lowBattAlertFired = false;

  private state: PowerThermalState = {
    platform: IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
    hardwareModel: '',
    cpuModel: os.cpus()[0]?.model?.trim() || 'CPU',
    hasBattery: true,
    batteryPct: 100,
    isCharging: false,
    acConnected: false,
    timeRemainingMin: null,
    cycleCount: null,
    healthPct: null,
    designCapacityMah: null,
    maxCapacityMah: null,
    voltageV: null,
    amperageMa: null,
    powerDrawW: null,
    cpuTempC: null,
    gpuTempC: null,
    batteryTempC: null,
    thermalPressure: 'Nominal',
    fanless: false,
    fanRpm: [],
    fanMaxRpm: null,
    fanControlSupported: false,
    fanMode: 'auto',
    fanNote: 'Detecting cooling hardware…',
    lowPowerMode: false,
    powerProfile: 'balanced',
    autoPilot: loadLocal('autopilot.json', false),
    chargeGuardEnabled: true,
    chargeGuardPct: 80,
    overheatGuardEnabled: true,
    overheatTempC: 85,
    lowBatteryGuardEnabled: true,
    lastAlertMessage: null,
    updatedAt: 0,
  };

  constructor(
    private onUpdate: (state: PowerThermalState) => void,
    private onAlert?: (kind: 'success' | 'error' | 'warning', message: string) => void,
  ) {}

  getLatest(): PowerThermalState {
    return this.state;
  }

  private emit(): void {
    this.onUpdate({
      ...this.state,
      fanRpm: [...this.state.fanRpm],
    });
  }

  start(initialDelayMs = 1500): void {
    this.stop();
    this.startTimer = setTimeout(() => {
      void this.refresh();
      this.timer = setInterval(() => {
        void this.refresh();
      }, 4500);
    }, initialDelayMs);
  }

  stop(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async readMacHardwareModel(): Promise<void> {
    if (this.state.hardwareModel) return;
    if (IS_WIN) {
      try {
        const out = await runPowerShell('(Get-CimInstance Win32_ComputerSystem).Model', 2500);
        this.state.hardwareModel = out.trim() || 'Windows PC';
      } catch {
        this.state.hardwareModel = 'Windows PC';
      }
      return;
    }
    try {
      const { stdout } = await execFileAsync('sysctl', ['-n', 'hw.model'], { timeout: 1500 });
      this.state.hardwareModel = stdout.trim() || 'Mac';
    } catch {
      this.state.hardwareModel = 'Mac';
    }
    // Apple Silicon MacBook Air models (MacBookAir10,1, Mac14,2, Mac14,15, Mac15,12, Mac15,13, Mac16,12, Mac16,13) are fanless
    if (
      /MacBookAir10,1|Mac14,2|Mac14,15|Mac15,12|Mac15,13|Mac16,12|Mac16,13/i.test(this.state.hardwareModel)
    ) {
      this.state.fanless = true;
    }
  }

  private async readMacBatteryDetails(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('ioreg', ['-rn', 'AppleSmartBattery'], {
        timeout: 2200,
        maxBuffer: 512 * 1024,
      });

      const num = (key: string): number | null => {
        const m = stdout.match(new RegExp(`"${key}"\\s*=\\s*(-?\\d+)`));
        return m ? Number(m[1]) : null;
      };
      const bool = (key: string): boolean | null => {
        const m = stdout.match(new RegExp(`"${key}"\\s*=\\s*(Yes|No|true|false)`, 'i'));
        if (!m) return null;
        return /^yes|true$/i.test(m[1]);
      };

      const curCap = num('CurrentCapacity');
      const maxCap = num('AppleRawMaxCapacity') ?? num('NominalChargeCapacity') ?? num('MaxCapacity');
      const designCap = num('DesignCapacity');
      const cycles = num('CycleCount');
      const tempRaw = num('Temperature'); // centi-Celsius (e.g. 3120 = 31.2°C)
      const voltageMv = num('Voltage'); // mV
      const amperageMa = num('InstantAmperage') ?? num('Amperage'); // mA (signed 64-bit on Apple Silicon)
      const timeRem = num('TimeRemaining');
      const isCharging = bool('IsCharging');
      const extConnected = bool('ExternalConnected');

      if (curCap !== null && curCap >= 0 && curCap <= 100) {
        this.state.batteryPct = curCap;
      }
      if (isCharging !== null) this.state.isCharging = isCharging;
      if (extConnected !== null) this.state.acConnected = extConnected;
      if (cycles !== null && cycles >= 0) this.state.cycleCount = cycles;
      if (designCap !== null && designCap > 100) this.state.designCapacityMah = designCap;
      if (maxCap !== null && maxCap > 100) this.state.maxCapacityMah = maxCap;
      if (designCap && maxCap && designCap > 100 && maxCap > 100) {
        this.state.healthPct = Math.min(100, Math.round((maxCap / designCap) * 100));
      }
      if (tempRaw !== null && tempRaw > 500 && tempRaw < 9500) {
        this.state.batteryTempC = Number((tempRaw / 100).toFixed(1));
      }
      if (voltageMv !== null && voltageMv > 3000) {
        this.state.voltageV = Number((voltageMv / 1000).toFixed(2));
      }
      if (amperageMa !== null) {
        // Handle unsigned 64-bit wraparound for negative discharge currents
        const signedMa = amperageMa > 2_000_000_000 ? amperageMa - 18446744073709551616 : amperageMa;
        if (Math.abs(signedMa) < 20000) {
          this.state.amperageMa = Math.round(signedMa);
          if (this.state.voltageV) {
            this.state.powerDrawW = Number(((Math.abs(signedMa) * this.state.voltageV) / 1000).toFixed(1));
          }
        }
      }
      if (timeRem !== null && timeRem > 0 && timeRem < 3000) {
        this.state.timeRemainingMin = timeRem;
      } else {
        this.state.timeRemainingMin = null;
      }
    } catch {
      // Fallback handled by systeminformation
    }

    // Check macOS Low Power Mode & Thermal Pressure
    try {
      const { stdout } = await execFileAsync('pmset', ['-g'], { timeout: 1500 });
      const lpm = stdout.match(/lowpowermode\s+(\d+)/i);
      if (lpm) {
        this.state.lowPowerMode = lpm[1] === '1';
        this.state.powerProfile = this.state.lowPowerMode ? 'eco' : 'balanced';
      }
    } catch {
      // Ignore
    }

    try {
      const { stdout } = await execFileAsync('pmset', ['-g', 'therm'], { timeout: 1500 });
      const speedMatch = stdout.match(/CPU_Speed_Limit\s*=\s*(\d+)/i);
      if (speedMatch) {
        const limit = Number(speedMatch[1]);
        if (limit <= 50) this.state.thermalPressure = 'Critical';
        else if (limit <= 75) this.state.thermalPressure = 'Heavy';
        else if (limit < 100) this.state.thermalPressure = 'Moderate';
        else this.state.thermalPressure = 'Nominal';
      }
    } catch {
      // Ignore
    }
  }

  private async readMacSensors(): Promise<void> {
    // 1. Try osx-cpu-temp / smctemp / smc if installed
    for (const [cmd, args] of [
      ['smctemp', ['-c']],
      ['osx-cpu-temp', []],
    ] as const) {
      try {
        const { stdout } = await execFileAsync(cmd, [...args], { timeout: 1200 });
        const m = stdout.match(/(\d+(?:\.\d+)?)/);
        if (m) {
          const t = Number(m[1]);
          if (t > 15 && t < 115) {
            this.state.cpuTempC = Number(t.toFixed(1));
            break;
          }
        }
      } catch {
        // Not installed
      }
    }

    // 2. Read real Fan RPM via smc binary if present
    if (this.smcBin && !this.state.fanless) {
      try {
        const { stdout } = await execFileAsync(this.smcBin, ['-f'], { timeout: 1500 });
        const rpms: number[] = [];
        let maxRpm: number | null = null;
        for (const m of stdout.matchAll(/Actual speed\s*:\s*(\d+)/gi)) {
          rpms.push(Number(m[1]));
        }
        const maxM = stdout.match(/Maximum speed\s*:\s*(\d+)/i);
        if (maxM) maxRpm = Number(maxM[1]);
        if (rpms.length > 0) {
          this.state.fanRpm = rpms;
          this.state.fanMaxRpm = maxRpm;
          this.state.fanControlSupported = true;
          this.state.fanNote = `${rpms.length} active fan(s) · SMC control ready`;
        }
      } catch {
        // Ignore
      }
    }

    if (this.state.fanless) {
      this.state.fanRpm = [];
      this.state.fanControlSupported = false;
      this.state.fanNote = 'Fanless Passive Cooling (Apple Silicon Air) — use Eco/Low Power to cool';
    } else if (this.state.fanRpm.length === 0) {
      this.state.fanNote = 'macOS Auto Thermal Fan Control (install smcFanControl for manual RPM)';
    }

    // Estimate CPU temp from battery/chassis sensor + load if no direct SMC CPU sensor is available
    if (this.state.cpuTempC === null && this.state.batteryTempC !== null) {
      const load = os.loadavg()[0] || 0;
      const est = Math.min(98, this.state.batteryTempC + 10 + Math.min(28, load * 4.2));
      this.state.cpuTempC = Number(est.toFixed(1));
    }
    if (this.state.gpuTempC === null && this.state.cpuTempC !== null) {
      this.state.gpuTempC = Number(Math.max(25, this.state.cpuTempC - 3.5).toFixed(1));
    }
  }

  private async readWindowsSensors(): Promise<void> {
    try {
      const ps = `
$t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CurrentTemperature
if ($t) { Write-Output ("TEMP=" + [math]::Round(($t / 10) - 273.15, 1)) }
$scheme = (powercfg /getactivescheme) 2>$null
Write-Output ("SCHEME=" + $scheme)
$fans = @(Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | Where-Object { $_.DesiredSpeed -gt 0 } | Select-Object -ExpandProperty DesiredSpeed)
if ($fans.Count -gt 0) { Write-Output ("FANS=" + ($fans -join ',')) }
`;
      const out = await runPowerShell(ps, 3500);
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('TEMP=')) {
          const v = Number(line.slice(5).trim());
          if (Number.isFinite(v) && v > 15 && v < 115) this.state.cpuTempC = v;
        } else if (line.startsWith('SCHEME=')) {
          const s = line.slice(7).toLowerCase();
          if (s.includes('power saver') || s.includes('a1841308')) {
            this.state.lowPowerMode = true;
            this.state.powerProfile = 'eco';
          } else if (s.includes('high performance') || s.includes('8c5e7fda') || s.includes('ultimate')) {
            this.state.lowPowerMode = false;
            this.state.powerProfile = 'performance';
          } else {
            this.state.lowPowerMode = false;
            this.state.powerProfile = 'balanced';
          }
        } else if (line.startsWith('FANS=')) {
          const rpms = line
            .slice(5)
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((x) => Number.isFinite(x) && x > 0);
          if (rpms.length > 0) this.state.fanRpm = rpms;
        }
      }
    } catch {
      // Ignore
    }

    // NVIDIA GPU telemetry if present on Windows
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        ['--query-gpu=temperature.gpu,fan.speed,power.draw', '--format=csv,noheader,nounits'],
        { timeout: 2000 },
      );
      const parts = stdout
        .trim()
        .split(',')
        .map((s) => Number(s.trim()));
      if (Number.isFinite(parts[0])) this.state.gpuTempC = parts[0];
      if (Number.isFinite(parts[2]) && parts[2] > 0 && this.state.powerDrawW === null) {
        this.state.powerDrawW = Number(parts[2].toFixed(1));
      }
      if (Number.isFinite(parts[1])) {
        this.state.fanControlSupported = true;
        this.state.fanNote = `NVIDIA GPU Fan ${parts[1]}% · Windows Cooling Policy Ready`;
      }
    } catch {
      this.state.fanControlSupported = true;
      this.state.fanNote = 'Windows Active/Passive Cooling Policy & Power Plan Control';
    }
  }

  private evaluateAlerts(): void {
    const s = this.state;

    // 1. Charge Guard Alert (e.g. hit 80% while charging)
    if (s.hasBattery && s.chargeGuardEnabled && s.isCharging) {
      if (s.batteryPct >= s.chargeGuardPct && !this.chargeAlertFired) {
        this.chargeAlertFired = true;
        const msg = `🔋 Battery hit ${s.batteryPct}% (Guard: ${s.chargeGuardPct}%) — unplug to protect battery health!`;
        s.lastAlertMessage = msg;
        this.onAlert?.('warning', msg);
      }
    } else if (!s.isCharging || s.batteryPct < s.chargeGuardPct - 3) {
      this.chargeAlertFired = false;
    }

    // 2. Overheat Guard Alert
    const peakTemp = Math.max(s.cpuTempC ?? 0, s.gpuTempC ?? 0);
    if (s.overheatGuardEnabled && peakTemp >= s.overheatTempC) {
      if (!this.overheatAlertFired) {
        this.overheatAlertFired = true;
        const msg = `🔥 Thermal Alert: ${peakTemp}°C reached (Limit: ${s.overheatTempC}°C) — switch to Eco/Max Cool!`;
        s.lastAlertMessage = msg;
        this.onAlert?.('error', msg);
      }
    } else if (peakTemp < s.overheatTempC - 5) {
      this.overheatAlertFired = false;
    }

    // 3. Low Battery Guard Alert (<= 20% while discharging)
    if (s.hasBattery && s.lowBatteryGuardEnabled && !s.isCharging && s.batteryPct <= 20) {
      if (!this.lowBattAlertFired) {
        this.lowBattAlertFired = true;
        const msg = `⚡ Low Battery (${s.batteryPct}%) — plug in charger soon!`;
        s.lastAlertMessage = msg;
        this.onAlert?.('warning', msg);
      }
    } else if (s.isCharging || s.batteryPct > 24) {
      this.lowBattAlertFired = false;
    }
  }

  async refresh(): Promise<PowerThermalState> {
    if (this.polling) return this.state;
    this.polling = true;
    try {
      await this.readMacHardwareModel();

      const [batt, temp] = await Promise.all([
        si.battery().catch(() => null),
        si.cpuTemperature().catch(() => null),
      ]);

      if (batt) {
        this.state.hasBattery = Boolean(batt.hasBattery);
        if (typeof batt.percent === 'number' && batt.percent >= 0) {
          this.state.batteryPct = Math.round(batt.percent);
        }
        this.state.isCharging = Boolean(batt.isCharging);
        this.state.acConnected = Boolean(batt.acConnected);
        if (typeof batt.cycleCount === 'number' && batt.cycleCount > 0) {
          this.state.cycleCount = batt.cycleCount;
        }
        if (typeof batt.timeRemaining === 'number' && batt.timeRemaining > 0 && batt.timeRemaining < 3000) {
          this.state.timeRemainingMin = Math.round(batt.timeRemaining);
        }
        if (batt.designedCapacity && batt.maxCapacity && batt.designedCapacity > 0) {
          this.state.designCapacityMah = Math.round(batt.designedCapacity);
          this.state.maxCapacityMah = Math.round(batt.maxCapacity);
          this.state.healthPct = Math.min(100, Math.round((batt.maxCapacity / batt.designedCapacity) * 100));
        }
      }

      if (temp && typeof temp.main === 'number' && temp.main > 10) {
        this.state.cpuTempC = Number(temp.main.toFixed(1));
      }

      if (IS_WIN) {
        await this.readWindowsSensors();
      } else {
        await this.readMacBatteryDetails();
        await this.readMacSensors();
      }

      // Compute thermal pressure from peak temp if OS didn't report throttle
      const peak = Math.max(this.state.cpuTempC ?? 0, this.state.gpuTempC ?? 0);
      if (this.state.thermalPressure === 'Nominal' && peak > 0) {
        if (peak >= 92) this.state.thermalPressure = 'Critical';
        else if (peak >= 82) this.state.thermalPressure = 'Heavy';
        else if (peak >= 72) this.state.thermalPressure = 'Moderate';
      }

      if (this.state.autoPilot) {
        const s = this.state;
        if (batt?.hasBattery && !s.acConnected && !s.isCharging && s.batteryPct < 25) {
          if (!this.ecoAttempted && !s.lowPowerMode) {
            this.ecoAttempted = true;
            try {
              this.onAlert?.('success', await this.setPowerProfile('eco'));
            } catch (err) {
              this.onAlert?.('warning', (err as Error).message);
            }
          }
        } else this.ecoAttempted = false;
        const memory = await si.mem().catch(() => null);
        if (memory) {
          const previous = this.swapSample;
          const spike = previous && memory.swapused - previous.used >= 512 * 1024 ** 2;
          if (spike) this.onAlert?.('warning', 'Swap usage grew by at least 512 MB within one minute');
          if (!previous || spike || Date.now() - previous.ts >= 60000)
            this.swapSample = { used: memory.swapused, ts: Date.now() };
        }
      }
      this.state.updatedAt = Date.now();
      this.evaluateAlerts();
      this.emit();
    } finally {
      this.polling = false;
    }
    return this.state;
  }

  updateGuardConfig(cfg: {
    autoPilot?: boolean;
    chargeGuardEnabled?: boolean;
    chargeGuardPct?: number;
    overheatGuardEnabled?: boolean;
    overheatTempC?: number;
    lowBatteryGuardEnabled?: boolean;
  }): string {
    if (typeof cfg.autoPilot === 'boolean') {
      saveLocal('autopilot.json', cfg.autoPilot);
      this.state.autoPilot = cfg.autoPilot;
      this.ecoAttempted = false;
      this.swapSample = undefined;
    }
    if (typeof cfg.chargeGuardEnabled === 'boolean') {
      this.state.chargeGuardEnabled = cfg.chargeGuardEnabled;
      this.chargeAlertFired = false;
    }
    if (typeof cfg.chargeGuardPct === 'number') {
      this.state.chargeGuardPct = Math.max(50, Math.min(100, Math.round(cfg.chargeGuardPct)));
      this.chargeAlertFired = false;
    }
    if (typeof cfg.overheatGuardEnabled === 'boolean') {
      this.state.overheatGuardEnabled = cfg.overheatGuardEnabled;
      this.overheatAlertFired = false;
    }
    if (typeof cfg.overheatTempC === 'number') {
      this.state.overheatTempC = Math.max(65, Math.min(100, Math.round(cfg.overheatTempC)));
      this.overheatAlertFired = false;
    }
    if (typeof cfg.lowBatteryGuardEnabled === 'boolean') {
      this.state.lowBatteryGuardEnabled = cfg.lowBatteryGuardEnabled;
      this.lowBattAlertFired = false;
    }
    this.evaluateAlerts();
    this.emit();
    return `Guards updated (Charge ${this.state.chargeGuardPct}% · Heat ${this.state.overheatTempC}°C)`;
  }

  async setPowerProfile(profile: PowerProfile): Promise<string> {
    if (IS_WIN) {
      const guid =
        profile === 'eco'
          ? 'a1841308-3541-4fab-bc81-f71556f20b4a'
          : profile === 'performance'
            ? '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
            : '381b4222-f694-41f0-9685-ff5bb260df2e';
      try {
        await execFileAsync('powercfg', ['/setactive', guid], { timeout: 3000 });
        this.state.powerProfile = profile;
        this.state.lowPowerMode = profile === 'eco';
        this.emit();
        return `Windows Power Plan → ${profile.toUpperCase()}`;
      } catch {
        this.emit();
        throw Error('Windows could not activate the power plan. Check available plans and permissions.');
      }
    }

    // macOS: toggle Low Power Mode for eco vs balanced/performance
    const wantLowPower = profile === 'eco';
    try {
      await execFileAsync('pmset', ['-a', 'lowpowermode', wantLowPower ? '1' : '0'], {
        timeout: 2500,
      });
      this.state.powerProfile = profile;
      this.state.lowPowerMode = wantLowPower;
      this.emit();
      return `macOS Power Profile → ${wantLowPower ? 'ECO (Low Power ON)' : profile.toUpperCase()}`;
    } catch {
      // pmset -a requires sudo on macOS; open Battery settings pane or use osascript admin prompt?
      // Better: keep non-blocking and inform cleanly
      throw Error('macOS could not change Low Power Mode. Check power management permissions.');
    }
  }

  async setFanMode(mode: FanMode): Promise<string> {
    const applied = (message: string) => {
      this.state.fanMode = mode;
      this.emit();
      return message;
    };

    if (IS_WIN) {
      // Windows System Cooling Policy: 0 = Passive (Quiet), 1 = Active (Balanced/Max)
      const coolVal = mode === 'quiet' ? '0' : '1';
      try {
        await execFileAsync(
          'powercfg',
          ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'SYSCOOLPOL', coolVal],
          { timeout: 2500 },
        );
        await execFileAsync(
          'powercfg',
          ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'SYSCOOLPOL', coolVal],
          { timeout: 2500 },
        );
        await execFileAsync('powercfg', ['/setactive', 'SCHEME_CURRENT'], { timeout: 2000 });
        return applied(
          `Windows Cooling Policy → ${mode.toUpperCase()} (${coolVal === '1' ? 'Active Fan' : 'Passive Quiet'})`,
        );
      } catch {
        throw Error(
          'Windows could not apply the cooling policy. Check hardware support and administrator permissions.',
        );
      }
    }

    if (this.state.fanless) {
      if (mode === 'max' || mode === 'quiet') {
        await this.setPowerProfile('eco');
        return applied('Fanless Mac switched to the Eco power profile');
      }
      return applied('This Mac uses passive cooling');
    }

    if (this.smcBin) {
      try {
        if (mode === 'auto') {
          await execFileAsync(this.smcBin, ['-k', 'FS! ', '-w', '0000'], { timeout: 2000 });
          return applied('Mac fans returned to automatic control');
        }
        const max = this.state.fanMaxRpm || 5500;
        const targetRpm = mode === 'quiet' ? 2000 : mode === 'balanced' ? Math.round(max * 0.6) : max;
        const hex = (targetRpm << 2).toString(16).padStart(4, '0');
        await execFileAsync(this.smcBin, ['-k', 'F0Mn', '-w', hex], { timeout: 2000 });
        return applied(`Mac fan target → ${targetRpm} RPM (${mode.toUpperCase()})`);
      } catch {
        throw Error('The Mac could not apply the fan setting. Check SMC access.');
      }
    }

    throw Error('Direct RPM control requires a compatible Mac and an installed SMC utility.');
  }

  async runPowerAction(action: PowerAction): Promise<string> {
    if (action === 'low_power_toggle') {
      return this.setPowerProfile(this.state.lowPowerMode ? 'balanced' : 'eco');
    }

    if (action === 'lock') {
      await lockMacScreen();
      return IS_WIN ? 'Windows PC locked' : 'Mac screen locked';
    }

    if (action === 'display_sleep') {
      if (IS_WIN) {
        const ps = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Disp { [DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam); }'
[Disp]::SendMessage(-1, 0x0112, 0xF170, 2) | Out-Null
`;
        await runPowerShell(ps, 3000);
        return 'Display turned off (PC stays awake)';
      }
      await execFileAsync('pmset', ['displaysleepnow'], { timeout: 2500 });
      return 'Mac display asleep (background tasks keep running)';
    }

    if (action === 'sleep') {
      if (IS_WIN) {
        await runPowerShell(
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)',
          3000,
        );
        return 'Putting Windows PC to sleep…';
      }
      await execFileAsync('pmset', ['sleepnow'], { timeout: 2500 });
      return 'Putting Mac to sleep…';
    }

    if (action === 'restart') {
      if (IS_WIN) {
        await execFileAsync('shutdown', ['/r', '/t', '2'], { timeout: 2500 });
        return 'Restarting Windows PC in 2s…';
      }
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to restart'], {
        timeout: 3000,
      });
      return 'Restarting Mac…';
    }

    if (action === 'shutdown') {
      if (IS_WIN) {
        await execFileAsync('shutdown', ['/s', '/t', '2'], { timeout: 2500 });
        return 'Shutting down Windows PC in 2s…';
      }
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to shut down'], {
        timeout: 3000,
      });
      return 'Shutting down Mac…';
    }

    return 'Done';
  }
}
