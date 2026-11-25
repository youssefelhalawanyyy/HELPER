import { loadLocal, saveLocal } from './localStore.js';
import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type {
  NetworkCommandState,
  NetworkDevice,
  NetworkFixAction,
} from '../types/protocol.js';
import { loadDoctorAiKey } from './doctorAiAgent.js';

const execFileAsync = promisify(execFile);

const OUI_VENDORS: Record<string, string> = {
  '00:1a:11': 'Google',
  '3c:22:fb': 'Apple',
  'a4:83:e7': 'Apple',
  'f0:18:98': 'Apple',
  'ac:de:48': 'Apple',
  '28:cf:e9': 'Apple',
  'dc:a6:32': 'Raspberry Pi',
  'b8:27:eb': 'Raspberry Pi',
  'e4:5f:01': 'Raspberry Pi',
  '50:c7:bf': 'TP-Link',
  'c0:25:e9': 'TP-Link',
  '98:da:c4': 'TP-Link',
  'b0:be:76': 'TP-Link',
  '00:1b:2f': 'Netgear',
  'c4:04:15': 'Netgear',
  'f8:e4:3b': 'ASIX / USB LAN',
  '00:0c:29': 'VMware',
  '00:50:56': 'VMware',
  '08:00:27': 'VirtualBox',
  'f4:f5:d8': 'Google Nest',
  '44:65:0d': 'Amazon',
  'fc:65:de': 'Amazon',
  'b4:e6:2d': 'Espressif IoT',
  '24:6f:28': 'Espressif IoT',
  '78:21:84': 'Espressif IoT',
  '04:d4:c4': 'ASUS',
  '1c:87:2c': 'ASUS',
  '00:1e:58': 'D-Link',
  '2c:f0:5d': 'MSI',
  'd8:bb:c1': 'MSI',
  '00:25:00': 'Apple',
  'f0:99:bf': 'Apple',
  '70:85:c2': 'ASRock',
  'a8:5e:45': 'ASUS',
  'cc:2d:e0': 'Router / AP',
  '84:d8:1b': 'TP-Link',
  '20:df:b9': 'Google',
  '38:f9:d3': 'Apple',
  'bc:d0:74': 'Apple',
  '64:16:66': 'Nest',
};

function guessVendor(mac: string, hostname: string, isGateway: boolean): string {
  if (isGateway) return 'Wi-Fi Router / Gateway';
  const norm = mac
    .toLowerCase()
    .replace(/-/g, ':')
    .split(':')
    .map((p) => p.padStart(2, '0'))
    .join(':');
  const prefix = norm.slice(0, 8);
  if (OUI_VENDORS[prefix]) return OUI_VENDORS[prefix];
  const h = hostname.toLowerCase();
  if (/iphone|ipad|macbook|imac|apple/i.test(h)) return 'Apple';
  if (/galaxy|samsung/i.test(h)) return 'Samsung';
  if (/pixel|android/i.test(h)) return 'Android';
  if (/desktop|laptop|win/i.test(h)) return 'Windows PC';
  if (/playstation|ps5|xbox|nintendo/i.test(h)) return 'Game Console';
  // Locally administered MAC (randomized iOS/Android private Wi-Fi address)
  const firstByte = parseInt(norm.slice(0, 2), 16);
  if (Number.isFinite(firstByte) && (firstByte & 0x02) !== 0) {
    return 'Private Wi-Fi Device (Phone/Laptop)';
  }
  return 'Network Device';
}

export class NetworkCommandService {
  private state: NetworkCommandState = {
    scanning: false,
    testingSpeed: false,
    fixing: false,
    activeAction: '',
    ssid: 'Wi-Fi',
    signalDbm: null,
    localIp: '',
    gatewayIp: '',
    publicIp: '',
    isp: '',
    dnsServers: [],
    vpnActive: false,
    downMbps: null,
    upMbps: null,
    pingMs: null,
    jitterMs: null,
    packetLossPct: null,
    dnsMs: null,
    grade: 'IDLE',
    devices: [],
    wifiPassword: null,
    wifiPasswordNote: '',
    aiSummary:
      'Tap "SCAN LAN" to inspect all devices & IPs on your Wi-Fi, or "SPEED" & "AI BOOST & FIX" to speed up your internet.',
    problemsFound: [],
    whatWasFixed: [],
    aiTips: [],
    fixLog: [],
    updatedAt: 0,
  };

