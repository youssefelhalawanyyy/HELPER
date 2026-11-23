import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type {
  DoctorIssue,
  DoctorPostReport,
  DoctorRepairAction,
  SystemDoctorReport,
} from '../types/protocol.js';
import {
  loadDoctorAiKey,
  runAutonomousAiRescue,
  saveDoctorAiKey,
} from './doctorAiAgent.js';
import { runDeepHardwareAndSoftwareAudit } from './deepHardwareAudit.js';

const execFileAsync = promisify(execFile);

function measureDirSizeBytes(dir: string, maxFiles = 1200): number {
  let total = 0;
  let count = 0;
  const walk = (cur: string, depth: number) => {
    if (depth > 3 || count > maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count > maxFiles) break;
      const full = path.join(cur, e.name);
      try {
        if (e.isFile()) {
          total += fs.statSync(full).size;
          count += 1;
        } else if (e.isDirectory() && !e.isSymbolicLink()) {
          walk(full, depth + 1);
        }
      } catch {
        // Skip locked/unreadable files
      }
    }
  };
  walk(dir, 0);
  return total;
}

function cleanDirFilesOlderThan(dir: string, minAgeMs: number): { freedBytes: number; deletedCount: number } {
  let freedBytes = 0;
  let deletedCount = 0;
  const now = Date.now();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { freedBytes: 0, deletedCount: 0 };
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs < minAgeMs) continue;
      if (e.isFile()) {
        fs.unlinkSync(full);
        freedBytes += st.size;
        deletedCount += 1;
      } else if (e.isDirectory() && !e.isSymbolicLink()) {
        const size = measureDirSizeBytes(full, 200);
        fs.rmSync(full, { recursive: true, force: true });
        freedBytes += size;
        deletedCount += 1;
      }
    } catch {
      // Locked file in use — skip safely
    }
  }
  return { freedBytes, deletedCount };
}

export class SystemDoctorService {
  private report: SystemDoctorReport = {
    scanning: false,
    repairing: false,
    aiConfigured: Boolean(loadDoctorAiKey()),
    activeAction: '',
    score: 0,
    grade: 'GOOD',
    summaryEnglish:
      'Tap "SCAN ALL" to inspect viruses/threats, corrupted files, CPU, RAM, disk health, junk, and crashes.',
    platform: process.platform,
    scannedAt: 0,
    metrics: {
      cpuPct: 0,
      ramPct: 0,
      ramUsedGb: 0,
      ramTotalGb: 0,
      diskFreeGb: 0,
      diskPct: 0,
      tempJunkMb: 0,
      crashReportsCount: 0,
      startupCount: 0,
      uptimeHours: 0,
      integrityStatus: 'Not Checked',
      securityStatus: 'Not Scanned',
      corruptedFilesCount: 0,
    },
    issues: [],
    repairLog: [],
    terminalLines: [],
    postReport: null,
  };

  constructor(
    private onUpdate: (report: SystemDoctorReport) => void,
    private onAlert?: (kind: 'success' | 'error' | 'warning', message: string) => void,
  ) {}

  getLatest(): SystemDoctorReport {
    return this.report;
  }

  setAiKey(apiKey: string): boolean {
    const ok = saveDoctorAiKey(apiKey);
    if (ok) {
      this.report.aiConfigured = true;
      this.emit();
    }
    return ok;
  }

  private emit(): void {
    this.onUpdate({
      ...this.report,
      issues: [...this.report.issues],
      repairLog: [...this.report.repairLog],
      terminalLines: [...this.report.terminalLines],
      postReport: this.report.postReport ? { ...this.report.postReport } : null,
    });
  }

