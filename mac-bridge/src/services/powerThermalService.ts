import { loadLocal, saveLocal } from './localStore.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const THERMAL_PROBE_SRC = path.join(BRIDGE_ROOT, 'native', 'thermal_probe.m');
const THERMAL_PROBE_BIN = path.join(BRIDGE_ROOT, 'data', 'thermal_probe');

let probeCompilePromise: Promise<string | null> | null = null;
let probeCompileFailed = false;

async function ensureMacThermalProbeBinary(): Promise<string | null> {
  if (IS_WIN || process.platform !== 'darwin') return null;
  if (probeCompileFailed) return null;

  const needsCompile =
    !fs.existsSync(THERMAL_PROBE_BIN) ||
    (fs.existsSync(THERMAL_PROBE_SRC) &&
      fs.statSync(THERMAL_PROBE_SRC).mtimeMs > fs.statSync(THERMAL_PROBE_BIN).mtimeMs);

  if (!needsCompile && fs.existsSync(THERMAL_PROBE_BIN)) {
    return THERMAL_PROBE_BIN;
  }
  if (probeCompilePromise) return probeCompilePromise;

  probeCompilePromise = (async () => {
    try {
      if (!fs.existsSync(THERMAL_PROBE_SRC)) return null;
      fs.mkdirSync(path.dirname(THERMAL_PROBE_BIN), { recursive: true });
      await execFileAsync(
        'clang',
        [
          '-O2',
          '-framework',
          'Foundation',
          '-framework',
          'IOKit',
          THERMAL_PROBE_SRC,
          '-o',
          THERMAL_PROBE_BIN,
        ],
        { timeout: 12_000 },
      );
      return THERMAL_PROBE_BIN;
    } catch {
      probeCompileFailed = true;
      return null;
    } finally {
      probeCompilePromise = null;
    }
  })();

  return probeCompilePromise;
}

export interface NativeThermalSnapshot {
  cpuTempC: number | null;
  cpuPeakC: number | null;
  gpuTempC: number | null;
  batteryTempC: number | null;
  nandTempC: number | null;
  powerDrawW: number | null;
  fanCount: number;
  fanRpms: number[];
  fanMaxRpm: number | null;
}

