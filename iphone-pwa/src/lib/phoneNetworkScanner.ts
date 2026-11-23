'use client';

import type { NetworkCommandState, NetworkDevice } from '@/types/protocol';

type StatePatcher = (updater: (prev: NetworkCommandState) => NetworkCommandState) => void;

function stamp(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function appendLog(prev: NetworkCommandState, line: string): string[] {
  return [...prev.fixLog.slice(-60), `[${stamp()}] ${line}`];
}

function computeGrade(
  down: number | null,
  ping: number | null,
  loss: number | null,
): NetworkCommandState['grade'] {
  if (down === null && ping === null) return 'IDLE';
  if ((loss ?? 0) >= 5 || (down !== null && down < 15) || (ping ?? 0) > 120) return 'SLOW';
  if ((down !== null && down < 45) || (ping ?? 0) > 65) return 'FAIR';
  if ((down !== null && down >= 150) && (ping ?? 0) <= 35) return 'ULTRA';
  return 'FAST';
}

function buildPhoneAdvice(s: NetworkCommandState): {
  summary: string;
  problems: string[];
  tips: string[];
} {
  const problems: string[] = [];
  const tips: string[] = [];

  if (s.packetLossPct !== null && s.packetLossPct > 0) {
    problems.push(`Packet loss detected (${s.packetLossPct}%) on this phone's connection — causes lag and dropped calls.`);
    tips.push('Move closer to the Wi-Fi router or toggle Airplane Mode for 5 seconds to refresh your radio link.');
  }
  if (s.pingMs !== null && s.pingMs > 75) {
    problems.push(`High latency (${s.pingMs} ms ping) makes web pages and apps feel sluggish.`);
    tips.push('Switch to 5 GHz Wi-Fi or set DNS to 1.1.1.1 in iPhone Settings → Wi-Fi → (i) → Configure DNS → Manual.');
  }
  if (s.jitterMs !== null && s.jitterMs > 20) {
    problems.push(`Unstable jitter (${s.jitterMs} ms) — signal strength or router congestion is fluctuating.`);
  }
  if (s.downMbps !== null && s.downMbps < 25) {
    problems.push(`Slow download speed (${s.downMbps} Mbps) measured directly on this phone.`);
    tips.push('Pause background downloads or switch to a less congested Wi-Fi band / router channel.');
  }

  if (tips.length === 0) {
    tips.push('Your phone connection is healthy! Pair a Mac/PC bridge anytime to also scan all LAN IPs & 1-tap boost computer DNS.');
  }

  const parts: string[] = [];
  parts.push(`Phone-Direct scan on ${s.ssid}${s.isp ? ` (${s.isp})` : ''}:`);
  if (s.downMbps !== null) {
    parts.push(`↓${s.downMbps} Mbps / ↑${s.upMbps ?? '--'} Mbps,`);
  }
  if (s.pingMs !== null) {
    parts.push(`Ping ${s.pingMs}ms (jitter ${s.jitterMs ?? 0}ms, loss ${s.packetLossPct ?? 0}%).`);
  }
  if (problems.length === 0) {
    parts.push('Everything looks fast and stable from your phone!');
  } else {
    parts.push(`Found ${problems.length} item(s) slowing this connection down.`);
  }

  return { summary: parts.join(' '), problems, tips };
}

async function fetchPublicIpInfo(): Promise<{
  publicIp: string;
  isp: string;
  city: string;
  country: string;
}> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch('https://ipwho.is/', { signal: ctrl.signal, cache: 'no-store' });
    const data = (await res.json()) as {
      ip?: string;
      city?: string;
      country?: string;
      connection?: { isp?: string; org?: string };
    };
    window.clearTimeout(t);
    const ispName = data.connection?.isp || data.connection?.org || '';
    const loc = data.city ? `${ispName}${ispName ? ' · ' : ''}${data.city}` : ispName;
    return {
      publicIp: data.ip || '--',
      isp: loc,
      city: data.city || '',
      country: data.country || '',
    };
  } catch {
    window.clearTimeout(t);
    return { publicIp: '--', isp: '', city: '', country: '' };
  }
}

