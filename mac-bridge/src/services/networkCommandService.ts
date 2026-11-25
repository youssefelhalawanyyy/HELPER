import { loadLocal, saveLocal } from './localStore.js';
import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { IS_WIN, runPowerShell } from '../platform/win32.js';
import type {
  NetOpsDnsRecord,
  NetOpsHopMetric,
  NetOpsPortResult,
  NetOpsProbeResult,
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
  '00:25:00': 'Apple',
  'f0:99:bf': 'Apple',
  '38:f9:d3': 'Apple',
  'bc:d0:74': 'Apple',
  '14:7d:da': 'Apple',
  'dca6:32': 'Raspberry Pi',
  'dc:a6:32': 'Raspberry Pi',
  'b8:27:eb': 'Raspberry Pi',
  'e4:5f:01': 'Raspberry Pi',
  '28:cd:c1': 'Raspberry Pi',
  '50:c7:bf': 'TP-Link',
  'c0:25:e9': 'TP-Link',
  '98:da:c4': 'TP-Link',
  'b0:be:76': 'TP-Link',
  '84:d8:1b': 'TP-Link',
  '00:1b:2f': 'Netgear',
  'c4:04:15': 'Netgear',
  'f8:e4:3b': 'ASIX / USB LAN',
  '00:0c:29': 'VMware',
  '00:50:56': 'VMware',
  '08:00:27': 'VirtualBox',
  'f4:f5:d8': 'Google Nest',
  '20:df:b9': 'Google',
  '64:16:66': 'Google Nest',
  '44:65:0d': 'Amazon',
  'fc:65:de': 'Amazon',
  'b4:e6:2d': 'Espressif IoT',
  '24:6f:28': 'Espressif IoT',
  '78:21:84': 'Espressif IoT',
  '30:ae:a4': 'Espressif IoT',
  '04:d4:c4': 'ASUS',
  '1c:87:2c': 'ASUS',
  'a8:5e:45': 'ASUS',
  '00:1e:58': 'D-Link',
  '2c:f0:5d': 'MSI',
  'd8:bb:c1': 'MSI',
  '70:85:c2': 'ASRock',
  'cc:2d:e0': 'MikroTik / Router',
  '74:83:c2': 'Ubiquiti UniFi',
  'f0:9f:c2': 'Ubiquiti UniFi',
  '24:5a:4c': 'Ubiquiti UniFi',
  '00:11:32': 'Synology NAS',
  '5c:aa:fd': 'Sonos',
  'b8:e9:37': 'Sonos',
  '28:39:5e': 'Samsung',
  '8c:79:f5': 'Samsung',
  '64:b5:c6': 'Nintendo',
  '7c:bb:8a': 'Nintendo',
  'c8:63:f1': 'Sony PlayStation',
  '00:d9:d1': 'Sony PlayStation',
  '7c:ed:8d': 'Microsoft',
};

const COMMON_PORTS: Array<{ port: number; service: string }> = [
  { port: 22, service: 'SSH' },
  { port: 53, service: 'DNS' },
  { port: 80, service: 'HTTP' },
  { port: 443, service: 'HTTPS' },
  { port: 445, service: 'SMB' },
  { port: 3000, service: 'Dev/Next' },
  { port: 3306, service: 'MySQL' },
  { port: 5000, service: 'API/AirPlay' },
  { port: 5173, service: 'Vite' },
  { port: 5432, service: 'Postgres' },
  { port: 6379, service: 'Redis' },
  { port: 8000, service: 'HTTP-Alt' },
  { port: 8080, service: 'Proxy/Web' },
  { port: 8443, service: 'HTTPS-Alt' },
];

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
  if (/iphone|ipad|macbook|imac|apple|airpods|homepod/i.test(h)) return 'Apple';
  if (/galaxy|samsung/i.test(h)) return 'Samsung';
  if (/pixel|android|xiaomi|redmi|oppo|oneplus/i.test(h)) return 'Android';
  if (/desktop|laptop|win/i.test(h)) return 'Windows PC';
  if (/playstation|ps5|ps4|xbox|nintendo/i.test(h)) return 'Game Console';
  if (/lgwebos|bravia|roku|chromecast|tv/i.test(h)) return 'Smart TV';
  if (/printer|epson|canon|hp|brother/i.test(h)) return 'Network Printer';
  const firstByte = parseInt(norm.slice(0, 2), 16);
  if (Number.isFinite(firstByte) && (firstByte & 0x02) !== 0) {
    return 'Private Wi-Fi Device (Phone/Laptop)';
  }
  return 'LAN Device';
}

function hopStatus(ms: number | null, warnAt = 45, badAt = 110): NetOpsHopMetric['status'] {
  if (ms === null) return 'idle';
  if (ms >= badAt) return 'bad';
  if (ms >= warnAt) return 'warn';
  return 'ok';
}

function sanitizeTarget(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname;
    }
  } catch {
    // Fall through
  }
  const hostOnly = trimmed.split('/')[0]?.split(':')[0]?.trim() || '';
  if (!/^[a-zA-Z0-9._-]+$/.test(hostOnly) || hostOnly.length > 253) {
    return '';
  }
  return hostOnly;
}