  constructor(
    private lanIp: string,
    private onUpdate: (state: NetworkCommandState) => void,
    private onAlert?: (kind: 'success' | 'error' | 'warning', message: string) => void,
  ) {
    this.state.localIp = lanIp;
  }

  getLatest(): NetworkCommandState {
    return this.state;
  }

  private emit(): void {
    this.onUpdate({
      ...this.state,
      dnsServers: [...this.state.dnsServers],
      devices: [...this.state.devices],
      problemsFound: [...this.state.problemsFound],
      whatWasFixed: [...this.state.whatWasFixed],
      aiTips: [...this.state.aiTips],
      fixLog: [...this.state.fixLog],
    });
  }

  private log(line: string): void {
    const stamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    console.log(`[DevDeck NetOps] ${line}`);
    this.state.fixLog = [...this.state.fixLog.slice(-60), `[${stamp}] ${line}`];
    this.emit();
  }

  private detectVpn(): boolean {
    const ifaces = os.networkInterfaces();
    for (const [name, list] of Object.entries(ifaces)) {
      if (!list) continue;
      if (/^(utun|ppp|ipsec|wg)|vpn|wireguard|tailscale|nordlynx/i.test(name)) {
        if (list.some((i) => i.family === 'IPv4' && !i.internal)) return true;
      }
    }
    return false;
  }

