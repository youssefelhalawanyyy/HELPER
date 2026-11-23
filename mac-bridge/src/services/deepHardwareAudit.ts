import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type { DoctorIssue } from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export interface DeepAuditResult {
  issues: DoctorIssue[];
  scorePenalty: number;
  terminalNotes: string[];
}

function fastFolderSizeGb(targetPath: string, maxFiles = 2500): number {
  let bytes = 0;
  let files = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || files > maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files > maxFiles) break;
      const full = path.join(dir, e.name);
      try {
        if (e.isFile()) {
          bytes += fs.statSync(full).size;
          files += 1;
        } else if (e.isDirectory() && !e.isSymbolicLink()) {
          walk(full, depth + 1);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  };
  if (fs.existsSync(targetPath)) walk(targetPath, 0);
  return Number((bytes / 1024 ** 3).toFixed(1));
}

export async function runDeepHardwareAndSoftwareAudit(
  procs: Array<{ name: string; cpu: number; mem: number; pid: number }>,
): Promise<DeepAuditResult> {
  const issues: DoctorIssue[] = [];
  const terminalNotes: string[] = [];
  let scorePenalty = 0;

  // Run independent hardware/OS checks in parallel
  const [tempData, battData, diskLayout, osExtra] = await Promise.all([
    si.cpuTemperature().catch(() => ({ main: null as number | null, max: null as number | null })),
    si.battery().catch(() => ({
      hasBattery: false,
      designedCapacity: 0,
      maxCapacity: 0,
      cycleCount: 0,
      percent: 100,
      isCharging: false,
    })),
    si.diskLayout().catch(() => []),
    IS_WIN ? inspectWindowsDeep() : inspectMacDeep(),
  ]);

  // 1. Overheating / Thermal Throttling
  const cpuTemp = tempData.main || tempData.max || osExtra.cpuTempC;
  if ((cpuTemp && cpuTemp >= 82) || osExtra.thermalThrottled) {
    const crit = Boolean((cpuTemp && cpuTemp >= 92) || osExtra.thermalThrottled);
    scorePenalty += crit ? 18 : 10;
    issues.push({
      id: 'thermal',
      severity: crit ? 'critical' : 'warning',
      category: 'cpu',
      title: osExtra.thermalThrottled
        ? 'CPU Thermal Throttling Active'
        : `High CPU Temperature (${Math.round(cpuTemp || 0)}°C)`,
      plainEnglish: osExtra.thermalThrottled
        ? `Your computer is actively throttling CPU speed (${osExtra.thermalNote}) to prevent overheating. Dust-clogged vents, blocked airflow, or heavy background apps are causing severe slowdown.`
        : `Your processor is running hot at ${Math.round(cpuTemp || 0)}°C. High heat forces the CPU to cut clock speed by 50–70% and can trigger sudden shutdowns.`,
      impact: '50–70% CPU speed drop & loud fans',
      fixAction: 'free_ram',
      fixLabel: 'Ease Load',
    });
    terminalNotes.push(`⚠ Thermal: ${osExtra.thermalNote || `${Math.round(cpuTemp || 0)}°C`}`);
  } else {
    terminalNotes.push(
      `Thermal OK${cpuTemp ? ` (${Math.round(cpuTemp)}°C)` : ' (No throttling detected)'}`,
    );
  }

  // 2. Dying SSD / Hard Drive (SMART / Bad Sectors)
  const failingDisk = diskLayout.find(
    (d) => d.smartStatus && !/ok|verified|unknown/i.test(d.smartStatus),
  );
  if (failingDisk || osExtra.unhealthyDiskNote) {
    scorePenalty += 28;
    issues.push({
      id: 'smart-disk',
      severity: 'critical',
      category: 'disk',
      title: 'Failing SSD / Drive Health Warning',
      plainEnglish:
        osExtra.unhealthyDiskNote ||
        `Drive "${failingDisk?.name}" reported SMART status "${failingDisk?.smartStatus}". A failing drive causes 100% disk freezes, corrupted files, and sudden crashes — back up your files immediately!`,
      impact: 'Extreme freezes & data loss risk',
      fixAction: 'verify_system_files',
      fixLabel: 'Verify Drive',
    });
    terminalNotes.push(`❌ Drive SMART warning: ${osExtra.unhealthyDiskNote || failingDisk?.smartStatus}`);
  }

  // 3. Degraded Battery Health (< 78%)
  let battHealthPct: number | null = osExtra.batteryHealthPct;
  if (battHealthPct === null && battData.hasBattery && battData.designedCapacity > 0 && battData.maxCapacity > 0) {
    battHealthPct = Math.min(100, Math.round((battData.maxCapacity / battData.designedCapacity) * 100));
  }
  if (battHealthPct !== null && battHealthPct < 78) {
    scorePenalty += battHealthPct < 65 ? 12 : 7;
    issues.push({
      id: 'battery-health',
      severity: battHealthPct < 65 ? 'critical' : 'warning',
      category: 'cpu',
      title: `Degraded Laptop Battery (${battHealthPct}% Health)`,
      plainEnglish: `Your laptop battery capacity has worn down to ${battHealthPct}%. Worn batteries or weak chargers cause ${IS_WIN ? 'Windows' : 'macOS'} to throttle CPU performance to prevent sudden power-offs.`,
      impact: 'CPU power throttling & short battery life',
    });
    terminalNotes.push(`⚠ Battery Health: ${battHealthPct}%`);
  }

  // 4. Power Plan Set to Power Saver / Low Power Mode
  if (osExtra.lowPowerMode) {
    scorePenalty += 10;
    issues.push({
      id: 'power-plan',
      severity: 'warning',
      category: 'cpu',
      title: IS_WIN ? 'Power Plan Set to "Power Saver"' : 'macOS Low Power Mode Enabled',
      plainEnglish: IS_WIN
        ? 'Your Windows power plan is set to Power Saver, which artificially caps CPU speed even when plugged in. Switching to Balanced or High Performance gives an instant speed boost.'
        : 'macOS Low Power Mode is turned ON, reducing CPU/GPU clock speeds and screen responsiveness.',
      impact: 'Artificially capped CPU speed',
    });
    terminalNotes.push('⚠ Power Mode: Power Saver / Low Power Mode is active');
  }

  // 5. Broken GPU / Chipset Drivers (Windows Device Manager Errors)
  if (osExtra.brokenDriverCount > 0) {
    scorePenalty += 18;
    issues.push({
      id: 'drivers',
      severity: 'critical',
      category: 'corruption',
      title: `${osExtra.brokenDriverCount} Broken / Error Hardware Driver(s)`,
      plainEnglish: `Windows Device Manager reports hardware driver errors (${osExtra.brokenDriverNames || 'GPU/Chipset/Device'}). Broken drivers are the #1 cause of Windows Blue Screens (BSOD) and choppy graphics.`,
      impact: 'Blue Screens (BSOD) & choppy UI',
      fixAction: 'verify_system_files',
      fixLabel: 'Repair OS',
    });
    terminalNotes.push(`❌ Broken Drivers (${osExtra.brokenDriverCount}): ${osExtra.brokenDriverNames}`);
  }

  // 6. Two Antivirus Programs Fighting Each Other (Windows)
  if (osExtra.avProducts.length >= 2) {
    scorePenalty += 14;
    issues.push({
      id: 'av-conflict',
      severity: 'warning',
      category: 'security',
      title: `Multiple Antivirus Engines Detected (${osExtra.avProducts.length})`,
      plainEnglish: `Found ${osExtra.avProducts.join(' + ')} registered at the same time. Running two antivirus programs together causes them to scan every file twice, creating severe disk lag and freezes.`,
      impact: 'Constant 100% disk lag & freezes',
    });
    terminalNotes.push(`⚠ AV Conflict: ${osExtra.avProducts.join(', ')}`);
  }

  // 7. Stuck Windows Update / Broken Spotlight Indexing
  const indexerProcs = procs.filter((p) =>
    /^(mds_stores|mds|mdworker|searchindexer|tiworker|trustedinstaller|wuauclt|usocoreworker)(\.exe)?$/i.test(
      p.name,
    ),
  );
  const indexerCpu = Math.round(indexerProcs.reduce((sum, p) => sum + (p.cpu || 0), 0));
  if (indexerCpu >= 20) {
    scorePenalty += 12;
    issues.push({
      id: 'indexer-stuck',
      severity: 'warning',
      category: 'cpu',
      title: IS_WIN
        ? `Windows Update / Search Indexer Heavy (${indexerCpu}% CPU)`
        : `macOS Spotlight Indexing Heavy (${indexerCpu}% CPU)`,
      plainEnglish: IS_WIN
        ? `Background Windows Update or Search Indexing is using ${indexerCpu}% CPU right now. When stuck, it slows down file opening and makes the whole PC feel sluggish.`
        : `macOS Spotlight (mds_stores) is using ${indexerCpu}% CPU re-indexing files, causing lag and battery drain.`,
      impact: 'Heavy background CPU & disk drag',
      fixAction: 'free_ram',
      fixLabel: 'Trim Load',
    });
    terminalNotes.push(`⚠ Background Indexer/Updater using ${indexerCpu}% CPU`);
  }

  // 8. Browser Bloat (Chrome / Edge / Safari / Arc / Firefox)
  const browserProcs = procs.filter((p) =>
    /chrome|msedge|safari|firefox|arc|brave|opera/i.test(p.name),
  );
  const browserMemPct = Math.round(browserProcs.reduce((sum, p) => sum + (p.mem || 0), 0));
  if (browserMemPct >= 25 || browserProcs.length >= 28) {
    scorePenalty += browserMemPct >= 40 ? 12 : 6;
    issues.push({
      id: 'browser-bloat',
      severity: browserMemPct >= 40 ? 'critical' : 'warning',
      category: 'memory',
      title: `Browser Bloat (${browserProcs.length} Processes · ${browserMemPct}% RAM)`,
      plainEnglish: `Your web browser has ${browserProcs.length} active tab/extension processes eating ~${browserMemPct}% of your total RAM. Too many open tabs or heavy extensions cause severe memory leaks and stuttering.`,
      impact: 'Major RAM drain & sluggish switching',
      fixAction: 'free_ram',
      fixLabel: 'Trim RAM',
    });
    terminalNotes.push(`⚠ Browser Bloat: ${browserProcs.length} procs (~${browserMemPct}% RAM)`);
  }

  // 9. Faulty RAM / Kernel Panic / BSOD Crash Signatures
  if (osExtra.hardwareCrashCount > 0) {
    scorePenalty += 16;
    issues.push({
      id: 'ram-bsod',
      severity: 'critical',
      category: 'crashes',
      title: `${osExtra.hardwareCrashCount} Critical Kernel Panic / BSOD Crash(es)`,
      plainEnglish: IS_WIN
        ? `Windows logged ${osExtra.hardwareCrashCount} unexpected shutdown / Blue Screen (Event 41/1001) event(s) recently. Common causes are faulty RAM sticks, broken GPU drivers, or overheating.`
        : `macOS logged ${osExtra.hardwareCrashCount} Kernel Panic / Watchdog crash(es) recently. This usually indicates severe low-disk starvation, a bad kernel extension, or hardware/RAM instability.`,
      impact: 'Sudden reboots & data loss risk',
      fixAction: 'verify_system_files',
      fixLabel: 'Verify OS',
    });
    terminalNotes.push(`❌ Hardware/Kernel Crash Events: ${osExtra.hardwareCrashCount}`);
  }

  // 10. Huge Hidden Storage Hogs (Downloads / Caches / Docker / Xcode)
  const home = os.homedir();
  const candidates = IS_WIN
    ? [
        { label: 'Downloads', p: path.join(home, 'Downloads') },
        { label: 'AppData Temp', p: path.join(home, 'AppData', 'Local', 'Temp') },
        { label: 'Docker Data', p: path.join(home, 'AppData', 'Local', 'Docker') },
        { label: 'npm Cache', p: path.join(home, 'AppData', 'Local', 'npm-cache') },
      ]
    : [
        { label: 'Downloads', p: path.join(home, 'Downloads') },
        { label: 'Library Caches', p: path.join(home, 'Library', 'Caches') },
        { label: 'Xcode DerivedData', p: path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData') },
        { label: 'Docker Containers', p: path.join(home, 'Library', 'Containers', 'com.docker.docker') },
        { label: 'npm Cache', p: path.join(home, '.npm') },
      ];

  const heavyFolders = candidates
    .map((c) => ({ label: c.label, gb: fastFolderSizeGb(c.p, 1800) }))
    .filter((f) => f.gb >= 2.0)
    .sort((a, b) => b.gb - a.gb)
    .slice(0, 3);

  if (heavyFolders.length > 0) {
    const totalGb = heavyFolders.reduce((s, f) => s + f.gb, 0).toFixed(1);
    scorePenalty += Number(totalGb) >= 15 ? 10 : 5;
    const listStr = heavyFolders.map((f) => `${f.label} (${f.gb} GB)`).join(', ');
    issues.push({
      id: 'heavy-folders',
      severity: Number(totalGb) >= 15 ? 'warning' : 'warning',
      category: 'disk',
      title: `Large Space-Eating Folders (${totalGb} GB Found)`,
      plainEnglish: `Detected huge folders eating your drive: ${listStr}. Cleaning unused caches, old downloads, or Docker/Xcode build files will free gigabytes immediately.`,
      impact: `${totalGb} GB reclaimable space`,
      fixAction: 'clean_junk',
      fixLabel: 'Clean Junk',
    });
    terminalNotes.push(`⚠ Heavy Folders: ${listStr}`);
  }

  return { issues, scorePenalty, terminalNotes };
}

interface OsExtraAudit {
  cpuTempC: number | null;
  thermalThrottled: boolean;
  thermalNote: string;
  unhealthyDiskNote: string;
  batteryHealthPct: number | null;
  lowPowerMode: boolean;
  brokenDriverCount: number;
  brokenDriverNames: string;
  avProducts: string[];
  hardwareCrashCount: number;
}

async function inspectMacDeep(): Promise<OsExtraAudit> {
  const out: OsExtraAudit = {
    cpuTempC: null,
    thermalThrottled: false,
    thermalNote: '',
    unhealthyDiskNote: '',
    batteryHealthPct: null,
    lowPowerMode: false,
    brokenDriverCount: 0,
    brokenDriverNames: '',
    avProducts: [],
    hardwareCrashCount: 0,
  };

  await Promise.all([
    // Thermal throttling check
    execFileAsync('pmset', ['-g', 'therm'], { timeout: 2000 })
      .then(({ stdout }) => {
        const m = stdout.match(/CPU_Speed_Limit\s*=\s*(\d+)/i);
        if (m) {
          const limit = Number(m[1]);
          if (limit > 0 && limit < 95) {
            out.thermalThrottled = true;
            out.thermalNote = `CPU_Speed_Limit=${limit}%`;
          }
        }
      })
      .catch(() => {}),

    // Low Power Mode check
    execFileAsync('pmset', ['-g'], { timeout: 2000 })
      .then(({ stdout }) => {
        if (/lowpowermode\s+1/i.test(stdout)) {
          out.lowPowerMode = true;
        }
      })
      .catch(() => {}),

    // Battery max capacity health
    execFileAsync('system_profiler', ['SPPowerDataType', '-json'], {
      timeout: 3500,
      maxBuffer: 2 * 1024 * 1024,
    })
      .then(({ stdout }) => {
        const m = stdout.match(/"sppower_battery_health_maximum_capacity"\s*:\s*"(\d+)/);
        if (m) out.batteryHealthPct = Number(m[1]);
      })
      .catch(() => {}),
  ]);

  // Kernel panic logs in /Library/Logs/DiagnosticReports (last 14 days)
  try {
    const sysDiag = '/Library/Logs/DiagnosticReports';
    const twoWeeksAgo = Date.now() - 14 * 24 * 3600 * 1000;
    if (fs.existsSync(sysDiag)) {
      for (const f of fs.readdirSync(sysDiag)) {
        if (/panic|kernel|watchdog/i.test(f)) {
          const st = fs.statSync(path.join(sysDiag, f));
          if (st.mtimeMs >= twoWeeksAgo) out.hardwareCrashCount += 1;
        }
      }
    }
  } catch {
    // Ignore
  }

  return out;
}

async function inspectWindowsDeep(): Promise<OsExtraAudit> {
  const out: OsExtraAudit = {
    cpuTempC: null,
    thermalThrottled: false,
    thermalNote: '',
    unhealthyDiskNote: '',
    batteryHealthPct: null,
    lowPowerMode: false,
    brokenDriverCount: 0,
    brokenDriverNames: '',
    avProducts: [],
    hardwareCrashCount: 0,
  };

  const ps = `
$scheme = (powercfg /getactivescheme 2>$null | Out-String)
$isSaver = $scheme -match 'Power saver|a1841308-3541-4fab-bc81-f71556f20b4a'
$badDrv = @(Get-PnpDevice -Status Error -ErrorAction SilentlyContinue | Select-Object -First 4 -ExpandProperty FriendlyName)
$avs = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object -ExpandProperty displayName -Unique)
$badDisk = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.HealthStatus -ne 'Healthy' } | Select-Object -First 2 | ForEach-Object { $_.FriendlyName + ' (' + $_.HealthStatus + ')' })
$since = (Get-Date).AddDays(-14)
$bsods = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,1001; StartTime=$since} -MaxEvents 10 -ErrorAction SilentlyContinue)
Write-Output ("SAVER=" + $isSaver)
Write-Output ("BADDRV=" + ($badDrv -join ', '))
Write-Output ("BADDRV_CNT=" + $badDrv.Count)
Write-Output ("AVS=" + ($avs -join '||'))
Write-Output ("BADDISK=" + ($badDisk -join ', '))
Write-Output ("BSOD=" + $bsods.Count)
`;
  try {
    const res = await runPowerShell(ps, 7000);
    for (const line of res.split(/\r?\n/)) {
      if (line.startsWith('SAVER=')) out.lowPowerMode = /true/i.test(line);
      else if (line.startsWith('BADDRV=')) out.brokenDriverNames = line.slice(7).trim();
      else if (line.startsWith('BADDRV_CNT=')) out.brokenDriverCount = Number(line.slice(11)) || 0;
      else if (line.startsWith('AVS=')) {
        out.avProducts = line
          .slice(4)
          .split('||')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (line.startsWith('BADDISK=')) out.unhealthyDiskNote = line.slice(8).trim();
      else if (line.startsWith('BSOD=')) out.hardwareCrashCount = Number(line.slice(5)) || 0;
    }
  } catch {
    // Ignore
  }

  return out;
}