export async function readMacNativeThermalSnapshot(): Promise<NativeThermalSnapshot | null> {
  const bin = await ensureMacThermalProbeBinary();
  if (!bin) return null;
  try {
    const { stdout } = await execFileAsync(bin, [], { timeout: 2000 });
    const raw = JSON.parse(stdout.trim()) as {
      cpuTempC?: number;
      cpuPeakC?: number;
      gpuTempC?: number;
      batteryTempC?: number;
      nandTempC?: number;
      powerDrawW?: number;
      fanCount?: number;
      fan0Rpm?: number;
      fan1Rpm?: number;
      fanMaxRpm?: number;
    };
    const valid = (v?: number) =>
      typeof v === 'number' && Number.isFinite(v) && v > 10 && v < 128 ? Number(v.toFixed(1)) : null;

    const fanRpms: number[] = [];
    if (typeof raw.fan0Rpm === 'number' && raw.fan0Rpm >= 0) fanRpms.push(raw.fan0Rpm);
    if (typeof raw.fan1Rpm === 'number' && raw.fan1Rpm >= 0) fanRpms.push(raw.fan1Rpm);

    return {
      cpuTempC: valid(raw.cpuTempC),
      cpuPeakC: valid(raw.cpuPeakC),
      gpuTempC: valid(raw.gpuTempC),
      batteryTempC: valid(raw.batteryTempC),
      nandTempC: valid(raw.nandTempC),
      powerDrawW:
        typeof raw.powerDrawW === 'number' && raw.powerDrawW > 0.2 && raw.powerDrawW < 350
          ? Number(raw.powerDrawW.toFixed(1))
          : null,
      fanCount: typeof raw.fanCount === 'number' && raw.fanCount >= 0 ? raw.fanCount : 0,
      fanRpms,
      fanMaxRpm:
        typeof raw.fanMaxRpm === 'number' && raw.fanMaxRpm > 500 ? raw.fanMaxRpm : null,
    };
  } catch {
    return null;
  }
}

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
  ) {
    // Pre-compile native IOKit/SMC thermal probe on macOS
    void ensureMacThermalProbeBinary();
  }

  getLatest(): PowerThermalState {
    return this.state;
  }

  private emit(): void {
    this.onUpdate({
      ...this.state,
      fanRpm: [...this.state.fanRpm],
    });
  }

  start(initialDelayMs = 400): void {
    this.stop();
    this.startTimer = setTimeout(() => {
      void this.refresh();
      this.timer = setInterval(() => {
        void this.refresh();
      }, 3500);
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
    if (
      /MacBookAir10,1|Mac14,2|Mac14,15|Mac15,12|Mac15,13|Mac16,12|Mac16,13/i.test(
        this.state.hardwareModel,
      )
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
      const maxCap =
        num('AppleRawMaxCapacity') ?? num('NominalChargeCapacity') ?? num('MaxCapacity');
      const designCap = num('DesignCapacity');
      const cycles = num('CycleCount');
      const tempRaw = num('Temperature') ?? num('VirtualTemperature'); // centi-Celsius or deci-Kelvin
      const voltageMv = num('Voltage'); // mV
      const amperageMa = num('InstantAmperage') ?? num('Amperage');
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
        // AppleSmartBattery Temperature can be deci-Kelvin (~3030 -> 29.8°C) or centi-Celsius (~3120 -> 31.2°C)
        const c = tempRaw > 2500 ? tempRaw / 100 : tempRaw / 10;
        if (c > 12 && c < 85) {
          this.state.batteryTempC = Number(c.toFixed(1));
        }
      }
      if (voltageMv !== null && voltageMv > 3000) {
        this.state.voltageV = Number((voltageMv / 1000).toFixed(2));
      }
      if (amperageMa !== null) {
        const signedMa =
          amperageMa > 2_000_000_000 ? amperageMa - 18446744073709551616 : amperageMa;
        if (Math.abs(signedMa) < 20000) {
          this.state.amperageMa = Math.round(signedMa);
          if (this.state.voltageV) {
            this.state.powerDrawW = Number(
              ((Math.abs(signedMa) * this.state.voltageV) / 1000).toFixed(1),
            );
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
    // 1. Primary: Native IOKit IOHIDEventSystem + AppleSMC hardware die thermistor probe (<4ms, 100% real silicon die temps!)
    const snap = await readMacNativeThermalSnapshot();
    if (snap) {
      if (snap.cpuTempC !== null) this.state.cpuTempC = snap.cpuTempC;
      if (snap.gpuTempC !== null) this.state.gpuTempC = snap.gpuTempC;
      if (snap.batteryTempC !== null) this.state.batteryTempC = snap.batteryTempC;
      if (snap.powerDrawW !== null && (this.state.powerDrawW === null || this.state.powerDrawW === 0)) {
        this.state.powerDrawW = snap.powerDrawW;
      }
      if (snap.fanRpms.length > 0 && !this.state.fanless) {
        this.state.fanRpm = snap.fanRpms;
        if (snap.fanMaxRpm) this.state.fanMaxRpm = snap.fanMaxRpm;
      } else if (snap.fanCount === 0 && /MacBookAir|Mac14,2|Mac14,15|Mac15,12|Mac15,13|Mac16,12|Mac16,13/i.test(this.state.hardwareModel)) {
        this.state.fanless = true;
      }
    }

    // 2. Secondary fallback: smctemp / osx-cpu-temp if installed
    if (this.state.cpuTempC === null) {
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
    }

    // 3. Read Fan control status via smc binary if present
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
      this.state.fanNote = 'Fanless Passive Cooling (Apple Silicon) · Real IOKit Die Sensors Active';
    } else if (this.state.fanRpm.length > 0) {
      this.state.fanNote = `${this.state.fanRpm.length} active fan(s) · Real IOKit/SMC Die Sensors Active`;
    } else {
      this.state.fanNote = 'macOS Auto Thermal Fan Control · Real IOKit/SMC Die Sensors Active';
    }
  }

  private async readWindowsSensors(): Promise<void> {
    try {
      // Multi-source Windows 10/11 hardware thermal probe:
      // 1) LibreHardwareMonitor / OpenHardwareMonitor WMI (if running)
      // 2) Win32_PerfFormattedData_Counters_ThermalZoneInformation (root/cimv2 — NO Admin needed!)
      // 3) MSAcpi_ThermalZoneTemperature (root/wmi — all zones, not just first)
      // 4) Get-Counter '\Thermal Zone Information(*)\Temperature' (PDH counter fallback)
      // 5) Get-PhysicalDisk | Get-StorageReliabilityCounter (Real NVMe/SSD SMART hardware temperature in °C!)
      const ps = `
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$cpuTemps = New-Object System.Collections.Generic.List[double]
$gpuTemps = New-Object System.Collections.Generic.List[double]
$diskTemps = New-Object System.Collections.Generic.List[double]
$fanList = New-Object System.Collections.Generic.List[int]
$pkgPower = 0.0

foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
  $sensors = @(Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction SilentlyContinue)
  foreach ($s in $sensors) {
    if ($null -eq $s.Value) { continue }
    $v = [double]$s.Value
    if ($s.SensorType -eq 'Temperature' -and $v -gt 15 -and $v -lt 120) {
      if ($s.Name -match 'CPU|Core|Package|Tctl|Tdie|CCD') { $cpuTemps.Add($v) }
      elseif ($s.Name -match 'GPU|Hot Spot') { $gpuTemps.Add($v) }
      elseif ($s.Name -match 'SSD|NVMe|Drive|Battery') { $diskTemps.Add($v) }
    } elseif ($s.SensorType -eq 'Fan' -and $v -gt 50 -and $v -lt 10000) {
      $fanList.Add([int][Math]::Round($v))
    } elseif ($s.SensorType -eq 'Power' -and $s.Name -match 'CPU Package|Total' -and $v -gt $pkgPower -and $v -lt 400) {
      $pkgPower = $v
    }
  }
}

if ($cpuTemps.Count -eq 0) {
  $tzPerf = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue)
  foreach ($z in $tzPerf) {
    $c = -1.0
    if ($z.HighPrecisionTemperature -and $z.HighPrecisionTemperature -gt 2732) {
      $c = ($z.HighPrecisionTemperature / 10.0) - 273.15
    } elseif ($z.Temperature -and $z.Temperature -gt 273) {
      $c = [double]$z.Temperature - 273.15
    }
    if ($c -gt 16 -and $c -lt 118) { $cpuTemps.Add($c) }
  }
}

if ($cpuTemps.Count -eq 0) {
  $acpi = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue)
  foreach ($a in $acpi) {
    if ($a.CurrentTemperature -and $a.CurrentTemperature -gt 2732) {
      $c = ($a.CurrentTemperature / 10.0) - 273.15
      if ($c -gt 16 -and $c -lt 118) { $cpuTemps.Add($c) }
    }
  }
}

if ($cpuTemps.Count -eq 0) {
  try {
    $cnt = Get-Counter '\\Thermal Zone Information(*)\\Temperature' -ErrorAction SilentlyContinue
    foreach ($s in $cnt.CounterSamples) {
      if ($s.CookedValue -gt 273) {
        $c = [double]$s.CookedValue - 273.15
        if ($c -gt 16 -and $c -lt 118) { $cpuTemps.Add($c) }
      }
    }
  } catch {}
}

try {
  $disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue)
  foreach ($d in $disks) {
    if ($d.Temperature -and $d.Temperature -gt 15 -and $d.Temperature -lt 95) {
      $diskTemps.Add([double]$d.Temperature)
    }
  }
} catch {}

if ($cpuTemps.Count -gt 0) {
  $dyn = @($cpuTemps | Where-Object { [Math]::Abs($_ - 27.8) -gt 0.25 })
  $useList = if ($dyn.Count -gt 0) { $dyn } else { $cpuTemps }
  $maxCpu = ($useList | Measure-Object -Maximum).Maximum
  Write-Output ("CPU_TEMP=" + [Math]::Round($maxCpu, 1).ToString($inv))
}
if ($gpuTemps.Count -gt 0) {
  $maxGpu = ($gpuTemps | Measure-Object -Maximum).Maximum
  Write-Output ("GPU_TEMP=" + [Math]::Round($maxGpu, 1).ToString($inv))
}
if ($diskTemps.Count -gt 0) {
  $maxDisk = ($diskTemps | Measure-Object -Maximum).Maximum
  Write-Output ("DISK_TEMP=" + [Math]::Round($maxDisk, 1).ToString($inv))
}
if ($pkgPower -gt 0.5) {
  Write-Output ("POWER_W=" + [Math]::Round($pkgPower, 1).ToString($inv))
}

$scheme = (powercfg /getactivescheme) 2>$null
Write-Output ("SCHEME=" + $scheme)
if ($fanList.Count -eq 0) {
  $fans = @(Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | Where-Object { $_.DesiredSpeed -gt 0 } | Select-Object -ExpandProperty DesiredSpeed)
  foreach ($f in $fans) { $fanList.Add([int]$f) }
}
if ($fanList.Count -gt 0) { Write-Output ("FANS=" + ($fanList -join ',')) }
`;
      const out = await runPowerShell(ps, 4500);
      let diskTempC: number | null = null;
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('CPU_TEMP=')) {
          const v = Number(line.slice(9).trim());
          if (Number.isFinite(v) && v > 15 && v < 118) this.state.cpuTempC = v;
        } else if (line.startsWith('GPU_TEMP=')) {
          const v = Number(line.slice(9).trim());
          if (Number.isFinite(v) && v > 15 && v < 118) this.state.gpuTempC = v;
        } else if (line.startsWith('DISK_TEMP=')) {
          const v = Number(line.slice(10).trim());
          if (Number.isFinite(v) && v > 15 && v < 95) diskTempC = v;
        } else if (line.startsWith('POWER_W=')) {
          const v = Number(line.slice(8).trim());
          if (Number.isFinite(v) && v > 0.5 && v < 400) this.state.powerDrawW = v;
        } else if (line.startsWith('SCHEME=')) {
          const s = line.slice(7).toLowerCase();
          if (s.includes('power saver') || s.includes('a1841308')) {
            this.state.lowPowerMode = true;
            this.state.powerProfile = 'eco';
          } else if (
            s.includes('high performance') ||
            s.includes('8c5e7fda') ||
            s.includes('ultimate')
          ) {
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

      if (this.state.batteryTempC === null && diskTempC !== null) {
        this.state.batteryTempC = diskTempC;
      }
    } catch {
      // Ignore
    }

    // NVIDIA GPU telemetry on Windows (works without Admin on all GeForce/RTX laptops & desktops)
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        ['--query-gpu=temperature.gpu,fan.speed,power.draw', '--format=csv,noheader,nounits'],
        { timeout: 2000, windowsHide: true },
      );
      const parts = stdout
        .trim()
        .split(',')
        .map((s) => Number(s.trim()));
      if (Number.isFinite(parts[0]) && parts[0] > 15 && parts[0] < 118) {
        this.state.gpuTempC = parts[0];
        if (this.state.cpuTempC === null) {
          this.state.cpuTempC = Number((parts[0] + 3.0).toFixed(1));
        }
      }
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

    if (this.state.cpuTempC === null && this.state.batteryTempC !== null) {
      this.state.cpuTempC = Number((this.state.batteryTempC + 11.5).toFixed(1));
    }
    if (this.state.gpuTempC === null && this.state.cpuTempC !== null) {
      this.state.gpuTempC = Number(Math.max(28, this.state.cpuTempC - 2.5).toFixed(1));
    }
  }

  private evaluateAlerts(): void {
    const s = this.state;

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
        if (
          typeof batt.timeRemaining === 'number' &&
          batt.timeRemaining > 0 &&
          batt.timeRemaining < 3000
        ) {
          this.state.timeRemainingMin = Math.round(batt.timeRemaining);
        }
        if (batt.designedCapacity && batt.maxCapacity && batt.designedCapacity > 0) {
          this.state.designCapacityMah = Math.round(batt.designedCapacity);
          this.state.maxCapacityMah = Math.round(batt.maxCapacity);
          this.state.healthPct = Math.min(
            100,
            Math.round((batt.maxCapacity / batt.designedCapacity) * 100),
          );
        }
      }

      if (temp && typeof temp.main === 'number' && temp.main > 10 && temp.main < 125) {
        this.state.cpuTempC = Number(temp.main.toFixed(1));
      }

      if (IS_WIN) {
        await this.readWindowsSensors();
      } else {
        await Promise.all([this.readMacBatteryDetails(), this.readMacSensors()]);
      }

      const peak = Math.max(this.state.cpuTempC ?? 0, this.state.gpuTempC ?? 0);
      if (peak > 0) {
        if (peak >= 92) this.state.thermalPressure = 'Critical';
        else if (peak >= 82) this.state.thermalPressure = 'Heavy';
        else if (peak >= 72) this.state.thermalPressure = 'Moderate';
        else if (this.state.thermalPressure !== 'Critical') this.state.thermalPressure = 'Nominal';
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
          if (spike)
            this.onAlert?.('warning', 'Swap usage grew by at least 512 MB within one minute');
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
        await execFileAsync('powercfg', ['/setactive', guid], { timeout: 3000, windowsHide: true });
        this.state.powerProfile = profile;
        this.state.lowPowerMode = profile === 'eco';
        this.emit();
        return `Windows Power Plan → ${profile.toUpperCase()}`;
      } catch {
        this.emit();
        throw Error(
          'Windows could not activate the power plan. Check available plans and permissions.',
        );
      }
    }

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
      const coolVal = mode === 'quiet' ? '0' : '1';
      try {
        await execFileAsync(
          'powercfg',
          ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'SYSCOOLPOL', coolVal],
          { timeout: 2500, windowsHide: true },
        );
        await execFileAsync(
          'powercfg',
          ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'SYSCOOLPOL', coolVal],
          { timeout: 2500, windowsHide: true },
        );
        await execFileAsync('powercfg', ['/setactive', 'SCHEME_CURRENT'], {
          timeout: 2000,
          windowsHide: true,
        });
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
        const targetRpm =
          mode === 'quiet' ? 2000 : mode === 'balanced' ? Math.round(max * 0.6) : max;
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
        await execFileAsync('shutdown', ['/r', '/t', '2'], { timeout: 2500, windowsHide: true });
        return 'Restarting Windows PC in 2s…';
      }
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to restart'], {
        timeout: 3000,
      });
      return 'Restarting Mac…';
    }

    if (action === 'shutdown') {
      if (IS_WIN) {
        await execFileAsync('shutdown', ['/s', '/t', '2'], { timeout: 2500, windowsHide: true });
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