async function checkTcpPort(host: string, port: number, timeoutMs = 850): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ms: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ms);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(Math.max(1, Math.round(performance.now() - t0))));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    try {
      socket.connect(port, host);
    } catch {
      finish(null);
    }
  });
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
    colo: '',
    dnsServers: [],
    vpnActive: false,
    downMbps: null,
    upMbps: null,
    pingMs: null,
    gatewayPingMs: null,
    googlePingMs: null,
    jitterMs: null,
    packetLossPct: null,
    dnsMs: null,
    speedPhase: 'idle',
    hops: [],
    grade: 'IDLE',
    devices: [],
    wifiPassword: null,
    wifiPasswordNote: '',
    aiSummary:
      'Tap "SCAN LAN" to discover every device & hop on your Wi-Fi, or "SPEED" & "BOOST & FIX" to benchmark and optimize your connection.',
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
      hops: this.state.hops ? [...this.state.hops] : [],
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
    this.state.fixLog = [...this.state.fixLog.slice(-80), `[${stamp}] ${line}`];
    this.emit();
  }

  private detectVpn(): boolean {
    const ifaces = os.networkInterfaces();
    for (const [name, list] of Object.entries(ifaces)) {
      if (!list) continue;
      if (/^(utun|ppp|ipsec|wg)|vpn|wireguard|tailscale|nordlynx|tun0/i.test(name)) {
        if (list.some((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))) {
          return true;
        }
      }
    }
    return false;
  }

  private async getActiveMacNetworkService(): Promise<{ service: string; device: string }> {
    let defaultDev = 'en0';
    try {
      const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], { timeout: 2000 });
      const m = stdout.match(/interface:\s*(\S+)/i);
      if (m?.[1]) defaultDev = m[1].trim();
    } catch {
      // Ignore
    }

    try {
      const { stdout } = await execFileAsync('networksetup', ['-listnetworkserviceorder'], {
        timeout: 2500,
      });
      const blocks = stdout.split(/\n\s*\n/);
      for (const b of blocks) {
        if (b.includes(`Device: ${defaultDev}`)) {
          const hp = b.match(/Hardware Port:\s*([^,]+)/i);
          const svc = b.match(/^\(\d+\)\s*(.+)$/m);
          const name = (svc?.[1] || hp?.[1] || '').trim();
          if (name && !name.startsWith('*')) return { service: name, device: defaultDev };
        }
      }
    } catch {
      // Fall back to Wi-Fi
    }
    return { service: 'Wi-Fi', device: defaultDev };
  }

  private async readGatewayAndDns(): Promise<{ gatewayIp: string; dnsServers: string[] }> {
    let gatewayIp = '';
    const dnsSet = new Set<string>();

    if (IS_WIN) {
      try {
        const ps = `
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$idx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex
$dns = @()
if ($idx) {
  $dns = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ServerAddresses)
}
if (-not $dns -or $dns.Count -eq 0) {
  $dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique | Select-Object -First 4)
}
Write-Output ("GW=" + $gw)
Write-Output ("DNS=" + (($dns | Select-Object -Unique | Select-Object -First 4) -join ','))
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
    const t0 = performance.now();
    try {
      await dns.resolve4('cloudflare.com');
      return Math.max(1, Math.round(performance.now() - t0));
    } catch {
      try {
        await dns.lookup('cloudflare.com');
        return Math.max(1, Math.round(performance.now() - t0));
      } catch {
        return null;
      }
    }
  }

  private async readWifiInfo(): Promise<{ ssid: string; signalDbm: number | null }> {
    const cleanSsid = (raw?: string | null) => {
      const s = (raw || '').trim();
      if (!s || /<redacted>|unknown|not associated/i.test(s)) return '';
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
        const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], {
          timeout: 2500,
          windowsHide: true,
        });
        const m = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
        const sigMatch = stdout.match(/^\s*Signal\s*:\s*(\d+)%/m);
        const approxDbm = sigMatch ? Math.round(Number(sigMatch[1]) / 2 - 100) : null;
        if (cleanSsid(m?.[1])) return { ssid: cleanSsid(m?.[1]), signalDbm: approxDbm };
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
    return { ssid: 'Connected Network', signalDbm: null };
  }

  private async readPublicIp(): Promise<{ publicIp: string; isp: string; colo: string }> {
    let cfIp = '';
    let colo = '';
    let city = '';

    // 1. Fast Cloudflare Edge metadata probe (<250ms, never rate-limited)
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}`, {
        signal: ctrl.signal,
      });
      clearTimeout(t);
      cfIp = res.headers.get('cf-meta-ip') || '';
      colo = res.headers.get('cf-meta-colo') || '';
      city = res.headers.get('cf-meta-city') || '';
      await res.arrayBuffer().catch(() => {});
    } catch {
      // Ignore
    }

    // 2. Enrich ISP name from ipwho.is
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2800);
    try {
      const res = await fetch('https://ipwho.is/', { signal: controller.signal });
      const data = (await res.json()) as {
        ip?: string;
        connection?: { isp?: string; org?: string };
        city?: string;
      };
      clearTimeout(t);
      if (data.ip || cfIp) {
        const ispName = data.connection?.isp || data.connection?.org || '';
        const cityLabel = data.city || city;
        const loc = cityLabel ? `${ispName}${ispName ? ' · ' : ''}${cityLabel}` : ispName;
        return { publicIp: data.ip || cfIp, isp: loc, colo };
      }
    } catch {
      clearTimeout(t);
    }

    if (cfIp) {
      return {
        publicIp: cfIp,
        isp: city ? `${city}${colo ? ` · Edge ${colo}` : ''}` : colo ? `Edge ${colo}` : '',
        colo,
      };
    }
    return {
      publicIp: this.state.publicIp || '--',
      isp: this.state.isp || '',
      colo: this.state.colo || '',
    };
  }

  /**
   * Active non-privileged /24 batched multi-wave neighbor sweep:
   * Sends paced batches (avoiding macOS ENOBUFS ARP queue drops) across 2 waves + subnet broadcast ping
   * so sleeping iPhones, Androids, TVs, and IoT devices all wake up and populate the OS ARP table.
   */
  private async sweepLocalSubnet(): Promise<void> {
    let localIp = this.lanIp;
    if (!localIp || localIp.split('.').length !== 4) {
      const ifaces = os.networkInterfaces();
      for (const list of Object.values(ifaces)) {
        for (const addr of list || []) {
          if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
            localIp = addr.address;
            break;
          }
        }
        if (localIp) break;
      }
    }
    const parts = (localIp || '').split('.');
    if (parts.length !== 4) return;
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const selfHost = Number(parts[3]);
    const broadcastIp = `${prefix}255`;

    // Kick off a fast subnet broadcast ping in parallel (wakes many Linux/IoT/Mac hosts immediately)
    if (!IS_WIN) {
      void execFileAsync('ping', ['-c', '2', '-W', '400', broadcastIp], { timeout: 1400 }).catch(
        () => {},
      );
    }

    await new Promise<void>((resolve) => {
      let sock: dgram.Socket | null = null;
      const cleanup = () => {
        try {
          sock?.close();
        } catch {
          // Ignore
        }
        resolve();
      };

      try {
        sock = dgram.createSocket('udp4');
        sock.on('error', () => {});
        const payload = Buffer.from([0x00]);
        const ips: string[] = [];
        for (let i = 1; i <= 254; i += 1) {
          if (i !== selfHost) ips.push(`${prefix}${i}`);
        }

        // Send in paced batches of 24 IPs every 18ms (2 waves) so kernel ARP queue never drops entries
        const batchSize = 24;
        let idx = 0;
        let wave = 0;

        const sendNextBatch = () => {
          if (!sock) return cleanup();
          const end = Math.min(ips.length, idx + batchSize);
          const port = wave === 0 ? 9 : 5353;
          for (let j = idx; j < end; j += 1) {
            try {
              sock.send(payload, port, ips[j]);
            } catch {
              // Ignore transient buffer errors
            }
          }
          idx = end;
          if (idx < ips.length) {
            setTimeout(sendNextBatch, 18);
          } else if (wave === 0) {
            // Second pass wakes sleeping mobile devices in Wi-Fi DTIM power-save mode
            wave = 1;
            idx = 0;
            setTimeout(sendNextBatch, 90);
          } else {
            // Allow final ARP replies to settle
            setTimeout(cleanup, 520);
          }
        };

        sendNextBatch();
      } catch {
        cleanup();
      }
    });
  }

  private async scanArpDevices(gatewayIp: string): Promise<NetworkDevice[]> {
    await this.sweepLocalSubnet();

    const devices: NetworkDevice[] = [];
    const seenIp = new Set<string>();

    if (this.lanIp) {
      seenIp.add(this.lanIp);
      devices.push({
        ip: this.lanIp,
        mac: 'THIS COMPUTER',
        hostname: os.hostname(),
        vendor: IS_WIN ? 'Windows PC (Host)' : 'Mac (Host)',
        latencyMs: 0,
        isSelf: true,
      });
    }

    try {
      // CRITICAL: Use `arp -an` on macOS/Linux (numeric, zero blocking DNS lookups!) so it completes in ~3ms
      // instead of timing out after 3s on 200+ `(incomplete)` reverse-DNS queries!
      const arpArgs = IS_WIN ? ['-a'] : ['-an'];
      const { stdout } = await execFileAsync('arp', arpArgs, {
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      for (const raw of stdout.split(/\r?\n/)) {
        if (IS_WIN) {
          const m = raw.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+(dynamic|static)/i);
          if (!m) continue;
          const ip = m[1];
          const mac = m[2].replace(/-/g, ':').toLowerCase();
          if (
            seenIp.has(ip) ||
            /^224\.|^239\.|^255\.|^169\.254\.|\.255$|\.0$/.test(ip) ||
            mac === 'ff:ff:ff:ff:ff:ff' ||
            mac === '00:00:00:00:00:00'
          ) {
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
          const m = raw.match(/^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
          if (!m) continue;
          const rawHost = m[1] === '?' ? '' : m[1].replace(/\.local$/i, '');
          const ip = m[2];
          const mac = m[3]
            .toLowerCase()
            .split(':')
            .map((p) => p.padStart(2, '0'))
            .join(':');
          if (
            seenIp.has(ip) ||
            mac.includes('incomplete') ||
            mac === 'ff:ff:ff:ff:ff:ff' ||
            mac === '00:00:00:00:00:00' ||
            /^224\.|^239\.|^255\.|^169\.254\.|\.255$|\.0$/.test(ip)
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

    const sorted = devices
      .sort((a, b) => {
        if (a.isGateway) return -1;
        if (b.isGateway) return 1;
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return a.ip.localeCompare(b.ip, undefined, { numeric: true });
      })
      .slice(0, 128);

    // Enrich missing hostnames via fast bounded reverse-DNS (350ms max)
    await Promise.all(
      sorted.map(async (dev) => {
        if (dev.isSelf || (dev.hostname !== dev.ip && dev.hostname !== 'Router Gateway')) return;
        try {
          const names = await Promise.race([
            dns.reverse(dev.ip),
            new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 350)),
          ]);
          const clean = names[0]?.replace(/\.local\.?$/i, '').replace(/\.lan\.?$/i, '');
          if (clean && !dev.isGateway) {
            dev.hostname = clean;
            dev.vendor = guessVendor(dev.mac, clean, false);
          }
        } catch {
          // Keep IP or Router Gateway label
        }
      }),
    );

    return sorted;
  }

  private async measureHostPing(
    target: string,
    count = 4,
  ): Promise<{
    pingMs: number | null;
    minMs: number | null;
    maxMs: number | null;
    jitterMs: number | null;
    packetLossPct: number | null;
  }> {
    if (!target) {
      return { pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct: null };
    }
    try {
      const args = IS_WIN
        ? ['-n', String(count), '-w', '900', target]
        : ['-c', String(count), '-i', '0.18', '-W', '900', target];
      const { stdout } = await execFileAsync('ping', args, {
        timeout: count * 1200 + 1500,
        windowsHide: true,
      });
      const times: number[] = [];
      for (const m of stdout.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)) {
        times.push(Number(m[1]));
      }
      const lossMatch = stdout.match(/(\d+(?:\.\d+)?)%\s*(?:packet\s*)?loss/i);
      const packetLossPct = lossMatch
        ? Math.round(Number(lossMatch[1]))
        : times.length === 0
          ? 100
          : Math.round(((count - times.length) / count) * 100);

      if (times.length === 0) {
        return { pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct };
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      let jitter = 0;
      if (times.length > 1) {
        let diffs = 0;
        for (let i = 1; i < times.length; i += 1) diffs += Math.abs(times[i] - times[i - 1]);
        jitter = diffs / (times.length - 1);
      }
      return {
        pingMs: Math.max(1, Math.round(avg)),
        minMs: Math.max(1, Math.round(Math.min(...times))),
        maxMs: Math.max(1, Math.round(Math.max(...times))),
        jitterMs: Number(jitter.toFixed(1)),
        packetLossPct,
      };
    } catch {
      // Fallback to TCP 443/80 timing if ICMP is blocked on the network
      const tcpMs = (await checkTcpPort(target, 443, 1200)) ?? (await checkTcpPort(target, 80, 1200));
      if (tcpMs !== null) {
        return {
          pingMs: tcpMs,
          minMs: tcpMs,
          maxMs: tcpMs,
          jitterMs: 0,
          packetLossPct: 0,
        };
      }
      return { pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct: null };
    }
  }

  private buildHops(
    gatewayIp: string,
    gwMs: number | null,
    cfMs: number | null,
    googleMs: number | null,
    dnsMs: number | null,
  ): NetOpsHopMetric[] {
    return [
      {
        id: 'gateway',
        label: 'Wi-Fi Router',
        target: gatewayIp || 'Local GW',
        latencyMs: gwMs,
        status: hopStatus(gwMs, 15, 45),
      },
      {
        id: 'cloudflare',
        label: this.state.colo ? `Cloudflare (${this.state.colo})` : 'Cloudflare Edge',
        target: '1.1.1.1',
        latencyMs: cfMs,
        status: hopStatus(cfMs, 45, 110),
      },
      {
        id: 'google',
        label: 'Google Backbone',
        target: '8.8.8.8',
        latencyMs: googleMs,
        status: hopStatus(googleMs, 55, 120),
      },
      {
        id: 'dns',
        label: 'DNS Resolver',
        target: this.state.dnsServers[0] || 'System DNS',
        latencyMs: dnsMs,
        status: hopStatus(dnsMs, 40, 95),
      },
    ];
  }

  private computeGrade(
    down: number | null,
    ping: number | null,
    loss: number | null,
  ): NetworkCommandState['grade'] {
    if (down === null && ping === null) return 'IDLE';
    if ((loss ?? 0) >= 5 || (down !== null && down < 15) || (ping ?? 0) > 120) return 'SLOW';
    if ((down !== null && down < 45) || (ping ?? 0) > 65) return 'FAIR';
    if (down !== null && down >= 150 && (ping ?? 0) <= 35) return 'ULTRA';
    return 'FAST';
  }

  private buildLocalAdvice(): { summary: string; problems: string[]; tips: string[] } {
    const s = this.state;
    const problems: string[] = [];
    const tips: string[] = [];
    const usingFastDns = s.dnsServers.some((d) => d === '1.1.1.1' || d === '8.8.8.8' || d === '9.9.9.9');

    if (!usingFastDns) {
      problems.push(
        `Using router/ISP DNS (${s.dnsServers[0] || 'auto'}) instead of low-latency Anycast DNS.`,
      );
      tips.push(
        'Tap "1.1.1.1 DNS" or "BOOST & FIX" to configure Cloudflare 1.1.1.1 + Google 8.8.8.8 DNS.',
      );
    }
    if ((s.gatewayPingMs ?? 0) > 20) {
      problems.push(
        `High local Wi-Fi hop latency to router (${s.gatewayPingMs} ms) — interference between your computer and router.`,
      );
      tips.push('Switch to a 5 GHz / 6 GHz Wi-Fi band or move closer to the access point.');
    }
    if (s.signalDbm !== null && s.signalDbm < -70) {
      problems.push(`Weak Wi-Fi signal (${s.signalDbm} dBm) is reducing link modulation rate.`);
      tips.push('Move closer to your Wi-Fi router or use Ethernet for zero-jitter stability.');
    }
    if ((s.packetLossPct ?? 0) > 0) {
      problems.push(
        `Packet loss detected (${s.packetLossPct}%) — packets are dropping under load.`,
      );
      tips.push('Tap "RENEW IP" or reboot your router if packet loss persists.');
    }
    if ((s.pingMs ?? 0) > 55 && (s.gatewayPingMs ?? 0) <= 15) {
      problems.push(
        `Router Wi-Fi is fast (${s.gatewayPingMs ?? '--'} ms), so high latency (${s.pingMs} ms) is upstream on your ISP line.`,
      );
    } else if ((s.pingMs ?? 0) > 55) {
      problems.push(`Elevated internet latency (${s.pingMs} ms) impacts calls, SSH, and gaming.`);
    }
    if ((s.jitterMs ?? 0) > 12) {
      problems.push(`Jitter spike (${s.jitterMs} ms) across ${s.devices.length} active LAN devices.`);
      tips.push('Open the LAN Radar tab to inspect active devices sharing bandwidth.');
    }
    if (s.downMbps !== null && s.downMbps < 25) {
      problems.push(`Download throughput is ${s.downMbps} Mbps — below optimal multi-stream bandwidth.`);
    }
    if (s.vpnActive) {
      problems.push('Active VPN tunnel detected — adds encryption & routing hop overhead.');
      tips.push('Pause VPN temporarily when benchmarking raw ISP line speed.');
    }
    if (tips.length === 0) {
      tips.push('All hops, DNS resolvers, and packet loss metrics look clean and healthy.');
    }

    const summary =
      s.downMbps !== null
        ? `↓ ${s.downMbps} Mbps / ↑ ${s.upMbps ?? 0} Mbps · Internet RTT ${s.pingMs ?? '--'} ms (Router ${s.gatewayPingMs ?? '--'} ms, Jitter ${s.jitterMs ?? 0} ms, DNS ${s.dnsMs ?? '--'} ms). ${
            problems.length > 0
              ? `${problems.length} bottleneck(s) identified below.`
              : 'Zero bottlenecks detected — network is operating at peak health.'
          }`
        : `Connected to ${s.ssid} (${s.isp || s.localIp}) · ${s.devices.length} LAN device(s) · Router ${s.gatewayPingMs ?? '--'} ms → Internet ${s.pingMs ?? '--'} ms. ${
            problems.length > 0
              ? `${problems.length} optimization(s) available — tap "SPEED" or "BOOST & FIX".`
              : 'Tap "SPEED" to run a live streaming Download & Upload benchmark.'
          }`;
    return { summary, problems, tips };
  }

  async scanNetwork(): Promise<NetworkCommandState> {
    if (this.state.scanning) return this.state;
    this.state.scanning = true;
    this.state.activeAction = 'Sweeping /24 LAN subnet, Gateway RTT, DNS & ISP hops…';
    this.emit();

    try {
      const [wifi, gwDns, pub] = await Promise.all([
        this.readWifiInfo(),
        this.readGatewayAndDns(),
        this.readPublicIp(),
      ]);

      this.state.colo = pub.colo || this.state.colo;

      const [devices, gwPing, cfPing, googlePing, dnsMs] = await Promise.all([
        this.scanArpDevices(gwDns.gatewayIp),
        gwDns.gatewayIp
          ? this.measureHostPing(gwDns.gatewayIp, 2)
          : Promise.resolve({ pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct: null }),
        this.measureHostPing('1.1.1.1', 4),
        this.measureHostPing('8.8.8.8', 2),
        this.measureDnsMs(),
      ]);

      const gateway = devices.find((d) => d.isGateway);
      if (gateway && gwPing.pingMs !== null) {
        gateway.latencyMs = gwPing.pingMs;
      }

      if (gwDns.gatewayIp && (gateway || wifi.ssid !== 'Connected Network')) {
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
          if (count) {
            this.onAlert?.('warning', `${count} newly observed Wi-Fi device${count > 1 ? 's' : ''}`);
          }
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
        colo: pub.colo || this.state.colo,
        dnsServers: gwDns.dnsServers,
        vpnActive: this.detectVpn(),
        pingMs: cfPing.pingMs,
        gatewayPingMs: gwPing.pingMs,
        googlePingMs: googlePing.pingMs,
        jitterMs: cfPing.jitterMs,
        packetLossPct: cfPing.packetLossPct,
        dnsMs,
        devices,
        grade: this.computeGrade(this.state.downMbps, cfPing.pingMs, cfPing.packetLossPct),
        updatedAt: Date.now(),
      };
      this.state.hops = this.buildHops(
        gwDns.gatewayIp,
        gwPing.pingMs,
        cfPing.pingMs,
        googlePing.pingMs,
        dnsMs,
      );

      const adv = this.buildLocalAdvice();
      this.state.aiSummary = adv.summary;
      this.state.problemsFound = adv.problems;
      this.state.aiTips = adv.tips;
      this.log(
        `LAN Sweep: ${devices.length} device(s) · Router ${gwPing.pingMs ?? '--'}ms · 1.1.1.1 ${cfPing.pingMs ?? '--'}ms · DNS ${dnsMs ?? '--'}ms`,
      );
      this.emit();
      return this.state;
    } catch {
      this.state.scanning = false;
      this.state.activeAction = '';
      this.emit();
      return this.state;
    }
  }

  /**
   * Real-time streaming Download & Upload Speed Test with ~8Hz live gauge telemetry!
   */
  async runSpeedTest(): Promise<NetworkCommandState> {
    if (this.state.testingSpeed) return this.state;
    this.state.testingSpeed = true;
    this.state.speedPhase = 'ping';
    this.state.activeAction = 'Phase 1/3 · Measuring multi-hop RTT, Jitter & Packet Loss…';
    this.log('⚡ Starting live streaming Speed & Latency Benchmark…');
    this.emit();

    try {
      const [gwPing, cfPing, googlePing, dnsMs] = await Promise.all([
        this.state.gatewayIp
          ? this.measureHostPing(this.state.gatewayIp, 2)
          : Promise.resolve({ pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct: null }),
        this.measureHostPing('1.1.1.1', 5),
        this.measureHostPing('8.8.8.8', 2),
        this.measureDnsMs(),
      ]);

      this.state.pingMs = cfPing.pingMs;
      this.state.gatewayPingMs = gwPing.pingMs;
      this.state.googlePingMs = googlePing.pingMs;
      this.state.jitterMs = cfPing.jitterMs;
      this.state.packetLossPct = cfPing.packetLossPct;
      this.state.dnsMs = dnsMs;
      this.state.hops = this.buildHops(
        this.state.gatewayIp,
        gwPing.pingMs,
        cfPing.pingMs,
        googlePing.pingMs,
        dnsMs,
      );

      // Phase 2: Real-time streaming Download (2 parallel streams x 20MB, capped at 6.5s)
      this.state.speedPhase = 'download';
      this.state.downMbps = 0;
      this.state.activeAction = 'Phase 2/3 · Streaming live Download bandwidth…';
      this.emit();

      let downMbps = 0;
      {
        const dlCtrl = new AbortController();
        const maxTimer = setTimeout(() => dlCtrl.abort(), 6500);
        const startTs = performance.now();
        let totalBytes = 0;
        let lastEmitTs = startTs;

        const pullStream = async (streamIdx: number) => {
          try {
            const res = await fetch(
              `https://speed.cloudflare.com/__down?bytes=20000000&s=${streamIdx}&t=${Date.now()}`,
              { signal: dlCtrl.signal },
            );
            const reader = res.body?.getReader();
            if (!reader) {
              const buf = await res.arrayBuffer();
              totalBytes += buf.byteLength;
              return;
            }
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                totalBytes += value.byteLength;
                const now = performance.now();
                if (now - lastEmitTs >= 150) {
                  lastEmitTs = now;
                  const elapsedSec = Math.max(0.08, (now - startTs) / 1000);
                  const liveMbps = Number(((totalBytes * 8) / elapsedSec / 1_000_000).toFixed(1));
                  this.state.downMbps = liveMbps;
                  this.emit();
                }
              }
            }
          } catch {
            // Aborted at 6.5s budget or network error
          }
        };

        await Promise.all([pullStream(0), pullStream(1)]);
        clearTimeout(maxTimer);
        const totalSec = Math.max(0.1, (performance.now() - startTs) / 1000);
        downMbps = Number(((totalBytes * 8) / totalSec / 1_000_000).toFixed(1));
        this.state.downMbps = downMbps;
        this.emit();
      }

      // Phase 3: Progressive multi-chunk Upload with live updates
      this.state.speedPhase = 'upload';
      this.state.upMbps = 0;
      this.state.activeAction = 'Phase 3/3 · Measuring live Upload throughput…';
      this.emit();

      let upMbps = 0;
      {
        const chunkSizes = [750_000, 1_500_000, 3_000_000];
        let sentBytes = 0;
        const upStart = performance.now();
        for (let i = 0; i < chunkSizes.length; i += 1) {
          if (performance.now() - upStart > 5500) break;
          const payload = new Uint8Array(chunkSizes[i]);
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 5000);
          try {
            await fetch(`https://speed.cloudflare.com/__up?i=${i}&t=${Date.now()}`, {
              method: 'POST',
              body: payload,
              signal: ctrl.signal,
            });
            clearTimeout(t);
            sentBytes += payload.byteLength;
            const sec = Math.max(0.08, (performance.now() - upStart) / 1000);
            upMbps = Number(((sentBytes * 8) / sec / 1_000_000).toFixed(1));
            this.state.upMbps = upMbps;
            this.emit();
          } catch {
            clearTimeout(t);
            break;
          }
        }
      }

      this.state = {
        ...this.state,
        testingSpeed: false,
        speedPhase: 'idle',
        activeAction: '',
        downMbps,
        upMbps,
        grade: this.computeGrade(downMbps, cfPing.pingMs, cfPing.packetLossPct),
        updatedAt: Date.now(),
      };
      const adv = this.buildLocalAdvice();
      this.state.aiSummary = adv.summary;
      this.state.problemsFound = adv.problems;
      this.state.aiTips = adv.tips;
      this.log(
        `✅ Speed Benchmark: ↓${downMbps} Mbps · ↑${upMbps} Mbps · Ping ${cfPing.pingMs ?? '--'}ms · Jitter ${cfPing.jitterMs ?? 0}ms`,
      );
      this.emit();
      this.onAlert?.(
        'success',
        `Speed: ↓${downMbps} Mbps · ↑${upMbps} Mbps (${cfPing.pingMs ?? '--'}ms)`,
      );
      return this.state;
    } catch (err) {
      this.state.testingSpeed = false;
      this.state.speedPhase = 'idle';
      this.state.activeAction = '';
      this.log(`❌ Speed test error: ${err instanceof Error ? err.message : 'failed'}`);
      this.emit();
      return this.state;
    }
  }

  /**
   * Interactive NetOps Diagnostic Workbench: Ping, DNS Inspector & TCP Port Scanner
   */
  async runProbe(
    mode: 'ping' | 'dns' | 'ports',
    rawTarget: string,
  ): Promise<NetOpsProbeResult> {
    const target = sanitizeTarget(rawTarget);
    if (!target) {
      throw new Error('Enter a valid hostname or IPv4 address (e.g. 1.1.1.1 or github.com)');
    }

    this.log(`🔎 Probe [${mode.toUpperCase()}] → ${target}`);

    let resolvedIp = target;
    if (!net.isIP(target)) {
      try {
        const res = await dns.lookup(target);
        resolvedIp = res.address;
      } catch {
        // Keep hostname
      }
    }

    if (mode === 'ping') {
      const [pingStats, httpProbe] = await Promise.all([
        this.measureHostPing(target, 4),
        (async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3200);
          const t0 = performance.now();
          try {
            const url = net.isIP(target) ? `http://${target}` : `https://${target}`;
            const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
            clearTimeout(timer);
            return { status: res.status, ms: Math.max(1, Math.round(performance.now() - t0)) };
          } catch {
            clearTimeout(timer);
            return { status: null, ms: null };
          }
        })(),
      ]);

      const loss = pingStats.packetLossPct ?? (pingStats.pingMs !== null ? 0 : 100);
      const received = Math.round(((100 - loss) / 100) * 4);
      const summary =
        pingStats.pingMs !== null
          ? `${target} (${resolvedIp}) responded in ${pingStats.pingMs} ms avg (min ${pingStats.minMs} ms, max ${pingStats.maxMs} ms, jitter ${pingStats.jitterMs ?? 0} ms, ${loss}% loss)${httpProbe.status ? ` · HTTP ${httpProbe.status} in ${httpProbe.ms} ms` : ''}.`
          : `No ICMP/TCP echo reply from ${target} (${loss}% loss)${httpProbe.status ? `, though HTTP responded (${httpProbe.status} in ${httpProbe.ms} ms)` : ''}.`;

      this.log(`Probe Ping ${target}: ${pingStats.pingMs ?? '--'}ms (${loss}% loss)`);
      return {
        ok: pingStats.pingMs !== null || httpProbe.status !== null,
        mode: 'ping',
        target,
        resolvedIp,
        source: 'bridge',
        ts: Date.now(),
        summary,
        ping: {
          sent: 4,
          received,
          lossPct: loss,
          minMs: pingStats.minMs,
          avgMs: pingStats.pingMs,
          maxMs: pingStats.maxMs,
          jitterMs: pingStats.jitterMs,
          httpStatus: httpProbe.status,
          httpMs: httpProbe.ms,
        },
      };
    }

    if (mode === 'dns') {
      const t0 = performance.now();
      const records: NetOpsDnsRecord[] = [];
      await Promise.all([
        dns
          .resolve4(target, { ttl: true })
          .then((list) => {
            for (const r of list) records.push({ type: 'A', value: r.address, ttl: r.ttl });
          })
          .catch(() => {}),
        dns
          .resolve6(target, { ttl: true })
          .then((list) => {
            for (const r of list.slice(0, 4)) records.push({ type: 'AAAA', value: r.address, ttl: r.ttl });
          })
          .catch(() => {}),
        dns
          .resolveCname(target)
          .then((list) => {
            for (const v of list) records.push({ type: 'CNAME', value: v });
          })
          .catch(() => {}),
        dns
          .resolveMx(target)
          .then((list) => {
            for (const m of list.slice(0, 4))
              records.push({ type: 'MX', value: `${m.priority} ${m.exchange}` });
          })
          .catch(() => {}),
        dns
          .resolveNs(target)
          .then((list) => {
            for (const v of list.slice(0, 4)) records.push({ type: 'NS', value: v });
          })
          .catch(() => {}),
        dns
          .resolveTxt(target)
          .then((list) => {
            for (const chunks of list.slice(0, 3)) {
              records.push({ type: 'TXT', value: chunks.join('').slice(0, 110) });
            }
          })
          .catch(() => {}),
      ]);

      if (records.length === 0 && net.isIP(target)) {
        const rev = await dns.reverse(target).catch(() => []);
        for (const ptr of rev) records.push({ type: 'PTR', value: ptr });
      }

      const lookupMs = Math.max(1, Math.round(performance.now() - t0));
      const resolver = this.state.dnsServers[0] || 'System Resolver';
      const summary =
        records.length > 0
          ? `Resolved ${records.length} DNS record(s) for ${target} in ${lookupMs} ms via ${resolver}.`
          : `No public DNS records returned for ${target} (${lookupMs} ms).`;

      this.log(`Probe DNS ${target}: ${records.length} record(s) in ${lookupMs}ms`);
      return {
        ok: records.length > 0,
        mode: 'dns',
        target,
        resolvedIp,
        source: 'bridge',
        ts: Date.now(),
        summary,
        dns: { lookupMs, resolver, records },
      };
    }

    // mode === 'ports'
    const items: NetOpsPortResult[] = await Promise.all(
      COMMON_PORTS.map(async ({ port, service }) => {
        const ms = await checkTcpPort(resolvedIp, port, 850);
        return {
          port,
          service,
          open: ms !== null,
          latencyMs: ms,
        };
      }),
    );
    const openItems = items.filter((i) => i.open);
    const summary =
      openItems.length > 0
        ? `Found ${openItems.length} open TCP port(s) on ${target} (${resolvedIp}): ${openItems.map((i) => `${i.port}/${i.service}`).join(', ')}.`
        : `0 of ${items.length} common TCP ports open on ${target} (${resolvedIp}) — host is firewalled or offline.`;

    this.log(`Probe Ports ${target}: ${openItems.length}/${items.length} open`);
    return {
      ok: true,
      mode: 'ports',
      target,
      resolvedIp,
      source: 'bridge',
      ts: Date.now(),
      summary,
      ports: {
        scannedCount: items.length,
        openCount: openItems.length,
        items: items.sort((a, b) => Number(b.open) - Number(a.open) || a.port - b.port),
      },
    };
  }

  async revealWifiPassword(): Promise<string> {
    const wifi = await this.readWifiInfo();
    const ssid = wifi.ssid;
    if (!ssid || ssid === 'Connected Network' || ssid === 'Wi-Fi / Ethernet') {
      this.state.wifiPassword = null;
      this.state.wifiPasswordNote = 'No active Wi-Fi SSID detected (using Ethernet or macOS Location Privacy)';
      this.emit();
      return this.state.wifiPasswordNote;
    }

    try {
      if (IS_WIN) {
        const { stdout } = await execFileAsync(
          'netsh',
          ['wlan', 'show', 'profile', `name=${ssid}`, 'key=clear'],
          { timeout: 3500, windowsHide: true },
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
        ? 'Could not read Wi-Fi password (run bridge as Admin if restricted)'
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
    const prompt = `You are a senior NOC network engineer. Analyze this live Wi-Fi, multi-hop latency, and LAN snapshot and reply in crisp plain-English JSON:
{ "summary": "2-sentence plain-English diagnosis comparing router Wi-Fi hop vs ISP internet hop, DNS speed, and throughput", "tips": ["3 concrete actionable steps to optimize this network"] }
Data: ${JSON.stringify({
      ssid: this.state.ssid,
      signalDbm: this.state.signalDbm,
      downMbps: this.state.downMbps,
      upMbps: this.state.upMbps,
      gatewayPingMs: this.state.gatewayPingMs,
      internetPingMs: this.state.pingMs,
      googlePingMs: this.state.googlePingMs,
      jitterMs: this.state.jitterMs,
      packetLossPct: this.state.packetLossPct,
      dnsMs: this.state.dnsMs,
      dnsServers: this.state.dnsServers,
      vpnActive: this.state.vpnActive,
      deviceCount: this.state.devices.length,
      devices: this.state.devices.slice(0, 12).map((d) => `${d.hostname} (${d.vendor})`),
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
          this.log(`✨ AI Network Diagnosis ready (${model})`);
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
        this.log('Flushing OS DNS & mDNS resolver caches…');
        if (IS_WIN) {
          await execFileAsync('ipconfig', ['/flushdns'], { timeout: 5000, windowsHide: true });
        } else {
          await execFileAsync('dscacheutil', ['-flushcache'], { timeout: 5000 });
          await execFileAsync('killall', ['-HUP', 'mDNSResponder'], { timeout: 3000 }).catch(() => {});
        }
        this.state.whatWasFixed = [
          'Flushed OS DNS cache so stale domain records resolve freshly.',
          ...this.state.whatWasFixed.filter((x) => !x.includes('DNS cache')),
        ].slice(0, 6);
        this.log('✅ OS DNS cache flushed');
      };

      const doBoostDns = async (): Promise<boolean> => {
        this.log('Configuring Cloudflare (1.1.1.1) + Google (8.8.8.8) Anycast DNS…');
        if (IS_WIN) {
          await runPowerShell(
            `$idx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex; if ($idx) { Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses ('1.1.1.1','8.8.8.8') -ErrorAction Stop }`,
            6000,
          );
          let check = await this.readGatewayAndDns();
          if (!check.dnsServers.includes('1.1.1.1')) {
            this.state.activeAction = 'Approve Windows Admin prompt to apply 1.1.1.1 DNS…';
            this.emit();
            await runPowerShell(
              `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList "-NoProfile -Command \`$idx=(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex; if(\`$idx){Set-DnsClientServerAddress -InterfaceIndex \`$idx -ServerAddresses ('1.1.1.1','8.8.8.8')}; ipconfig /flushdns"`,
              20_000,
            );
            check = await this.readGatewayAndDns();
          }
          if (check.dnsServers.includes('1.1.1.1')) {
            this.state.whatWasFixed = [
              'Verified active Cloudflare (1.1.1.1) & Google (8.8.8.8) DNS on Windows.',
              ...this.state.whatWasFixed.filter((x) => !x.includes('1.1.1.1')),
            ].slice(0, 6);
            this.log('✅ Verified active DNS: 1.1.1.1, 8.8.8.8');
            return true;
          }
          this.log('⚠ Windows DNS remained unchanged (Admin approval skipped)');
          return false;
        }

        // macOS: detect real active network service name
        const { service } = await this.getActiveMacNetworkService();
        const safeSvc = service.replace(/"/g, '\\"');
        await execFileAsync('networksetup', ['-setdnsservers', service, '1.1.1.1', '8.8.8.8'], {
          timeout: 5000,
        }).catch(() => {});

        let check = await this.readGatewayAndDns();
        if (!check.dnsServers.includes('1.1.1.1')) {
          this.state.activeAction = `Approve macOS prompt to set 1.1.1.1 DNS on ${service}…`;
          this.emit();
          await execFileAsync(
            'osascript',
            [
              '-e',
              `do shell script "networksetup -setdnsservers \\"${safeSvc}\\" 1.1.1.1 8.8.8.8 && dscacheutil -flushcache && killall -HUP mDNSResponder" with administrator privileges`,
            ],
            { timeout: 25_000 },
          ).catch(() => {});
          check = await this.readGatewayAndDns();
        }

        if (check.dnsServers.includes('1.1.1.1')) {
          this.state.whatWasFixed = [
            `Verified active Cloudflare (1.1.1.1) & Google (8.8.8.8) DNS on ${service}.`,
            ...this.state.whatWasFixed.filter((x) => !x.includes('1.1.1.1')),
          ].slice(0, 6);
          this.log(`✅ Verified active DNS on ${service}: 1.1.1.1, 8.8.8.8`);
          return true;
        }
        this.log(`⚠ DNS on ${service} unchanged (macOS admin prompt cancelled)`);
        return false;
      };

      const doRenewDhcp = async () => {
        this.log('Refreshing DHCP IP lease with local router…');
        if (IS_WIN) {
          await execFileAsync('ipconfig', ['/renew'], { timeout: 14_000, windowsHide: true });
          this.state.whatWasFixed = [
            'Renewed Windows DHCP IPv4 lease with router.',
            ...this.state.whatWasFixed.filter((x) => !x.includes('DHCP')),
          ].slice(0, 6);
          this.log('✅ Windows DHCP lease refreshed');
        } else {
          const { device } = await this.getActiveMacNetworkService();
          let ok = true;
          await execFileAsync('ipconfig', ['set', device, 'DHCP'], { timeout: 6000 }).catch(() => {
            ok = false;
          });
          if (!ok) {
            this.state.activeAction = `Approve macOS prompt to renew DHCP on ${device}…`;
            this.emit();
            ok = await execFileAsync(
              'osascript',
              ['-e', `do shell script "ipconfig set ${device} DHCP" with administrator privileges`],
              { timeout: 22_000 },
            )
              .then(() => true)
              .catch(() => false);
          }
          if (ok) {
            this.state.whatWasFixed = [
              `Renewed macOS DHCP lease on ${device}.`,
              ...this.state.whatWasFixed.filter((x) => !x.includes('DHCP')),
            ].slice(0, 6);
            this.log(`✅ DHCP lease renewed on ${device}`);
          } else {
            this.log('⚠ DHCP lease renewal skipped (admin prompt cancelled)');
          }
        }
      };

      if (action === 'flush_dns') {
        await doFlush();
        msg = 'DNS cache flushed';
      } else if (action === 'boost_dns') {
        const applied = await doBoostDns();
        await doFlush();
        msg = applied
          ? 'Verified Ultra-Fast DNS (1.1.1.1 & 8.8.8.8)'
          : 'DNS cache flushed (approve OS prompt to change system DNS)';
      } else if (action === 'renew_dhcp') {
        await doRenewDhcp();
        msg = 'DHCP lease refreshed';
      } else if (action === 'ai_analyze') {
        this.log('Running Multi-Hop & AI Network Diagnosis…');
        await this.scanNetwork();
        await this.runAiNetworkAnalysis();
        msg = 'AI Network Diagnosis complete';
      } else if (action === 'full_net_fix') {
        this.log('=== Starting Full NetOps Optimization & Benchmark ===');
        await doFlush();
        await doBoostDns().catch(() => false);
        this.state.fixing = false;
        await this.scanNetwork();
        await this.runSpeedTest();
        await this.runAiNetworkAnalysis();
        msg = `NetOps Boost Complete (↓${this.state.downMbps ?? '--'} Mbps · ${this.state.pingMs ?? '--'} ms)`;
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
      const em = err instanceof Error ? err.message : 'Network operation failed';
      this.log(`❌ ${em}`);
      this.state.fixing = false;
      this.state.activeAction = '';
      this.emit();
      this.onAlert?.('error', em.slice(0, 80));
      return em;
    }
  }
}