async function measurePhonePing(): Promise<{
  pingMs: number | null;
  jitterMs: number | null;
  packetLossPct: number;
  colo: string;
}> {
  const samples: number[] = [];
  let failures = 0;
  let colo = '';
  const total = 5;

  // Warmup connection once so TCP/TLS handshake doesn't skew ping
  try {
    const warm = await fetch(`https://cloudflare.com/cdn-cgi/trace?t=${Date.now()}`, {
      cache: 'no-store',
    });
    const txt = await warm.text();
    const m = txt.match(/colo=([A-Z0-9]+)/);
    if (m) colo = m[1];
  } catch {
    // Ignore warmup error
  }

  for (let i = 0; i < total; i += 1) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    const t0 = performance.now();
    try {
      const res = await fetch(`https://cloudflare.com/cdn-cgi/trace?n=${i}&t=${Date.now()}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      await res.text();
      window.clearTimeout(timer);
      samples.push(Math.max(1, performance.now() - t0));
    } catch {
      window.clearTimeout(timer);
      failures += 1;
    }
  }

  const packetLossPct = Math.round((failures / total) * 100);
  if (samples.length === 0) {
    return { pingMs: null, jitterMs: null, packetLossPct, colo };
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  let jitter = 0;
  if (samples.length > 1) {
    let diffs = 0;
    for (let i = 1; i < samples.length; i += 1) diffs += Math.abs(samples[i] - samples[i - 1]);
    jitter = diffs / (samples.length - 1);
  }
  return {
    pingMs: Math.round(avg),
    jitterMs: Number(jitter.toFixed(1)),
    packetLossPct,
    colo,
  };
}

function getConnectionLabel(): string {
  if (typeof navigator === 'undefined') return 'Mobile Network';
  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string; downlink?: number };
  };
  const conn = nav.connection;
  if (conn?.type === 'wifi') return 'Phone Wi-Fi';
  if (conn?.type === 'cellular') return `Phone Cellular (${(conn.effectiveType || '4G/5G').toUpperCase()})`;
  if (conn?.effectiveType) return `Phone Network (${conn.effectiveType.toUpperCase()})`;
  return navigator.onLine ? 'Phone Active Network' : 'Offline';
}

export async function runPhoneDirectScan(patch: StatePatcher): Promise<void> {
  patch((prev) => ({
    ...prev,
    scanning: true,
    activeAction: 'Phone-Direct: checking IP, ISP, latency & edge route…',
    fixLog: appendLog(prev, '📱 Phone-Direct Scan started (works on any Wi-Fi or 4G/5G without bridge)'),
  }));

  const [ipInfo, ping] = await Promise.all([fetchPublicIpInfo(), measurePhonePing()]);
  const ssid = getConnectionLabel();

  const devices: NetworkDevice[] = [
    {
      ip: ipInfo.publicIp !== '--' ? ipInfo.publicIp : 'Online',
      mac: 'THIS PHONE',
      hostname: 'This Device (Phone-Direct)',
      vendor: ipInfo.isp || 'Active Mobile Connection',
      isSelf: true,
    },
  ];
  if (ping.colo) {
    devices.push({
      ip: '1.1.1.1',
      mac: `POP: ${ping.colo}`,
      hostname: `Cloudflare Edge (${ping.colo})`,
      vendor: `Direct RTT ${ping.pingMs ?? '--'}ms · Jitter ${ping.jitterMs ?? '--'}ms`,
      isGateway: true,
    });
  }

  patch((prev) => {
    const next: NetworkCommandState = {
      ...prev,
      scanning: false,
      activeAction: '',
      ssid,
      publicIp: ipInfo.publicIp,
      isp: ipInfo.isp,
      gatewayIp: ping.colo ? `Edge ${ping.colo}` : 'Mobile GW',
      dnsServers: ['Phone OS DNS'],
      pingMs: ping.pingMs,
      jitterMs: ping.jitterMs,
      packetLossPct: ping.packetLossPct,
      dnsMs: ping.pingMs,
      devices,
      wifiPasswordNote: 'Pair Mac/PC for Wi-Fi password',
      grade: computeGrade(prev.downMbps, ping.pingMs, ping.packetLossPct),
      updatedAt: Date.now(),
    };
    const advice = buildPhoneAdvice(next);
    return {
      ...next,
      aiSummary: advice.summary,
      problemsFound: advice.problems,
      aiTips: advice.tips,
      fixLog: appendLog(
        next,
        `✅ Phone-Direct: IP ${ipInfo.publicIp} (${ipInfo.isp || 'Unknown ISP'}), Ping ${ping.pingMs ?? '--'}ms, Jitter ${ping.jitterMs ?? '--'}ms`,
      ),
    };
  });
}

export async function runPhoneDirectSpeedTest(patch: StatePatcher): Promise<void> {
  patch((prev) => ({
    ...prev,
    testingSpeed: true,
    activeAction: 'Phone-Direct: measuring real download, upload & ping…',
    fixLog: appendLog(prev, '⚡ Phone-Direct Speed Test started via Cloudflare Edge…'),
  }));

  const [ipInfo, ping] = await Promise.all([fetchPublicIpInfo(), measurePhonePing()]);

  // 1. Download test (8 MB from Cloudflare Speed)
  let downMbps: number | null = null;
  try {
    const bytes = 8_000_000;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12_000);
    const t0 = performance.now();
    const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const buf = await res.arrayBuffer();
    const secs = Math.max(0.05, (performance.now() - t0) / 1000);
    window.clearTimeout(timer);
    downMbps = Number(((buf.byteLength * 8) / (secs * 1_000_000)).toFixed(1));
  } catch {
    downMbps = null;
  }

  // 2. Upload test (2 MB to Cloudflare Speed)
  let upMbps: number | null = null;
  try {
    const payload = new Uint8Array(2_000_000);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12_000);
    const t0 = performance.now();
    await fetch(`https://speed.cloudflare.com/__up?t=${Date.now()}`, {
      method: 'POST',
      body: payload,
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const secs = Math.max(0.05, (performance.now() - t0) / 1000);
    window.clearTimeout(timer);
    upMbps = Number(((payload.byteLength * 8) / (secs * 1_000_000)).toFixed(1));
  } catch {
    upMbps = null;
  }

  const ssid = getConnectionLabel();

  patch((prev) => {
    const next: NetworkCommandState = {
      ...prev,
      testingSpeed: false,
      activeAction: '',
      ssid,
      publicIp: ipInfo.publicIp !== '--' ? ipInfo.publicIp : prev.publicIp,
      isp: ipInfo.isp || prev.isp,
      gatewayIp: ping.colo ? `Edge ${ping.colo}` : prev.gatewayIp || 'Mobile GW',
      dnsServers: prev.dnsServers.length ? prev.dnsServers : ['Phone OS DNS'],
      downMbps,
      upMbps,
      pingMs: ping.pingMs,
      jitterMs: ping.jitterMs,
      packetLossPct: ping.packetLossPct,
      dnsMs: ping.pingMs,
      grade: computeGrade(downMbps, ping.pingMs, ping.packetLossPct),
      updatedAt: Date.now(),
    };
    const advice = buildPhoneAdvice(next);
    return {
      ...next,
      aiSummary: advice.summary,
      problemsFound: advice.problems,
      aiTips: advice.tips,
      fixLog: appendLog(
        next,
        `✅ Phone-Direct Speed: ↓${downMbps ?? '--'} Mbps · ↑${upMbps ?? '--'} Mbps · Ping ${ping.pingMs ?? '--'}ms`,
      ),
    };
  });
}