  private async readGatewayAndDns(): Promise<{ gatewayIp: string; dnsServers: string[] }> {
    let gatewayIp = '';
    const dnsSet = new Set<string>();

    if (IS_WIN) {
      try {
        const ps = `
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique | Select-Object -First 4)
Write-Output ("GW=" + $gw)
Write-Output ("DNS=" + ($dns -join ','))
`;
        const out = await runPowerShell(ps, 3500);
        for (const l of out.split(/\r?\n/)) {
          if (l.startsWith('GW=')) gatewayIp = l.slice(3).trim();
          else if (l.startsWith('DNS=')) {
            for (const d of l.slice(4).split(',')) {
              if (d.trim()) dnsSet.add(d.trim());
            }
          }
        }
      } catch {
        // Ignore
      }
      return { gatewayIp, dnsServers: Array.from(dnsSet) };
    }

    // macOS
    try {
      const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], { timeout: 2000 });
      const m = stdout.match(/gateway:\s*([\d.]+)/i);
      if (m) gatewayIp = m[1];
    } catch {
      // Ignore
    }
    try {
      const { stdout } = await execFileAsync('scutil', ['--dns'], { timeout: 2000 });
      for (const line of stdout.split('\n')) {
        const m = line.match(/nameserver\[\d+\]\s*:\s*([\d.]+)/);
        if (m) dnsSet.add(m[1]);
        if (dnsSet.size >= 4) break;
      }
    } catch {
      // Ignore
    }
    return { gatewayIp, dnsServers: Array.from(dnsSet) };
  }

  private async measureDnsMs(): Promise<number | null> {
    const t0 = Date.now();
    try {
      await dns.lookup('cloudflare.com');
      return Math.max(1, Date.now() - t0);
    } catch {
      return null;
    }
  }

  private async readWifiInfo(): Promise<{ ssid: string; signalDbm: number | null }> {
    const cleanSsid = (raw?: string | null) => {
      const s = (raw || '').trim();
      if (!s || /<redacted>|unknown/i.test(s)) return '';
      return s;
    };
    try {
      const conns = await si.wifiConnections();
      const first = conns[0];
      const name = cleanSsid(first?.ssid);
      if (name) {
        return {
          ssid: name,
          signalDbm: typeof first.signalLevel === 'number' ? first.signalLevel : null,
        };
      }
      if (typeof first?.signalLevel === 'number') {
        return { ssid: 'Connected Wi-Fi', signalDbm: first.signalLevel };
      }
    } catch {
      // Fall through
    }

    if (IS_WIN) {
      try {
        const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], { timeout: 2500 });
        const m = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
        if (cleanSsid(m?.[1])) return { ssid: cleanSsid(m?.[1]), signalDbm: null };
      } catch {
        // Ignore
      }
    } else {
      try {
        const { stdout } = await execFileAsync('networksetup', ['-getairportnetwork', 'en0'], {
          timeout: 2000,
        });
        const m = stdout.match(/Current Wi-Fi Network:\s*(.+)/i);
        if (cleanSsid(m?.[1])) return { ssid: cleanSsid(m?.[1]), signalDbm: null };
      } catch {
        // Ignore
      }
    }
    return { ssid: 'Connected Wi-Fi', signalDbm: null };
  }

  private async readPublicIp(): Promise<{ publicIp: string; isp: string }> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch('https://ipwho.is/', { signal: controller.signal });
      const data = (await res.json()) as {
        ip?: string;
        connection?: { isp?: string; org?: string };
        city?: string;
      };
      clearTimeout(t);
      if (data.ip) {
        const ispName = data.connection?.isp || data.connection?.org || '';
        const loc = data.city ? `${ispName}${ispName ? ' · ' : ''}${data.city}` : ispName;
        return { publicIp: data.ip, isp: loc };
      }
    } catch {
      clearTimeout(t);
    }
    return { publicIp: this.state.publicIp || '--', isp: this.state.isp || '' };
  }

  private async scanArpDevices(gatewayIp: string): Promise<NetworkDevice[]> {
    const devices: NetworkDevice[] = [];
    const seenIp = new Set<string>();

    // Always include this computer
    if (this.lanIp) {
      seenIp.add(this.lanIp);
      devices.push({
        ip: this.lanIp,
        mac: 'THIS COMPUTER',
        hostname: os.hostname(),
        vendor: IS_WIN ? 'Windows PC (Host)' : 'Mac (Host)',
        isSelf: true,
      });
    }

    try {
      const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 3000, maxBuffer: 1024 * 1024 });
      for (const raw of stdout.split(/\r?\n/)) {
        if (IS_WIN) {
          // Windows: 192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic
          const m = raw.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+(dynamic|static)/i);
          if (!m) continue;
          const ip = m[1];
          const mac = m[2].replace(/-/g, ':').toLowerCase();
          if (seenIp.has(ip) || /^224\.|^239\.|^255\.|\.255$/.test(ip) || mac === 'ff:ff:ff:ff:ff:ff') {
            continue;
          }
          seenIp.add(ip);
          const isGw = ip === gatewayIp;
          devices.push({
            ip,
            mac,
            hostname: isGw ? 'Router Gateway' : ip,
            vendor: guessVendor(mac, '', isGw),
            isGateway: isGw,
          });
        } else {
          // macOS: hostname (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
          const m = raw.match(/^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
          if (!m) continue;
          const rawHost = m[1] === '?' ? '' : m[1].replace(/\.local$/i, '');
          const ip = m[2];
          const mac = m[3].toLowerCase();
          if (
            seenIp.has(ip) ||
            mac === '(incomplete)' ||
            mac === 'ff:ff:ff:ff:ff:ff' ||
            /^224\.|^239\.|^255\.|\.255$/.test(ip)
          ) {
            continue;
          }
          seenIp.add(ip);
          const isGw = ip === gatewayIp;
          devices.push({
            ip,
            mac,
            hostname: rawHost || (isGw ? 'Router Gateway' : ip),
            vendor: guessVendor(mac, rawHost, isGw),
            isGateway: isGw,
          });
        }
      }
    } catch {
      // Ignore
    }

    // Sort: Gateway first, then Self, then by IP
    return devices
      .sort((a, b) => {
        if (a.isGateway) return -1;
        if (b.isGateway) return 1;
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return a.ip.localeCompare(b.ip, undefined, { numeric: true });
      })
      .slice(0, 24);
  }

  private async measurePingJitter(): Promise<{
    pingMs: number | null;
    jitterMs: number | null;
    packetLossPct: number | null;
  }> {
    try {
      const args = IS_WIN ? ['-n', '5', '-w', '1000', '1.1.1.1'] : ['-c', '5', '-i', '0.2', '1.1.1.1'];
      const { stdout } = await execFileAsync('ping', args, { timeout: 6000 });
      const times: number[] = [];
      for (const m of stdout.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)) {
        times.push(Number(m[1]));
      }
      const lossMatch = stdout.match(/(\d+(?:\.\d+)?)%\s*(?:packet\s*)?loss/i);
      const packetLossPct = lossMatch ? Math.round(Number(lossMatch[1])) : times.length === 0 ? 100 : 0;
      if (times.length === 0) return { pingMs: null, jitterMs: null, packetLossPct };

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      let jitter = 0;
      if (times.length > 1) {
        let diffs = 0;
        for (let i = 1; i < times.length; i += 1) diffs += Math.abs(times[i] - times[i - 1]);
        jitter = diffs / (times.length - 1);
      }
      return {
        pingMs: Math.round(avg),
        jitterMs: Number(jitter.toFixed(1)),
        packetLossPct,
      };
    } catch {
      return { pingMs: null, jitterMs: null, packetLossPct: null };
    }
  }

  private computeGrade(down: number | null, ping: number | null, loss: number | null): NetworkCommandState['grade'] {
    if (down === null) return 'IDLE';
    if ((loss ?? 0) >= 5 || down < 15 || (ping ?? 0) > 120) return 'SLOW';
    if (down < 45 || (ping ?? 0) > 65) return 'FAIR';
    if (down >= 150 && (ping ?? 0) <= 35) return 'ULTRA';
    return 'FAST';
  }

  private buildLocalAdvice(): { summary: string; problems: string[]; tips: string[] } {
    const s = this.state;
    const problems: string[] = [];
    const tips: string[] = [];
    const usingFastDns = s.dnsServers.some((d) => d === '1.1.1.1' || d === '8.8.8.8');

    if (!usingFastDns) {
      problems.push(
        `Your computer is using default router/ISP DNS (${s.dnsServers[0] || 'auto'}), which is slower at looking up websites.`,
      );
      tips.push('Tap "1.1.1.1 DNS" or "AI BOOST & FIX" to switch to Cloudflare 1.1.1.1 + Google 8.8.8.8 DNS for noticeably faster web browsing.');
    }
    if (s.signalDbm !== null && s.signalDbm < -70) {
      problems.push(`Weak Wi-Fi signal (${s.signalDbm} dBm) is reducing your speed and causing dropouts.`);
      tips.push('Move closer to your Wi-Fi router or connect to the 5 GHz Wi-Fi band.');
    }
    if ((s.packetLossPct ?? 0) > 0) {
      problems.push(`Packet loss detected (${s.packetLossPct}%) — data is being dropped between your device and the internet.`);
      tips.push('Tap "RENEW IP" or restart your router/modem for 30 seconds.');
    }
    if ((s.pingMs ?? 0) > 55) {
      problems.push(`High ping latency (${s.pingMs} ms) makes websites, video calls, and games feel delayed.`);
    }
    if ((s.jitterMs ?? 0) > 10) {
      problems.push(`Unstable jitter (${s.jitterMs} ms) across ${s.devices.length} connected LAN devices.`);
      tips.push('Check the Devices tab — another phone, TV, or PC on your Wi-Fi may be streaming or downloading heavily.');
    }
    if (s.downMbps !== null && s.downMbps < 25) {
      problems.push(`Slow download speed (${s.downMbps} Mbps) — below ideal speed for HD streaming & fast downloads.`);
      tips.push('Use an Ethernet cable if possible, or restart your router to clear ISP line congestion.');
    }
    if (s.vpnActive) {
      problems.push('VPN is turned ON, which adds encryption overhead and extra distance.');
      tips.push('Turn off VPN temporarily when you need maximum download speed.');
    }
    if (tips.length === 0) {
      tips.push('Your Wi-Fi, DNS, and internet latency look healthy and fast!');
    }

    const summary =
      s.downMbps !== null
        ? `Your internet is ${s.downMbps} Mbps download / ${s.upMbps ?? 0} Mbps upload with ${s.pingMs ?? '--'} ms ping (${s.jitterMs ?? 0} ms jitter)${s.dnsMs ? ` and ${s.dnsMs} ms DNS lookup` : ''}. ${
            problems.length > 0
              ? `Found ${problems.length} issue(s) slowing your connection down — see details below.`
              : 'No major problems found — your connection is running fast and clean!'
          }`
        : `Connected to ${s.ssid} (${s.isp || s.localIp}) with ${s.devices.length} device(s) on your Wi-Fi and ${s.pingMs ?? '--'} ms ping. ${
            problems.length > 0
              ? `Found ${problems.length} issue(s) — tap "AI BOOST & FIX" to fix and benchmark speed.`
              : 'Tap "SPEED" to measure your exact Download & Upload Mbps.'
          }`;
    return { summary, problems, tips };
  }

  async scanNetwork(): Promise<NetworkCommandState> {
    if (this.state.scanning) return this.state;
    this.state.scanning = true;
    this.state.activeAction = 'Scanning Wi-Fi, Gateway, DNS & LAN devices…';
    this.emit();

    try {
      const [wifi, gwDns, pub, pingStats, dnsMs] = await Promise.all([
        this.readWifiInfo(),
        this.readGatewayAndDns(),
        this.readPublicIp(),
        this.measurePingJitter(),
        this.measureDnsMs(),
      ]);

      const devices = await this.scanArpDevices(gwDns.gatewayIp);
      const gateway = devices.find((d) => d.isGateway);
      if (gwDns.gatewayIp && (gateway || wifi.ssid !== 'Connected Wi-Fi')) {
        const networks = loadLocal<Record<string, string[]>>('networks.json', {});
        const key = JSON.stringify([wifi.ssid, gateway?.mac || gwDns.gatewayIp]);
        const previous = networks[key];
        const known = new Set(previous);
        for (const device of devices) {
          if (device.isSelf || device.isGateway) continue;
          const mac = device.mac
            .toLowerCase()
            .replace(/-/g, ':')
            .split(':')
            .map((part) => part.padStart(2, '0'))
            .join(':');
          if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac) || parseInt(mac.slice(0, 2), 16) & 1) continue;
          device.isNew = !!previous && !known.has(mac);
          known.add(mac);
        }
        if (gateway || known.size) {
          networks[key] = [...known];
          saveLocal('networks.json', networks);
          const count = devices.filter((d) => d.isNew).length;
          if (count)
            this.onAlert?.('warning', count + ' newly observed Wi-Fi device' + (count > 1 ? 's' : ''));
        }
      }

      this.state = {
        ...this.state,
        scanning: false,
        activeAction: '',
        ssid: wifi.ssid,
        signalDbm: wifi.signalDbm,
        localIp: this.lanIp,
        gatewayIp: gwDns.gatewayIp,
        publicIp: pub.publicIp,
        isp: pub.isp,
        dnsServers: gwDns.dnsServers,
        vpnActive: this.detectVpn(),
        pingMs: pingStats.pingMs,
        jitterMs: pingStats.jitterMs,
        packetLossPct: pingStats.packetLossPct,
        dnsMs,
        devices,
        updatedAt: Date.now(),
      };
      const adv = this.buildLocalAdvice();
      this.state.aiSummary = adv.summary;
      this.state.problemsFound = adv.problems;
      this.state.aiTips = adv.tips;
      this.log(`Scanned LAN: ${devices.length} device(s), Gateway ${gwDns.gatewayIp || '--'}, Ping ${pingStats.pingMs ?? '--'}ms, DNS ${dnsMs ?? '--'}ms`);
      this.emit();
      return this.state;
    } catch {
      this.state.scanning = false;
      this.state.activeAction = '';
      this.emit();
      return this.state;
    }
  }

  async runSpeedTest(): Promise<NetworkCommandState> {
    if (this.state.testingSpeed) return this.state;
    this.state.testingSpeed = true;
    this.state.activeAction = 'Running live Download, Upload, Ping & Jitter benchmark…';
    this.log('Starting professional internet speed & latency benchmark…');
    this.emit();

    try {
      const pingStats = await this.measurePingJitter();
      let downMbps = 0;
      let upMbps = 0;

      if (!IS_WIN) {
        try {
          const { stdout } = await execFileAsync('networkQuality', ['-c'], { timeout: 25_000 });
          const parsed = JSON.parse(stdout) as { dl_throughput?: number; ul_throughput?: number };
          downMbps = Number(((parsed.dl_throughput || 0) / 1_000_000).toFixed(1));
          upMbps = Number(((parsed.ul_throughput || 0) / 1_000_000).toFixed(1));
        } catch {
          // Fall back to Cloudflare test below
        }
      }

      if (downMbps <= 0) {
        // Real Cloudflare 10MB download + 2MB upload throughput benchmark (works on Windows + Mac)
        const dlStart = Date.now();
        const dlRes = await fetch('https://speed.cloudflare.com/__down?bytes=10000000');
        const dlBuf = await dlRes.arrayBuffer();
        const dlSec = Math.max(0.1, (Date.now() - dlStart) / 1000);
        downMbps = Number(((dlBuf.byteLength * 8) / dlSec / 1_000_000).toFixed(1));

        try {
          const ulPayload = new Uint8Array(2_000_000);
          const ulStart = Date.now();
          await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body: ulPayload });
          const ulSec = Math.max(0.1, (Date.now() - ulStart) / 1000);
          upMbps = Number(((ulPayload.byteLength * 8) / ulSec / 1_000_000).toFixed(1));
        } catch {
          upMbps = 0;
        }
      }

      this.state = {
        ...this.state,
        testingSpeed: false,
        activeAction: '',
        downMbps,
        upMbps,
        pingMs: pingStats.pingMs,
        jitterMs: pingStats.jitterMs,
        packetLossPct: pingStats.packetLossPct,
        grade: this.computeGrade(downMbps, pingStats.pingMs, pingStats.packetLossPct),
        updatedAt: Date.now(),
      };
      const adv = this.buildLocalAdvice();
      this.state.aiSummary = adv.summary;
      this.state.problemsFound = adv.problems;
      this.state.aiTips = adv.tips;
      this.log(`Speed Test: ↓${downMbps} Mbps · ↑${upMbps} Mbps · Ping ${pingStats.pingMs ?? '--'}ms · Jitter ${pingStats.jitterMs ?? 0}ms`);
      this.emit();
      this.onAlert?.('success', `Speed: ↓${downMbps} Mbps · ↑${upMbps} Mbps (${pingStats.pingMs ?? '--'}ms)`);
      return this.state;
    } catch (err) {
      this.state.testingSpeed = false;
      this.state.activeAction = '';
      this.log(`Speed test error: ${err instanceof Error ? err.message : 'failed'}`);
      this.emit();
      return this.state;
    }
  }

  async revealWifiPassword(): Promise<string> {
    const wifi = await this.readWifiInfo();
    const ssid = wifi.ssid;
    if (!ssid || ssid === 'Wi-Fi / Ethernet') {
      this.state.wifiPassword = null;
      this.state.wifiPasswordNote = 'No active Wi-Fi SSID detected (using Ethernet?)';
      this.emit();
      return this.state.wifiPasswordNote;
    }

    try {
      if (IS_WIN) {
        const { stdout } = await execFileAsync(
          'netsh',
          ['wlan', 'show', 'profile', `name=${ssid}`, 'key=clear'],
          { timeout: 3500 },
        );
        const m = stdout.match(/Key Content\s*:\s*(.+)/i);
        if (m?.[1]) {
          this.state.wifiPassword = m[1].trim();
          this.state.wifiPasswordNote = `Retrieved saved password for "${ssid}"`;
          this.emit();
          return `Wi-Fi password loaded for ${ssid}`;
        }
        this.state.wifiPassword = null;
        this.state.wifiPasswordNote = 'Password not stored or open network';
        this.emit();
        return this.state.wifiPasswordNote;
      }

      // macOS Keychain lookup (user approves macOS Keychain prompt if asked)
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-wa', ssid],
        { timeout: 15_000 },
      );
      const pw = stdout.trim();
      if (pw) {
        this.state.wifiPassword = pw;
        this.state.wifiPasswordNote = `Retrieved Keychain password for "${ssid}"`;
        this.emit();
        return `Wi-Fi password loaded for ${ssid}`;
      }
      this.state.wifiPasswordNote = 'Keychain returned empty password';
      this.emit();
      return this.state.wifiPasswordNote;
    } catch {
      this.state.wifiPassword = null;
      this.state.wifiPasswordNote = IS_WIN
        ? 'Could not read Wi-Fi password (run as Admin if restricted)'
        : 'Approve the macOS Keychain prompt on your Mac screen to reveal Wi-Fi password';
      this.emit();
      return this.state.wifiPasswordNote;
    }
  }

  private async runAiNetworkAnalysis(): Promise<void> {
    const apiKey = loadDoctorAiKey();
    if (!apiKey) {
      const adv = this.buildLocalAdvice();
      this.state.aiSummary = adv.summary;
      this.state.problemsFound = adv.problems;
      this.state.aiTips = adv.tips;
      return;
    }

    const models = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'];
    const prompt = `You are a professional network engineer. Analyze this real Wi-Fi & LAN snapshot and reply in simple, easy-to-understand English JSON:
{ "summary": "2-sentence plain English verdict on speed, latency, and LAN congestion", "tips": ["3 short actionable steps to make this internet faster"] }
Data: ${JSON.stringify({
      ssid: this.state.ssid,
      signalDbm: this.state.signalDbm,
      downMbps: this.state.downMbps,
      upMbps: this.state.upMbps,
      pingMs: this.state.pingMs,
      jitterMs: this.state.jitterMs,
      packetLossPct: this.state.packetLossPct,
      dnsServers: this.state.dnsServers,
      vpnActive: this.state.vpnActive,
      deviceCount: this.state.devices.length,
      devices: this.state.devices.slice(0, 10).map((d) => `${d.hostname} (${d.vendor})`),
    })}`;

    for (const model of models) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          },
        );
        clearTimeout(t);
        if (!res.ok) continue;
        const j = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const raw = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim()) as {
          summary?: string;
          tips?: string[];
        };
        if (parsed.summary) {
          this.state.aiSummary = parsed.summary;
          this.state.aiTips = Array.isArray(parsed.tips) ? parsed.tips.slice(0, 4) : [];
          this.log(`AI Network Verdict ready (${model})`);
          return;
        }
      } catch {
        clearTimeout(t);
      }
    }

    const adv = this.buildLocalAdvice();
    this.state.aiSummary = adv.summary;
    this.state.aiTips = adv.tips;
  }

  async runNetworkFix(action: NetworkFixAction): Promise<string> {
    if (this.state.fixing) return 'Network optimization already running';
    this.state.fixing = true;
    this.state.activeAction = action.replace(/_/g, ' ').toUpperCase();
    this.emit();

    let msg = 'Network optimization complete';
    try {
      const doFlush = async () => {
        this.log('Flushing DNS & local routing cache…');
        if (IS_WIN) {
          await execFileAsync('ipconfig', ['/flushdns'], { timeout: 5000 });
        } else {
          await execFileAsync('dscacheutil', ['-flushcache'], { timeout: 5000 });
        }
        this.state.whatWasFixed = [
          'Flushed stale DNS cache so websites resolve cleanly.',
          ...this.state.whatWasFixed.filter((x) => !x.includes('Flushed stale DNS')),
        ].slice(0, 6);
        this.log('✅ DNS cache flushed');
      };

      const doBoostDns = async () => {
        this.log('Switching Wi-Fi DNS → Cloudflare 1.1.1.1 + Google 8.8.8.8…');
        if (IS_WIN) {
          await runPowerShell(
            `$ad = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1; if ($ad) { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses ('1.1.1.1','8.8.8.8') }`,
            6000,
          );
        } else {
          await execFileAsync('networksetup', ['-setdnsservers', 'Wi-Fi', '1.1.1.1', '8.8.8.8'], {
            timeout: 5000,
          });
        }
        this.state.whatWasFixed = [
          'Switched Wi-Fi DNS to Cloudflare (1.1.1.1) & Google (8.8.8.8) for faster web lookups.',
          ...this.state.whatWasFixed.filter((x) => !x.includes('Cloudflare (1.1.1.1)')),
        ].slice(0, 6);
        this.log('✅ Fast DNS active (1.1.1.1 & 8.8.8.8)');
      };

      const doRenewDhcp = async () => {
        this.log('Renewing DHCP lease & refreshing Wi-Fi IP…');
        if (IS_WIN) {
          await execFileAsync('ipconfig', ['/renew'], { timeout: 12_000 });
        } else {
          await execFileAsync('ipconfig', ['set', 'en0', 'DHCP'], { timeout: 8000 }).catch(() => {});
        }
        this.state.whatWasFixed = [
          'Renewed DHCP IP lease with your Wi-Fi router.',
          ...this.state.whatWasFixed.filter((x) => !x.includes('DHCP IP lease')),
        ].slice(0, 6);
        this.log('✅ DHCP lease refreshed');
      };

      if (action === 'flush_dns') {
        await doFlush();
        msg = 'DNS cache flushed';
      } else if (action === 'boost_dns') {
        await doBoostDns();
        await doFlush();
        msg = 'Switched to Ultra-Fast DNS (1.1.1.1 & 8.8.8.8)';
      } else if (action === 'renew_dhcp') {
        await doRenewDhcp();
        msg = 'DHCP lease renewed';
      } else if (action === 'ai_analyze') {
        this.log('Running AI Network & LAN Congestion Analysis…');
        await this.scanNetwork();
        await this.runAiNetworkAnalysis();
        msg = 'AI Network Analysis complete';
      } else if (action === 'full_net_fix') {
        this.log('=== Starting Full Internet Speed-Up & Fix ===');
        try {
          await doBoostDns();
        } catch {
          this.log('⚠ DNS change needs Admin rights — continuing with flush & benchmark');
        }
        await doFlush();
        this.state.fixing = false;
        await this.scanNetwork();
        await this.runSpeedTest();
        await this.runAiNetworkAnalysis();
        msg = `Internet Boost Complete (${this.state.downMbps ?? '--'} Mbps · ${this.state.pingMs ?? '--'} ms)`;
        this.log(`✅ ${msg}`);
        this.emit();
        this.onAlert?.('success', msg);
        return msg;
      }

      this.state.fixing = false;
      this.state.activeAction = '';
      await this.scanNetwork();
      this.onAlert?.('success', msg);
      return msg;
    } catch (err) {
      const em = err instanceof Error ? err.message : 'Network fix failed';
      this.log(`❌ ${em}`);
      this.state.fixing = false;
      this.state.activeAction = '';
      this.emit();
      this.onAlert?.('error', em.slice(0, 80));
      return em;
    }
  }
}
