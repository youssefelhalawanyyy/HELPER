import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type {
  BluetoothDeviceInfo,
  MacDeepTelemetry,
  ProjectScriptInfo,
  RecentFileInfo,
} from '../types/protocol.js';

const execFileAsync = promisify(execFile);

export class DeepTelemetryService {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastSlowScan = 0;
  private cachedSlow: {
    batteryHealthPct: number | null;
    batteryCycles: number | null;
    batteryWattage: number | null;
    bluetoothDevices: BluetoothDeviceInfo[];
    displays: string[];
    audioOutputDevice: string;
    wifiSsid: string;
    wifiSignalDbm: number | null;
  } = {
    batteryHealthPct: null,
    batteryCycles: null,
    batteryWattage: null,
    bluetoothDevices: [],
    displays: [],
    audioOutputDevice: IS_WIN ? 'Windows Audio' : 'MacBook Speakers',
    wifiSsid: 'Wi-Fi',
    wifiSignalDbm: null,
  };

  private latest: MacDeepTelemetry;

  constructor(
    private getProjectDir: () => string,
    private lanIp: string,
    private onUpdate: (data: MacDeepTelemetry) => void,
  ) {
    this.latest = {
      batteryHealthPct: null,
      batteryCycles: null,
      batteryTimeRemaining: '--',
      batteryWattage: null,
      cpuCores: [],
      uptimeSec: Math.floor(os.uptime()),
      displays: [],
      bluetoothDevices: [],
      wifiSsid: 'Wi-Fi',
      wifiSignalDbm: null,
      pingMs: null,
      vpnActive: false,
      lanIp,
      activeWindowTitle: '',
      activeBrowserUrl: '',
      activeBrowserTitle: '',
      runningApps: [],
      recentFiles: [],
      projectScripts: [],
      micInputPct: 50,
      micMuted: false,
      audioOutputDevice: IS_WIN ? 'Windows Audio' : 'MacBook Speakers',
      darkMode: true,
      ts: Date.now(),
    };
  }

  getLatest(): MacDeepTelemetry {
    return this.latest;
  }

  private async scanSlowHardwareWindows(): Promise<void> {
    // 1. Battery health & cycles via systeminformation
    try {
      const batt = await si.battery();
      if (batt.hasBattery) {
        if (batt.cycleCount > 0) this.cachedSlow.batteryCycles = batt.cycleCount;
        if (batt.designedCapacity > 0 && batt.maxCapacity > 0) {
          this.cachedSlow.batteryHealthPct = Math.min(
            100,
            Math.round((batt.maxCapacity / batt.designedCapacity) * 100),
          );
        }
      }
    } catch {
      // Ignore
    }

    // 2. Displays
    try {
      const gfx = await si.graphics();
      this.cachedSlow.displays = gfx.displays
        .map((d) => `${d.model || 'Display'} (${d.resolutionX || '?'}×${d.resolutionY || '?'})`)
        .slice(0, 4);
    } catch {
      // Ignore
    }

    // 3. Audio output
    try {
      const audio = await si.audio();
      const def = audio.find((a) => a.default) || audio[0];
      if (def?.name) this.cachedSlow.audioOutputDevice = def.name;
    } catch {
      // Ignore
    }

    // 4. Wi-Fi SSID & Signal
    try {
      const wifi = await si.wifiConnections();
      const first = wifi[0];
      if (first?.ssid) this.cachedSlow.wifiSsid = first.ssid;
      if (typeof first?.signalLevel === 'number') {
        this.cachedSlow.wifiSignalDbm = first.signalLevel;
      }
    } catch {
      // Ignore
    }

    // 5. Bluetooth devices
    try {
      const bt = await si.bluetoothDevices();
      this.cachedSlow.bluetoothDevices = bt
        .filter((d) => d.connected && d.name)
        .slice(0, 6)
        .map((d) => ({
          name: d.name,
          connected: true,
          batteryPct: typeof d.batteryPercent === 'number' ? d.batteryPercent : null,
        }));
    } catch {
      // Ignore
    }
  }

  private async scanSlowHardware(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSlowScan < 25_000) return;
    this.lastSlowScan = now;