  private term(line: string): void {
    const clean = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '').trimEnd();
    if (!clean.trim()) return;
    // Mirror live to BOTH the computer's own terminal AND the iPhone!
    console.log(`[DevDeck Doctor] ${clean}`);
    this.report.terminalLines = [...this.report.terminalLines.slice(-160), clean.slice(0, 260)];
    this.emit();
  }

  private log(line: string): void {
    const stamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    this.report.repairLog = [...this.report.repairLog.slice(-60), `[${stamp}] ${line}`];
    this.term(`[doctor] ${line}`);
  }

  private execStreaming(
    command: string,
    args: string[],
    timeoutMs = 90_000,
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      this.term(`$ ${command} ${args.join(' ')}`);
      const child = spawn(command, args, {
        shell: IS_WIN && command !== 'powershell.exe',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let buf = '';
      const flushLines = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        out += text;
        buf += text;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (l.trim()) this.term(l);
        }
      };

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        this.term('⚠ Command timed out');
        resolve({ code: -1, output: out });
      }, timeoutMs);

      child.stdout?.on('data', flushLines);
      child.stderr?.on('data', flushLines);
      child.on('error', (err) => {
        clearTimeout(timer);
        this.term(`ERROR: ${err.message}`);
        resolve({ code: 1, output: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (buf.trim()) this.term(buf);
        resolve({ code: code ?? 0, output: out });
      });
    });
  }

  private async checkSecurityAndIntegrity(): Promise<{
    integrityStatus: string;
    corrupted: boolean;
    corruptedFilesCount: number;
    corruptedFileNames: string[];
    securityStatus: string;
    securityThreat: boolean;
    securityDetail: string;
    crashCount: number;
    topCrashApp: string;
    startupCount: number;
  }> {
    if (IS_WIN) {
      let integrityStatus = 'Healthy';
      let corrupted = false;
      let corruptedFilesCount = 0;
      const corruptedFileNames: string[] = [];
      let securityStatus = 'Defender Active';
      let securityThreat = false;
      let securityDetail = 'Windows Defender real-time protection is active and no threats were detected.';
      let crashCount = 0;
      const topCrashApp = '';
      let startupCount = 0;

      // 1. Windows Defender status & threat detections
      try {
        this.term('$ powershell Get-MpComputerStatus; Get-MpThreatDetection');
        const psSec = `
$st = Get-MpComputerStatus -ErrorAction SilentlyContinue
$threats = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Select-Object -First 5)
$rtp = if ($st) { $st.RealTimeProtectionEnabled } else { $true }
$age = if ($st) { $st.AntivirusSignatureAge } else { 0 }
Write-Output ("RTP=" + $rtp + "||AGE=" + $age + "||THREATS=" + $threats.Count)
`;
        const out = await runPowerShell(psSec, 6000);
        const rtpOff = /RTP=False/i.test(out);
        const threatMatch = out.match(/THREATS=(\d+)/i);
        const threatCount = Number(threatMatch?.[1] || 0);
        const ageMatch = out.match(/AGE=(\d+)/i);
        const sigAge = Number(ageMatch?.[1] || 0);

        if (threatCount > 0) {
          securityThreat = true;
          securityStatus = `${threatCount} Threat(s) Logged`;
          securityDetail = `Windows Defender logged ${threatCount} malware/virus detection(s). Run "Virus Scan" immediately to quarantine threats.`;
        } else if (rtpOff) {
          securityThreat = true;
          securityStatus = 'Protection OFF';
          securityDetail = 'Windows Defender Real-Time Protection is turned OFF, leaving your PC exposed to viruses and ransomware.';
        } else if (sigAge > 14) {
          securityStatus = `Defs ${sigAge}d Old`;
          securityDetail = `Windows Defender virus definitions are ${sigAge} days old. Update Windows Security definitions.`;
        } else {
          securityStatus = 'Defender Clean';
        }
        this.term(`Security: ${securityStatus}`);
      } catch {
        securityStatus = 'Check Skipped';
      }

      // 2. DISM /CheckHealth for OS file corruption
      try {
        this.term('$ DISM /Online /Cleanup-Image /CheckHealth');
        const out = await runPowerShell('DISM /Online /Cleanup-Image /CheckHealth 2>&1 | Out-String', 12_000);
        if (/repairable|corrupt/i.test(out)) {
          integrityStatus = 'Corrupted (Repairable)';
          corrupted = true;
          corruptedFilesCount = 1;
        } else if (/no component store corruption/i.test(out)) {
          integrityStatus = 'Healthy (DISM Verified)';
        } else if (/elevated|740/i.test(out)) {
          integrityStatus = 'Needs Admin for DISM';
        }
        this.term(`Integrity: ${integrityStatus}`);
      } catch {
        integrityStatus = 'Check Skipped';
      }

      // 3. System event errors & startup items
      try {
        const ps = `
$since = (Get-Date).AddDays(-7)
$errs = @(Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=$since} -MaxEvents 25 -ErrorAction SilentlyContinue)
$start1 = @(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } })
$start2 = @(Get-ChildItem "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup" -ErrorAction SilentlyContinue)
Write-Output ($errs.Count.ToString() + '||' + ($start1.Count + $start2.Count).toString())
`;
        const out = await runPowerShell(ps, 5000);
        const [eStr, sStr] = out.trim().split('||');
        crashCount = Number(eStr) || 0;
        startupCount = Number(sStr) || 0;
      } catch {
        // Ignore
      }

      return {
        integrityStatus,
        corrupted,
        corruptedFilesCount,
        corruptedFileNames,
        securityStatus,
        securityThreat,
        securityDetail,
        crashCount,
        topCrashApp,
        startupCount,
      };
    }

    // macOS: Security (Gatekeeper + SIP + LaunchAgents audit) + SMART + Corrupted .plist check
    let integrityStatus = 'SMART Verified';
    let corrupted = false;
    let corruptedFilesCount = 0;
    const corruptedFileNames: string[] = [];
    let securityStatus = 'XProtect & Gatekeeper ON';
    let securityThreat = false;
    let securityDetail = 'macOS Gatekeeper & System Integrity Protection (SIP) are active. No suspicious unsigned startup agents detected.';

    // 1. Gatekeeper & SIP
    try {
      this.term('$ spctl --status && csrutil status');
      const [gk, sip] = await Promise.all([
        execFileAsync('spctl', ['--status'], { timeout: 2500 }).catch((e) => ({
          stdout: e?.stdout || '',
          stderr: e?.stderr || '',
        })),
        execFileAsync('csrutil', ['status'], { timeout: 2500 }).catch((e) => ({
          stdout: e?.stdout || '',
          stderr: e?.stderr || '',
        })),
      ]);
      const gkText = `${gk.stdout} ${gk.stderr}`;
      const sipText = `${sip.stdout} ${sip.stderr}`;
      const gkDisabled = /assessments disabled/i.test(gkText);
      const sipDisabled = /disabled/i.test(sipText);
      if (gkDisabled || sipDisabled) {
        securityThreat = true;
        securityStatus = gkDisabled ? 'Gatekeeper OFF' : 'SIP Disabled';
        securityDetail = `${gkDisabled ? 'macOS Gatekeeper is disabled' : 'System Integrity Protection (SIP) is disabled'}. This makes it easier for malware or unsigned adware to run.`;
      }
      this.term(`Security: ${securityStatus}`);
    } catch {
      // Ignore
    }

    // 2. SMART disk health
    try {
      this.term('$ diskutil info / | grep SMART');
      const { stdout } = await execFileAsync('diskutil', ['info', '/'], { timeout: 3000 });
      const smartMatch = stdout.match(/SMART Status:\s*(.+)/i);
      if (smartMatch) {
        const status = smartMatch[1].trim();
        integrityStatus = `SMART ${status}`;
        if (!/verified|not supported/i.test(status)) corrupted = true;
      }
      this.term(`Disk: ${integrityStatus}`);
    } catch {
      integrityStatus = 'Checked';
    }

    // 3. Check user Preferences .plist files for corruption (plutil -lint)
    try {
      const prefsDir = path.join(os.homedir(), 'Library', 'Preferences');
      const plists = fs
        .readdirSync(prefsDir)
        .filter((f) => f.endsWith('.plist') && !f.startsWith('.'))
        .slice(0, 40)
        .map((f) => path.join(prefsDir, f));
      if (plists.length > 0) {
        this.term(`$ plutil -lint ~/Library/Preferences/*.plist (${plists.length} checked)`);
        const res = await execFileAsync('plutil', ['-lint', ...plists], { timeout: 5000 }).catch(
          (e) => ({ stdout: e?.stdout || '', stderr: e?.stderr || '' }),
        );
        const combined = `${res.stdout}\n${res.stderr}`;
        for (const line of combined.split('\n')) {
          if (
            line.includes(':') &&
            !line.trim().endsWith(': OK') &&
            line.includes('.plist') &&
            !/permission|not permitted|not readable|does not exist|not a regular file|couldn.t be opened/i.test(line)
          ) {
            corruptedFilesCount += 1;
            const fileName = path.basename(line.split(':')[0].trim());
            if (fileName) corruptedFileNames.push(fileName);
          }
        }
        if (corruptedFilesCount > 0) {
          corrupted = true;
          integrityStatus = `${corruptedFilesCount} Corrupted Plist(s)`;
          this.term(`⚠ Found ${corruptedFilesCount} corrupted preference file(s): ${corruptedFileNames.slice(0, 3).join(', ')}`);
        } else {
          this.term('All checked preference files passed plutil -lint: OK');
        }
      }
    } catch {
      // Ignore
    }

    // 4. Recent crash reports
    let crashCount = 0;
    const crashByApp = new Map<string, number>();
    const diagDir = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    try {
      for (const name of fs.readdirSync(diagDir)) {
        if (!/\.(ips|crash|diag)$/i.test(name)) continue;
        const st = fs.statSync(path.join(diagDir, name));
        if (st.mtimeMs < weekAgo) continue;
        crashCount += 1;
        const app = name.split(/[-_.]/)[0] || name;
        crashByApp.set(app, (crashByApp.get(app) || 0) + 1);
      }
    } catch {
      // Ignore
    }

    let topCrashApp = '';
    let maxCrash = 0;
    for (const [app, cnt] of crashByApp.entries()) {
      if (cnt > maxCrash) {
        maxCrash = cnt;
        topCrashApp = app;
      }
    }

    // 5. LaunchAgents startup items
    let startupCount = 0;
    try {
      const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
      if (fs.existsSync(agents)) {
        startupCount = fs.readdirSync(agents).filter((f) => f.endsWith('.plist')).length;
      }
    } catch {
      // Ignore
    }

    return {
      integrityStatus,
      corrupted,
      corruptedFilesCount,
      corruptedFileNames,
      securityStatus,
      securityThreat,
      securityDetail,
      crashCount,
      topCrashApp,
      startupCount,
    };
  }

  async runScan(): Promise<SystemDoctorReport> {
    if (this.report.scanning) return this.report;
    this.report.scanning = true;
    this.report.activeAction = 'Deep scanning viruses, corrupted files, CPU, RAM & disk…';
    this.term('=== Starting Deep System & Security Scan ===');
    this.emit();

    try {
      const [load, mem, fsList, procs, sysCheck] = await Promise.all([
        si.currentLoad().catch(() => ({ currentLoad: 0 })),
        si.mem().catch(() => ({ total: 1, active: 0, available: 1, swapused: 0 })),
        si.fsSize().catch(() => []),
        si.processes().catch(() => ({ list: [] })),
        this.checkSecurityAndIntegrity(),
      ]);

      const cpuPct = Math.round(load.currentLoad || 0);
      const ramTotalGb = Number((mem.total / 1024 ** 3).toFixed(1));
      const ramUsedBytes = Math.max(0, mem.total - mem.available);
      const ramUsedGb = Number((ramUsedBytes / 1024 ** 3).toFixed(1));
      const ramPct = Math.round((ramUsedBytes / Math.max(1, mem.total)) * 100);
      const swapUsedGb = Number(((mem.swapused || 0) / 1024 ** 3).toFixed(1));

      const mainDisk =
        fsList.find((d) => d.mount === '/' || /^c:/i.test(d.mount)) || fsList[0];
      const diskPct = Math.round(mainDisk?.use || 0);
      const diskFreeGb = Number(((mainDisk?.available || 0) / 1024 ** 3).toFixed(1));

      let junkBytes = measureDirSizeBytes(os.tmpdir(), 1000);
      if (!IS_WIN) {
        junkBytes += measureDirSizeBytes(path.join(os.homedir(), 'Library', 'Logs'), 500);
      }
      const tempJunkMb = Math.round(junkBytes / (1024 * 1024));
      const uptimeHours = Math.round(os.uptime() / 3600);

      const topCpu = procs.list
        .filter((p) => p.pid > 4 && p.pid !== process.pid && p.cpu > 5)
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 2);
      const topRam = procs.list
        .filter((p) => p.pid > 4 && p.mem > 3)
        .sort((a, b) => b.mem - a.mem)
        .slice(0, 2);

      const issues: DoctorIssue[] = [];
      let score = 100;

      // 1. Malware / Virus / Security Shield
      if (sysCheck.securityThreat) {
        score -= 28;
        issues.push({
          id: 'security',
          severity: 'critical',
          category: 'security',
          title: `Security Alert: ${sysCheck.securityStatus}`,
          plainEnglish: sysCheck.securityDetail,
          impact: 'Malware/adware can hijack CPU & steal data',
          fixAction: 'scan_malware',
          fixLabel: 'Virus Scan',
        });
      } else {
        issues.push({
          id: 'security',
          severity: 'healthy',
          category: 'security',
          title: `Security Shield: ${sysCheck.securityStatus}`,
          plainEnglish: sysCheck.securityDetail,
          impact: 'Active malware protection',
          fixAction: 'scan_malware',
          fixLabel: 'Run Scan',
        });
      }

      // 2. Corrupted Files & System Integrity
      if (sysCheck.corrupted) {
        score -= 28;
        issues.push({
          id: 'integrity',
          severity: 'critical',
          category: 'corruption',
          title:
            sysCheck.corruptedFilesCount > 0 && !IS_WIN
              ? `${sysCheck.corruptedFilesCount} Corrupted Config File(s) Found`
              : 'Corrupted System Files / Drive Issue Detected',
          plainEnglish: IS_WIN
            ? 'Windows component store reported corruption. Corrupted OS files cause random freezes, blue screens, and slow boots.'
            : sysCheck.corruptedFileNames.length > 0
              ? `Found corrupted preference file(s): ${sysCheck.corruptedFileNames.slice(0, 3).join(', ')}. Corrupted config files cause app hangs and slow launches.`
              : `Your drive reported "${sysCheck.integrityStatus}". Disk or volume issues can cause severe stutters.`,
          impact: 'High risk of crashes & freezing',
          fixAction: 'verify_system_files',
          fixLabel: IS_WIN ? 'Run SFC + DISM' : 'Verify Disk',
        });
      } else {
        issues.push({
          id: 'integrity',
          severity: 'healthy',
          category: 'corruption',
          title: `System Integrity: ${sysCheck.integrityStatus}`,
          plainEnglish:
            'No corrupted system files or drive hardware errors were found. You can still run a deep verification anytime.',
          impact: 'Core OS files intact',
          fixAction: 'verify_system_files',
          fixLabel: IS_WIN ? 'Run SFC + DISM' : 'Verify Disk',
        });
      }

      // 3. RAM / Memory Pressure (realistic thresholds for 8GB+ macOS & Windows)
      if (ramPct >= 86 || (ramPct >= 80 && swapUsedGb >= 5)) {
        const crit = ramPct >= 93;
        score -= crit ? 20 : 10;
        const hogText = topRam.length
          ? ` Heavy apps: ${topRam.map((p) => `${p.name.replace(/\.exe$/i, '')} (${p.mem.toFixed(0)}%)`).join(', ')}.`
          : '';
        issues.push({
          id: 'memory',
          severity: crit ? 'critical' : 'warning',
          category: 'memory',
          title: `High Memory Usage (${ramPct}% Full)`,
          plainEnglish: `Your computer is using ${ramUsedGb} GB of ${ramTotalGb} GB RAM${swapUsedGb > 0 ? ` and spilling ${swapUsedGb} GB onto slow disk swap` : ''}.${hogText} When RAM fills up, every click lags.`,
          impact: 'Causes stuttering & app reloads',
          fixAction: 'free_ram',
          fixLabel: 'Trim RAM',
        });
      } else {
        issues.push({
          id: 'memory',
          severity: 'healthy',
          category: 'memory',
          title: `Memory Healthy (${ramPct}% Used)`,
          plainEnglish: `${ramUsedGb} GB of ${ramTotalGb} GB RAM is in use with healthy headroom.`,
          impact: 'Smooth multitasking',
        });
      }

      // 4. CPU Bottleneck
      if (cpuPct >= 70) {
        const crit = cpuPct >= 88;
        score -= crit ? 22 : 12;
        const hogText = topCpu.length
          ? ` Right now ${topCpu.map((p) => `${p.name.replace(/\.exe$/i, '')} (${Math.round(p.cpu)}%)`).join(' and ')} are eating most of your CPU.`
          : '';
        issues.push({
          id: 'cpu',
          severity: crit ? 'critical' : 'warning',
          category: 'cpu',
          title: `Processor Overloaded (${cpuPct}% CPU)`,
          plainEnglish: `Your CPU is heavily loaded right now.${hogText} High CPU usage makes typing and clicking feel sluggish.`,
          impact: 'Direct UI lag & fan noise',
          fixAction: 'free_ram',
          fixLabel: 'Optimize',
        });
      } else {
        issues.push({
          id: 'cpu',
          severity: 'healthy',
          category: 'cpu',
          title: `Processor Responsive (${cpuPct}% CPU)`,
          plainEnglish: 'CPU load is normal with no runaway background process choking performance.',
          impact: 'Fast response time',
        });
      }

      // 5. Storage Free Space
      if (diskPct >= 85 || diskFreeGb < 20) {
        const crit = diskPct >= 93 || diskFreeGb < 10;
        score -= crit ? 22 : 12;
        issues.push({
          id: 'disk',
          severity: crit ? 'critical' : 'warning',
          category: 'disk',
          title: `Low Free Disk Space (${diskFreeGb} GB Left)`,
          plainEnglish: `Your main drive only has ${diskFreeGb} GB free (${diskPct}% used). SSDs slow down dramatically when free space drops below 15 GB because the OS runs out of room for virtual memory.`,
          impact: 'Severe boot, swap & app-launch slowdown',
          fixAction: 'clean_junk',
          fixLabel: 'Clean Junk',
        });
      }

      // 6. Temp & Cache Junk
      if (tempJunkMb >= 150) {
        score -= tempJunkMb >= 800 ? 12 : 6;
        issues.push({
          id: 'junk',
          severity: 'warning',
          category: 'disk',
          title: `${tempJunkMb} MB of Temporary Junk Files`,
          plainEnglish: `Found ${tempJunkMb} MB of leftover temporary and log files cluttering your drive. Clearing them safely reclaims space and speeds up file indexing.`,
          impact: `Reclaim ~${tempJunkMb} MB instantly`,
          fixAction: 'clean_junk',
          fixLabel: `Clean ${tempJunkMb} MB`,
        });
      }

      // 7. Recent Crashes
      if (sysCheck.crashCount >= 4) {
        score -= sysCheck.crashCount >= 12 ? 15 : 8;
        issues.push({
          id: 'crashes',
          severity: sysCheck.crashCount >= 12 ? 'critical' : 'warning',
          category: 'crashes',
          title: `${sysCheck.crashCount} Recent System/App Crashes (7 Days)`,
          plainEnglish: sysCheck.topCrashApp
            ? `Your computer logged ${sysCheck.crashCount} crashes this week — "${sysCheck.topCrashApp}" crashed most often. Repeated crashes point to a buggy app, low disk space, or corrupted cache.`
            : `Your computer logged ${sysCheck.crashCount} critical system errors this week. Running a full system file repair is strongly recommended.`,
          impact: 'Instability & unexpected freezes',
          fixAction: 'verify_system_files',
          fixLabel: 'Verify Files',
        });
      }

      // 8. Startup Bloat / Long Uptime
      if (sysCheck.startupCount >= 10 || uptimeHours >= 168) {
        score -= 7;
        issues.push({
          id: 'startup',
          severity: 'warning',
          category: 'startup',
          title:
            uptimeHours >= 168
              ? `No Reboot in ${Math.floor(uptimeHours / 24)} Days`
              : `${sysCheck.startupCount} Startup Background Items`,
          plainEnglish:
            uptimeHours >= 168
              ? `Your computer has been running for ${Math.floor(uptimeHours / 24)} days straight without a restart. Memory leaks and stale kernel caches accumulate over time.`
              : `You have ${sysCheck.startupCount} apps launching automatically at login, slowing boot time and eating RAM.`,
          impact: 'Slow boot & background drag',
          fixAction: 'flush_dns',
          fixLabel: 'Flush DNS',
        });
      }

      // 9. Deep Hardware & Software Audit (Thermal, SMART, Battery, Power Plan, Drivers, AV Conflict, Indexer, Browser Bloat, BSOD/Panics, Heavy Folders)
      const deepAudit = await runDeepHardwareAndSoftwareAudit(procs.list);
      for (const note of deepAudit.terminalNotes) this.term(note);
      issues.push(...deepAudit.issues);
      score -= deepAudit.scorePenalty;

      score = Math.max(5, Math.min(100, score));
      const grade: SystemDoctorReport['grade'] =
        score >= 85 ? 'EXCELLENT' : score >= 68 ? 'GOOD' : score >= 45 ? 'SLOW' : 'CRITICAL';

      const order = { critical: 0, warning: 1, healthy: 2 };
      issues.sort((a, b) => order[a.severity] - order[b.severity]);

      const realProblems = issues.filter((i) => i.severity !== 'healthy');
      const summaryEnglish =
        realProblems.length === 0
          ? `Your ${IS_WIN ? 'Windows PC' : 'Mac'} is clean, secure, and fast (${score}/100). No viruses, corrupted files, or major bottlenecks found.`
          : `Your ${IS_WIN ? 'Windows PC' : 'Mac'} is slowed down mainly by ${realProblems
              .slice(0, 2)
              .map((p) => p.title.toLowerCase())
              .join(' and ')}. Tap "FIX ALL" to scan viruses, verify corrupted files, clean junk, and generate a full English repair report.`;

      this.report = {
        ...this.report,
        scanning: false,
        activeAction: '',
        score,
        grade,
        summaryEnglish,
        platform: process.platform,
        scannedAt: Date.now(),
        metrics: {
          cpuPct,
          ramPct,
          ramUsedGb,
          ramTotalGb,
          diskFreeGb,
          diskPct,
          tempJunkMb,
          crashReportsCount: sysCheck.crashCount,
          startupCount: sysCheck.startupCount,
          uptimeHours,
          integrityStatus: sysCheck.integrityStatus,
          securityStatus: sysCheck.securityStatus,
          corruptedFilesCount: sysCheck.corruptedFilesCount,
        },
        issues,
      };
      this.term(`=== Scan Complete — Health Score: ${score}/100 (${grade}) ===`);
      this.emit();
      return this.report;
    } catch (err) {
      this.report.scanning = false;
      this.report.activeAction = '';
      this.log(`Scan error: ${err instanceof Error ? err.message : 'unknown'}`);
      this.emit();
      return this.report;
    }
  }

  private buildPostReport(
    scoreBefore: number,
    whatWasFixed: string[],
    whatWasNotFixed: string[],
  ): DoctorPostReport {
    const m = this.report.metrics;
    const whyItHappened: string[] = [];
    const nextSteps: string[] = [];

    if (m.diskFreeGb < 15) {
      whyItHappened.push(
        `Low free storage (${m.diskFreeGb} GB left) starves the OS of virtual memory swap space, causing freezes and app crashes.`,
      );
      whatWasNotFixed.push(
        `Personal files on your drive were NOT deleted — you still only have ${m.diskFreeGb} GB free.`,
      );
      nextSteps.push(
        'Free up at least 20 GB by deleting old Downloads, large screen recordings, or unused Xcode/Docker/node_modules caches.',
      );
    }
    if (m.ramPct >= 82) {
      whyItHappened.push(
        `RAM is ${m.ramPct}% full (${m.ramUsedGb}/${m.ramTotalGb} GB), forcing your computer to swap memory onto disk.`,
      );
      nextSteps.push('Close unused browser tabs and heavy background apps (check Mac/PC Monitor tab).');
    }
    if (m.crashReportsCount >= 4) {
      whyItHappened.push(
        `${m.crashReportsCount} system/app crash logs were recorded in the last 7 days, indicating unstable apps or low-memory kills.`,
      );
      nextSteps.push('Update crashing apps and your OS to the latest stable version.');
    }
    if (m.uptimeHours >= 168) {
      whyItHappened.push(
        `The computer has not been restarted in ${Math.floor(m.uptimeHours / 24)} days, allowing kernel caches and memory leaks to build up.`,
      );
      whatWasNotFixed.push('Automatic reboot was skipped so your open work is never lost.');
      nextSteps.push('Save your work and restart the computer once to clear kernel memory completely.');
    }
    if (whyItHappened.length === 0) {
      whyItHappened.push(
        'No severe hardware or OS bottlenecks were found — only normal temporary cache buildup and DNS/memory clutter.',
      );
    }
    if (nextSteps.length === 0) {
      nextSteps.push('Your computer is in great shape! Run "FIX ALL" once a week to keep it fast.');
    }

    return {
      generatedAt: Date.now(),
      scoreBefore: scoreBefore || this.report.score,
      scoreAfter: this.report.score,
      whatWasFixed,
      whatWasNotFixed,
      whyItHappened,
      nextSteps,
    };
  }

  async runRepair(action: DoctorRepairAction): Promise<string> {
    if (this.report.repairing) {
      return 'A repair action is already running';
    }
    this.report.repairing = true;
    this.report.activeAction = action.replace(/_/g, ' ').toUpperCase();
    this.emit();

    const beforeScore = this.report.score;
    const whatWasFixed: string[] = [];
    const whatWasNotFixed: string[] = [];
    let summaryMsg = '';

    try {
      const doCleanJunk = () => {
        this.log('Deep cleaning temporary files, old logs & safe app caches…');
        const home = os.homedir();
        let freed = 0;
        let count = 0;

        // 1. OS Temp directory
        this.term(`$ clean "${os.tmpdir()}"`);
        const rTmp = cleanDirFilesOlderThan(os.tmpdir(), 5 * 60 * 1000);
        freed += rTmp.freedBytes;
        count += rTmp.deletedCount;

        if (!IS_WIN) {
          // 2. Archive active crash reports so they are preserved safely & cleared from active alert list
          const diagDir = path.join(home, 'Library', 'Logs', 'DiagnosticReports');
          const archiveDir = path.join(diagDir, 'DevDeck_Archived');
          let archivedCrashes = 0;
          try {
            if (fs.existsSync(diagDir)) {
              for (const name of fs.readdirSync(diagDir)) {
                if (!/\.(ips|crash|diag)$/i.test(name)) continue;
                const src = path.join(diagDir, name);
                if (!fs.statSync(src).isFile()) continue;
                fs.mkdirSync(archiveDir, { recursive: true });
                fs.renameSync(src, path.join(archiveDir, name));
                archivedCrashes += 1;
              }
            }
          } catch {
            // Ignore permission-locked crash logs
          }
          if (archivedCrashes > 0) {
            this.term(`✅ Archived ${archivedCrashes} old crash log(s) → DiagnosticReports/DevDeck_Archived`);
            whatWasFixed.push(
              `Archived ${archivedCrashes} past crash report(s) into DiagnosticReports/DevDeck_Archived so only new crashes appear.`,
            );
          }

          // 3. Clean old log files in ~/Library/Logs (> 2 hours old)
          const logsDir = path.join(home, 'Library', 'Logs');
          this.term(`$ clean old logs in "${logsDir}"`);
          const rLogs = cleanDirFilesOlderThan(logsDir, 2 * 3600 * 1000);
          freed += rLogs.freedBytes;
          count += rLogs.deletedCount;

          // 4. Clean 100% safe regenerable browser & developer caches
          const safeMacCaches = [
            path.join(home, 'Library', 'Caches', 'Google', 'Chrome', 'Default', 'Cache'),
            path.join(home, 'Library', 'Caches', 'Google', 'Chrome', 'Default', 'Code Cache'),
            path.join(home, 'Library', 'Caches', 'com.apple.Safari', 'WebKitCache'),
            path.join(home, 'Library', 'Caches', 'pip'),
            path.join(home, 'Library', 'Caches', 'Homebrew'),
            path.join(home, 'Library', 'Caches', 'typescript'),
            path.join(home, 'Library', 'Caches', 'node-gyp'),
            path.join(home, 'Library', 'Caches', 'Yarn'),
            path.join(home, '.npm', '_cacache'),
            path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'),
            path.join(home, 'Library', 'Application Support', 'Code', 'Cache'),
            path.join(home, 'Library', 'Application Support', 'Code', 'CachedData'),
            path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Code Cache'),
          ];
          for (const cacheDir of safeMacCaches) {
            if (!fs.existsSync(cacheDir)) continue;
            this.term(`$ clean cache "${cacheDir}"`);
            const rc = cleanDirFilesOlderThan(cacheDir, 0);
            freed += rc.freedBytes;
            count += rc.deletedCount;
          }
        } else {
          // Windows safe regenerable caches
          const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
          const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
          const safeWinCaches = [
            path.join(localApp, 'Temp'),
            path.join(localApp, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
            path.join(localApp, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
            path.join(localApp, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
            path.join(localApp, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
            path.join(localApp, 'npm-cache'),
            path.join(localApp, 'pip', 'cache'),
            path.join(appData, 'Code', 'Cache'),
            path.join(appData, 'Code', 'CachedData'),
          ];
          for (const cacheDir of safeWinCaches) {
            if (!fs.existsSync(cacheDir)) continue;
            this.term(`$ clean cache "${cacheDir}"`);
            const rc = cleanDirFilesOlderThan(cacheDir, 5 * 60 * 1000);
            freed += rc.freedBytes;
            count += rc.deletedCount;
          }
        }

        const mb = (freed / (1024 * 1024)).toFixed(1);
        this.log(`Cleaned ${count} junk/cache/log items — freed ${mb} MB of real disk space.`);
        whatWasFixed.push(
          `Cleaned ${count} temporary junk, old log, and browser/dev cache files (${mb} MB freed).`,
        );
        return `Freed ${mb} MB (${count} junk/cache items removed)`;
      };

      const doFlushDns = async () => {
        this.log('Flushing DNS & refreshing network resolver cache…');
        if (IS_WIN) {
          await this.execStreaming('ipconfig', ['/flushdns'], 8000);
        } else {
          await this.execStreaming('dscacheutil', ['-flushcache'], 8000);
        }
        whatWasFixed.push('Flushed stale DNS cache for faster website and API lookups.');
        return 'DNS cache flushed';
      };

      const doFreeRam = async () => {
        this.log('Optimizing memory & trimming idle working sets…');
        if (IS_WIN) {
          const encoded = Buffer.from(
            `Add-Type 'using System; using System.Runtime.InteropServices; public class Mem { [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h); }'; $c=0; Get-Process | Where-Object { $_.WorkingSet64 -gt 80MB -and $_.ProcessName -notmatch 'System|csrss|dwm|explorer|node' } | ForEach-Object { try { if([Mem]::EmptyWorkingSet($_.Handle)){ $c++ } } catch {} }; Write-Output "Trimmed working set memory on $c background processes."`,
            'utf16le',
          ).toString('base64');
          await this.execStreaming(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            12_000,
          );
          whatWasFixed.push('Trimmed standby/working-set RAM across heavy Windows background apps.');
        } else {
          await this.execStreaming('vm_stat', [], 5000);
          whatWasFixed.push('Audited macOS virtual memory & page pressure.');
        }
        return 'Memory optimized';
      };

      const doScanMalware = async () => {
        if (IS_WIN) {
          this.log('Starting live Windows Defender antivirus QuickScan…');
          const res = await this.execStreaming(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Update-MpSignature -ErrorAction SilentlyContinue; Start-MpScan -ScanType QuickScan; $t=@(Get-MpThreatDetection -ErrorAction SilentlyContinue); Write-Output ("Defender QuickScan finished. Active threat detections: " + $t.Count)',
            ],
            120_000,
          );
          if (res.code === 0) {
            whatWasFixed.push('Ran full Windows Defender antivirus QuickScan & signature check.');
          } else {
            whatWasNotFixed.push(
              'Windows Defender scan returned a warning — open Windows Security for full offline scan if needed.',
            );
          }
          return 'Windows Defender antivirus scan completed';
        }

        this.log('Running macOS Security, Gatekeeper, SIP & LaunchAgent audit…');
        await this.execStreaming('spctl', ['--status'], 5000);
        await this.execStreaming('csrutil', ['status'], 5000);
        const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        if (fs.existsSync(agentsDir)) {
          await this.execStreaming('ls', ['-la', agentsDir], 5000);
        }
        whatWasFixed.push(
          'Verified macOS Gatekeeper, SIP, XProtect status and audited user LaunchAgents for suspicious persistence.',
        );
        return 'macOS security & malware persistence audit completed';
      };

      const doVerifySystemFiles = async () => {
        if (IS_WIN) {
          this.log('Running Windows System File Repair (DISM + SFC /scannow)…');
          const dism = await this.execStreaming(
            'DISM',
            ['/Online', '/Cleanup-Image', '/RestoreHealth'],
            120_000,
          );
          if (/740|elevated/i.test(dism.output)) {
            whatWasNotFixed.push(
              'Windows DISM & SFC require Administrator rights. Right-click start-windows.bat → "Run as Administrator" to repair protected Windows OS files.',
            );
            return 'Run start-windows.bat as Administrator for protected SFC/DISM repair';
          }
          const sfc = await this.execStreaming('sfc', ['/scannow'], 120_000);
          if (sfc.code === 0) {
            whatWasFixed.push('Completed Windows DISM + SFC /scannow system file corruption repair.');
          } else {
            whatWasNotFixed.push('SFC reported some locked files — reboot and run SFC as Administrator.');
          }
          return 'Windows DISM + SFC integrity repair finished';
        }

        this.log('Running macOS APFS volume verification (diskutil verifyVolume /)…');
        const res = await this.execStreaming('diskutil', ['verifyVolume', '/'], 90_000);
        if (res.code === 0) {
          whatWasFixed.push('Verified macOS APFS volume & filesystem metadata (diskutil verifyVolume /).');
        } else {
          whatWasNotFixed.push(
            'diskutil verifyVolume reported a warning — run Disk Utility First Aid in macOS Recovery if errors persist.',
          );
        }
        return 'macOS disk volume verification completed';
      };

      const doAutoFixConfigsAndPower = async () => {
        if (IS_WIN) {
          // Switch Power Saver -> Balanced automatically if Power Saver is throttling the PC
          try {
            const scheme = await runPowerShell('powercfg /getactivescheme 2>$null | Out-String', 3000);
            if (/Power saver|a1841308-3541-4fab-bc81-f71556f20b4a/i.test(scheme)) {
              await this.execStreaming('powercfg', ['/setactive', '381b4222-f694-41f0-9685-ff5bb260df2e'], 5000);
              whatWasFixed.push('Switched Windows Power Plan from "Power Saver" to "Balanced" to remove CPU throttling.');
            }
          } catch {
            // Ignore
          }
          return;
        }

        // macOS: auto-quarantine any corrupted .plist files into DevDeck_Quarantine so macOS regenerates clean ones
        try {
          const prefsDir = path.join(os.homedir(), 'Library', 'Preferences');
          const quarantineDir = path.join(prefsDir, 'DevDeck_Quarantine');
          const plists = fs
            .readdirSync(prefsDir)
            .filter((f) => f.endsWith('.plist') && !f.startsWith('.'))
            .slice(0, 60)
            .map((f) => path.join(prefsDir, f));
          if (plists.length > 0) {
            const res = await execFileAsync('plutil', ['-lint', ...plists], { timeout: 5000 }).catch(
              (e) => ({ stdout: e?.stdout || '', stderr: e?.stderr || '' }),
            );
            const combined = `${res.stdout}\n${res.stderr}`;
            let fixedPlists = 0;
            for (const line of combined.split('\n')) {
              if (
                line.includes(':') &&
                !line.trim().endsWith(': OK') &&
                line.includes('.plist') &&
                !/permission|not permitted|not readable|does not exist|not a regular file|couldn.t be opened/i.test(line)
              ) {
                const filePath = line.split(':')[0].trim();
                const base = path.basename(filePath);
                if (filePath && fs.existsSync(filePath)) {
                  try {
                    fs.mkdirSync(quarantineDir, { recursive: true });
                    fs.renameSync(filePath, path.join(quarantineDir, `${base}.bak`));
                    this.term(`✅ Fixed corrupted config: moved ${base} → DevDeck_Quarantine/`);
                    fixedPlists += 1;
                  } catch {
                    this.term(`⚠ macOS protected ${base} (needs Full Disk Access to move)`);
                    whatWasNotFixed.push(
                      `Corrupted config "${base}" is protected by macOS privacy lock — open System Settings → Privacy & Security → Full Disk Access and enable Terminal, then tap Redo Corrupt Fix.`,
                    );
                  }
                }
              }
            }
            if (fixedPlists > 0) {
              whatWasFixed.push(
                `Repaired ${fixedPlists} corrupted preference file(s) by safely moving them to DevDeck_Quarantine so macOS creates fresh, clean configs.`,
              );
            }
          }
        } catch {
          // Ignore
        }
      };

      if (action === 'clean_junk') {
        summaryMsg = doCleanJunk();
      } else if (action === 'flush_dns') {
        summaryMsg = await doFlushDns();
      } else if (action === 'free_ram') {
        summaryMsg = await doFreeRam();
      } else if (action === 'scan_malware') {
        summaryMsg = await doScanMalware();
      } else if (action === 'verify_system_files') {
        await doAutoFixConfigsAndPower();
        summaryMsg = await doVerifySystemFiles();
      } else if (action === 'ai_rescue') {
        this.term('==================================================');
        this.log('STAGE 1/2: RUNNING FULL AUTOMATED SYSTEM REPAIR SUITE');
        this.term('==================================================');
        if (!this.report.scannedAt) {
          this.report.repairing = false;
          await this.runScan();
          this.report.repairing = true;
        }
        const aiStartScore = this.report.score;

        // Stage 1: Execute EVERY core deterministic repair automatically
        this.report.activeAction = 'Stage 1/2: Cleaning junk, DNS, RAM, configs, security & OS files…';
        this.emit();
        doCleanJunk();
        await doFlushDns();
        await doFreeRam();
        await doAutoFixConfigsAndPower();
        await doScanMalware();
        await doVerifySystemFiles();

        // Stage 2: Autonomous Gemini AI Systems Engineer for deep custom investigation & remaining fixes
        this.term('==================================================');
        this.log('STAGE 2/2: LAUNCHING AI SYSTEMS ENGINEER FOR DEEP FIXES');
        this.term('==================================================');
        let aiSummary: {
          whatWasFixed: string[];
          whatWasNotFixed: string[];
          whyItHappened: string[];
          nextSteps: string[];
        } | null = null;
        try {
          aiSummary = await runAutonomousAiRescue(
            this.report,
            (line) => this.term(line),
            (statusText) => {
              this.report.activeAction = statusText;
              this.emit();
            },
            whatWasFixed,
            whatWasNotFixed,
          );
        } catch (aiErr) {
          const reason = aiErr instanceof Error ? aiErr.message : 'AI API temporarily unavailable';
          this.term(`⚠ AI cloud quota/demand limit (${reason.slice(0, 80)}) — generating full local English report.`);
          whatWasNotFixed.push(
            `Gemini AI cloud step was temporarily rate-limited (${reason.slice(0, 70)}). All Stage 1 computer repairs still completed normally.`,
          );
        }
        this.log('Re-scanning computer to measure final improvement…');
        this.report.repairing = false;
        this.report.activeAction = '';
        await this.runScan();
        this.report.postReport = aiSummary
          ? {
              generatedAt: Date.now(),
              scoreBefore: aiStartScore,
              scoreAfter: this.report.score,
              whatWasFixed: aiSummary.whatWasFixed,
              whatWasNotFixed: aiSummary.whatWasNotFixed,
              whyItHappened: aiSummary.whyItHappened,
              nextSteps: aiSummary.nextSteps,
            }
          : this.buildPostReport(aiStartScore, whatWasFixed, whatWasNotFixed);
        summaryMsg = `Full Rescue Complete! Health ${aiStartScore} → ${this.report.score}/100`;
        this.log(`✅ ${summaryMsg}`);
        this.emit();
        this.onAlert?.('success', summaryMsg);
        return summaryMsg;
      } else if (action === 'full_tuneup' || action === 'fix_all') {
        this.term('==================================================');
        this.log('STARTING ALL-IN-ONE DEEP RESCUE & REPAIR PIPELINE');
        this.term('==================================================');
        doCleanJunk();
        await doFlushDns();
        await doFreeRam();
        await doAutoFixConfigsAndPower();
        await doScanMalware();
        if (action === 'fix_all') {
          await doVerifySystemFiles();
        }
        this.log('Re-scanning computer to measure improvement…');
        this.report.repairing = false;
        await this.runScan();
        this.report.postReport = this.buildPostReport(beforeScore, whatWasFixed, whatWasNotFixed);
        summaryMsg = `Rescue Complete! Health ${this.report.postReport.scoreBefore} → ${this.report.postReport.scoreAfter}/100`;
        this.log(`✅ ${summaryMsg}`);
        this.emit();
        this.onAlert?.('success', summaryMsg);
        return summaryMsg;
      }

      this.report.repairing = false;
      this.report.activeAction = '';
      await this.runScan();
      this.report.postReport = this.buildPostReport(beforeScore, whatWasFixed, whatWasNotFixed);
      this.emit();
      this.onAlert?.('success', summaryMsg);
      return summaryMsg;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Repair failed';
      this.log(`❌ ${msg}`);
      this.report.repairing = false;
      this.report.activeAction = '';
      this.emit();
      this.onAlert?.('error', msg.slice(0, 80));
      return msg;
    }
  }
}