    if (IS_WIN) {
      await this.scanSlowHardwareWindows();
      return;
    }

    // 1. Battery health / cycles / wattage (macOS)
    try {
      const { stdout } = await execFileAsync('system_profiler', ['SPPowerDataType', '-json'], {
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const json = JSON.parse(stdout) as { SPPowerDataType?: Array<Record<string, unknown>> };
      const entries = json.SPPowerDataType || [];
      for (const item of entries) {
        const health = item.sppower_battery_health_info as Record<string, unknown> | undefined;
        if (health) {
          const cycles = Number(health.sppower_battery_cycle_count);
          if (Number.isFinite(cycles)) this.cachedSlow.batteryCycles = cycles;
          const capStr = String(health.sppower_battery_health_maximum_capacity || '');
          const capMatch = capStr.match(/(\d+)/);
          if (capMatch) this.cachedSlow.batteryHealthPct = Number(capMatch[1]);
        }
        const charger = item.sppower_ac_charger_watts;
        if (charger !== undefined) {
          const w = Number(charger);
          if (Number.isFinite(w)) this.cachedSlow.batteryWattage = w;
        }
      }
    } catch {
      // Ignore
    }

    // 2. Bluetooth devices + AirPods/peripheral battery
    try {
      const { stdout } = await execFileAsync('system_profiler', ['SPBluetoothDataType', '-json'], {
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const json = JSON.parse(stdout) as { SPBluetoothDataType?: Array<Record<string, unknown>> };
      const btRoot = json.SPBluetoothDataType?.[0] || {};
      const connectedArr =
        (btRoot.device_connected as Array<Record<string, Record<string, unknown>>>) || [];
      const devices: BluetoothDeviceInfo[] = [];
      for (const devObj of connectedArr) {
        for (const [name, details] of Object.entries(devObj)) {
          const battRaw =
            details.device_batteryLevelMain ||
            details.device_batteryLevelLeft ||
            details.device_batteryLevelRight ||
            details.device_batteryLevelCase;
          const battMatch = typeof battRaw === 'string' ? battRaw.match(/(\d+)/) : null;
          devices.push({
            name,
            connected: true,
            batteryPct: battMatch ? Number(battMatch[1]) : null,
          });
        }
      }
      this.cachedSlow.bluetoothDevices = devices.slice(0, 6);
    } catch {
      // Ignore
    }

    // 3. Displays
    try {
      const gfx = await si.graphics();
      this.cachedSlow.displays = gfx.displays
        .map((d) => `${d.model || 'Display'} (${d.resolutionX || '?'}×${d.resolutionY || '?'})`)
        .slice(0, 4);
    } catch {
      // Ignore
    }

    // 4. Audio output device
    try {
      const { stdout } = await execFileAsync('system_profiler', ['SPAudioDataType', '-json'], {
        timeout: 3500,
        maxBuffer: 2 * 1024 * 1024,
      });
      const json = JSON.parse(stdout) as {
        SPAudioDataType?: Array<{ _items?: Array<Record<string, unknown>> }>;
      };
      const items = json.SPAudioDataType?.[0]?._items || [];
      const defOut = items.find((i) => i.coreaudio_default_audio_output_device === 'spaudio_yes');
      if (defOut && typeof defOut._name === 'string') {
        this.cachedSlow.audioOutputDevice = defOut._name;
      }
    } catch {
      // Ignore
    }

    // 5. Wi-Fi SSID & RSSI
    try {
      const { stdout } = await execFileAsync('system_profiler', ['SPAirPortDataType', '-json'], {
        timeout: 3500,
        maxBuffer: 2 * 1024 * 1024,
      });
      const json = JSON.parse(stdout) as {
        SPAirPortDataType?: Array<{
          spairport_airport_interfaces?: Array<{
            spairport_current_network_information?: {
              _name?: string;
              spairport_signal_noise?: string;
            };
          }>;
        }>;
      };
      const curNet =
        json.SPAirPortDataType?.[0]?.spairport_airport_interfaces?.[0]
          ?.spairport_current_network_information;
      if (curNet?._name) this.cachedSlow.wifiSsid = curNet._name;
      if (curNet?.spairport_signal_noise) {
        const m = curNet.spairport_signal_noise.match(/(-\d+)\s*dBm/i);
        if (m) this.cachedSlow.wifiSignalDbm = Number(m[1]);
      }
    } catch {
      // Ignore
    }
  }

  private async readBatteryRemaining(): Promise<string> {
    if (IS_WIN) {
      try {
        const batt = await si.battery();
        if (!batt.hasBattery) return 'AC Power';
        if (batt.isCharging) return 'Charging';
        if (batt.timeRemaining && batt.timeRemaining > 0 && batt.timeRemaining < 2000) {
          const h = Math.floor(batt.timeRemaining / 60);
          const m = batt.timeRemaining % 60;
          return `${h}:${String(m).padStart(2, '0')} left`;
        }
        return batt.percent >= 99 ? 'Charged' : '--';
      } catch {
        return '--';
      }
    }

    try {
      const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 1200 });
      const m = stdout.match(/(\d+:\d+)\s+remaining/i);
      if (m) return `${m[1]} left`;
      if (/charged/i.test(stdout)) return 'Charged';
      if (/charging/i.test(stdout)) return 'Charging';
      return '--';
    } catch {
      return '--';
    }
  }

  private async readPingMs(): Promise<number | null> {
    try {
      const args = IS_WIN
        ? ['-n', '1', '-w', '1000', '1.1.1.1']
        : ['-c', '1', '-W', '1000', '1.1.1.1'];
      const { stdout } = await execFileAsync('ping', args, { timeout: 1800 });
      const m = stdout.match(/time[=<]\s*([\d.]+)\s*ms/i);
      return m ? Math.round(Number(m[1])) : null;
    } catch {
      return null;
    }
  }

  private detectVpn(): boolean {
    const ifaces = os.networkInterfaces();
    for (const [name, list] of Object.entries(ifaces)) {
      if (!list) continue;
      if (/^(utun|ppp|ipsec|wg)|vpn|wireguard|tailscale|nordlynx/i.test(name)) {
        if (list.some((i) => i.family === 'IPv4' && !i.internal)) {
          return true;
        }
      }
    }
    return false;
  }

  private async readActiveContext(): Promise<{
    activeWindowTitle: string;
    activeBrowserUrl: string;
    activeBrowserTitle: string;
    runningApps: string[];
    micInputPct: number;
    darkMode: boolean;
  }> {
    let activeWindowTitle = '';
    let activeBrowserUrl = '';
    let activeBrowserTitle = '';
    let runningApps: string[] = [];
    let micInputPct = 50;
    let darkMode = true;

    if (IS_WIN) {
      try {
        const ps = `
$title = [DevDeckWinApi]::GetFrontWindowTitle()
$apps = (Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty ProcessName -Unique | Select-Object -First 16) -join '||'
$dm = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme
$isDark = if ($dm -eq 1) { 'false' } else { 'true' }
Write-Output ($title + '###' + $apps + '###' + $isDark)
`;
        const out = await runPowerShell(ps, 2500);
        const [winTitle, appsStr, dmStr] = out.trim().split('###');
        activeWindowTitle = (winTitle || '').trim();
        runningApps = (appsStr || '')
          .split('||')
          .map((s) => s.trim())
          .filter(Boolean);
        darkMode = dmStr !== 'false';
      } catch {
        // Ignore
      }
      return {
        activeWindowTitle,
        activeBrowserUrl,
        activeBrowserTitle,
        runningApps,
        micInputPct,
        darkMode,
      };
    }

    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appList to name of every application process whose background only is false
          set winTitle to ""
          try
            if (count of windows of frontApp) > 0 then
              set winTitle to name of window 1 of frontApp
            end if
          end try
          set dm to dark mode of appearance preferences as text
        end tell
        set micVol to input volume of (get volume settings) as text
        set AppleScript's text item delimiters to "||"
        return winTitle & "###" & (appList as text) & "###" & micVol & "###" & dm
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1800 });
      const [winTitle, appListStr, micStr, dmStr] = stdout.trim().split('###');
      activeWindowTitle = (winTitle || '').trim();
      runningApps = (appListStr || '')
        .split('||')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 16);
      micInputPct = Math.max(0, Math.min(100, Number(micStr) || 0));
      darkMode = dmStr === 'true';
    } catch {
      // Ignore
    }

    for (const browser of ['Google Chrome', 'Safari', 'Arc'] as const) {
      if (!runningApps.includes(browser)) continue;
      try {
        const bScript =
          browser === 'Safari'
            ? 'tell application "Safari" to if (count of windows) > 0 then return (URL of current tab of front window) & "|||" & (name of current tab of front window)'
            : `tell application "${browser}" to if (count of windows) > 0 then return (URL of active tab of front window) & "|||" & (title of active tab of front window)`;
        const { stdout } = await execFileAsync('osascript', ['-e', bScript], { timeout: 1200 });
        const [url, title] = stdout.trim().split('|||');
        if (url && /^https?:\/\//i.test(url)) {
          activeBrowserUrl = url;
          activeBrowserTitle = title || browser;
          break;
        }
      } catch {
        // Ignore
      }
    }

    return {
      activeWindowTitle,
      activeBrowserUrl,
      activeBrowserTitle,
      runningApps,
      micInputPct,
      darkMode,
    };
  }

  private readRecentFiles(): RecentFileInfo[] {
    const home = os.homedir();
    const results: RecentFileInfo[] = [];
    for (const folder of ['Downloads', 'Desktop'] as const) {
      const dir = path.join(home, folder);
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith('.')) continue;
          const full = path.join(dir, entry);
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          results.push({
            name: entry,
            folder,
            sizeKb: Math.max(1, Math.round(st.size / 1024)),
            mtime: st.mtimeMs,
          });
        }
      } catch {
        // Ignore permission errors
      }
    }
    return results.sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  }

  private readProjectScripts(): ProjectScriptInfo[] {
    try {
      const pkgPath = path.join(this.getProjectDir(), 'package.json');
      if (!fs.existsSync(pkgPath)) return [];
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      return Object.entries(pkg.scripts || {})
        .slice(0, 10)
        .map(([name, command]) => ({ name, command }));
    } catch {
      return [];
    }
  }

  async refresh(): Promise<MacDeepTelemetry> {
    if (this.busy) return this.latest;
    this.busy = true;
    try {
      await this.scanSlowHardware();
    const [load, timeRem, pingMs, ctx] = await Promise.all([
      si.currentLoad().catch(() => ({ cpus: [] as Array<{ load: number }> })),
      this.readBatteryRemaining(),
      this.readPingMs(),
      this.readActiveContext(),
    ]);

    this.latest = {
      batteryHealthPct: this.cachedSlow.batteryHealthPct,
      batteryCycles: this.cachedSlow.batteryCycles,
      batteryTimeRemaining: timeRem,
      batteryWattage: this.cachedSlow.batteryWattage,
      cpuCores: (load.cpus || []).map((c) => Math.round(c.load || 0)),
      uptimeSec: Math.floor(os.uptime()),
      displays: this.cachedSlow.displays,
      bluetoothDevices: this.cachedSlow.bluetoothDevices,
      wifiSsid: this.cachedSlow.wifiSsid,
      wifiSignalDbm: this.cachedSlow.wifiSignalDbm,
      pingMs,
      vpnActive: this.detectVpn(),
      lanIp: this.lanIp,
      activeWindowTitle: ctx.activeWindowTitle,
      activeBrowserUrl: ctx.activeBrowserUrl,
      activeBrowserTitle: ctx.activeBrowserTitle,
      runningApps: ctx.runningApps,
      recentFiles: this.readRecentFiles(),
      projectScripts: this.readProjectScripts(),
      micInputPct: ctx.micInputPct,
      micMuted: ctx.micInputPct === 0,
      audioOutputDevice: this.cachedSlow.audioOutputDevice,
      darkMode: ctx.darkMode,
      ts: Date.now(),
    };
      this.onUpdate(this.latest);
      return this.latest;
    } finally {
      this.busy = false;
    }
  }

  start(intervalMs = 6000): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
