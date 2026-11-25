'use client';

import type {
  NetOpsDnsRecord,
  NetOpsHopMetric,
  NetOpsPortResult,
  NetOpsProbeResult,
  NetworkCommandState,
  NetworkDevice,
} from '@/types/protocol';

type StatePatcher = (updater: (prev: NetworkCommandState) => NetworkCommandState) => void;

const RECORD_TYPE_NAMES: Record<number, string> = {
  1: 'A',
  5: 'CNAME',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  2: 'NS',
  12: 'PTR',
};

function stamp(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function appendLog(prev: NetworkCommandState, line: string): string[] {
  return [...prev.fixLog.slice(-80), `[${stamp()}] ${line}`];
}

function hopStatus(ms: number | null, warnAt = 50, badAt = 120): NetOpsHopMetric['status'] {
  if (ms === null) return 'idle';
  if (ms >= badAt) return 'bad';
  if (ms >= warnAt) return 'warn';
  return 'ok';
}

function computeGrade(
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

function sanitizeHost(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).hostname;
  } catch {
    // Ignore
  }
  const h = trimmed.split('/')[0]?.split(':')[0]?.trim() || '';
  return /^[a-zA-Z0-9._-]+$/.test(h) && h.length <= 253 ? h : '';
}

function buildPhoneAdvice(s: NetworkCommandState): {
  summary: string;
  problems: string[];
  tips: string[];
} {
  const problems: string[] = [];
  const tips: string[] = [];

  if (s.packetLossPct !== null && s.packetLossPct > 0) {
    problems.push(
      `Packet loss detected (${s.packetLossPct}%) on this phone link — causes choppy audio/video.`,
    );
    tips.push(
      'Move closer to your Wi-Fi router or toggle Airplane Mode for 5 seconds to reset radio link.',
    );
  }
  if (s.pingMs !== null && s.pingMs > 75) {
    problems.push(`Elevated edge latency (${s.pingMs} ms RTT) slows interactive browsing.`);
    tips.push(
      'Switch to 5 GHz Wi-Fi or set DNS to 1.1.1.1 in iPhone Settings → Wi-Fi → (i) → Configure DNS → Manual.',
    );
  }
  if (s.jitterMs !== null && s.jitterMs > 20) {
    problems.push(`Jitter spike (${s.jitterMs} ms) — wireless interference or shared Wi-Fi load.`);
  }
  if (s.downMbps !== null && s.downMbps < 25) {
    problems.push(`Download speed on this phone is ${s.downMbps} Mbps — below fast HD multi-stream rate.`);
  }

  if (tips.length === 0) {
    tips.push(
      'Phone link is clean and responsive! Pair your Mac/Windows bridge anytime to sweep all LAN devices & apply 1-tap OS DNS fixes.',
    );
  }

  const parts: string[] = [];
  parts.push(`Phone-Direct on ${s.ssid}${s.isp ? ` (${s.isp})` : ''}:`);
  if (s.downMbps !== null) {
    parts.push(`↓ ${s.downMbps} Mbps / ↑ ${s.upMbps ?? '--'} Mbps ·`);
  }
  if (s.pingMs !== null) {
    parts.push(
      `Edge RTT ${s.pingMs} ms (Jitter ${s.jitterMs ?? 0} ms, DoH DNS ${s.dnsMs ?? '--'} ms).`,
    );
  }
  parts.push(
    problems.length === 0
      ? 'Zero bottlenecks detected from your iPhone.'
      : `${problems.length} bottleneck(s) detected below.`,
  );

  return { summary: parts.join(' '), problems, tips };
}

/**
 * CORS-enabled Cloudflare Edge + ipwho.is metadata lookup:
 * Uses speed.cloudflare.com/__down?bytes=0 exposed headers (cf-meta-ip, cf-meta-colo, cf-meta-city)
 * so IP & Edge POP ALWAYS resolve even when third-party geo APIs rate-limit!
 */
async function fetchEdgeAndPublicIp(): Promise<{
  publicIp: string;
  isp: string;
  colo: string;
  city: string;
}> {
  let cfIp = '';
  let colo = '';
  let city = '';

  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 3200);
    const res = await fetch(`https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    window.clearTimeout(t);
    cfIp = res.headers.get('cf-meta-ip') || '';
    colo = res.headers.get('cf-meta-colo') || '';
    city = res.headers.get('cf-meta-city') || '';
    await res.arrayBuffer().catch(() => {});
  } catch {
    // Fall through
  }

  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 3200);
    const res = await fetch('https://ipwho.is/', { signal: ctrl.signal, cache: 'no-store' });
    const data = (await res.json()) as {
      ip?: string;
      city?: string;
      connection?: { isp?: string; org?: string };
    };
    window.clearTimeout(t);
    const ispName = data.connection?.isp || data.connection?.org || '';
    const cityLabel = data.city || city;
    const loc = cityLabel ? `${ispName}${ispName ? ' · ' : ''}${cityLabel}` : ispName;
    if (data.ip || cfIp) {
      return {
        publicIp: data.ip || cfIp,
        isp: loc || (colo ? `Edge ${colo}` : ''),
        colo,
        city: cityLabel,
      };
    }
  } catch {
    // Ignore
  }

  return {
    publicIp: cfIp || '--',
    isp: city ? `${city}${colo ? ` · Edge ${colo}` : ''}` : colo ? `Cloudflare ${colo}` : '',
    colo,
    city,
  };
}

/**
 * CORS-enabled 5-sample RTT & Jitter benchmark against Cloudflare Speed Edge (`Access-Control-Allow-Origin: *`)
 */
async function measurePhoneEdgePing(samplesCount = 5): Promise<{
  pingMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  jitterMs: number | null;
  packetLossPct: number;
  colo: string;
}> {
  const samples: number[] = [];
  let failures = 0;
  let colo = '';

  // Warmup TLS/HTTP2 connection first so handshake doesn't inflate RTT
  try {
    const warm = await fetch(`https://speed.cloudflare.com/__down?bytes=0&w=${Date.now()}`, {
      cache: 'no-store',
    });
    colo = warm.headers.get('cf-meta-colo') || '';
    await warm.arrayBuffer();
  } catch {
    // Ignore warmup failure
  }

  for (let i = 0; i < samplesCount; i += 1) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    const t0 = performance.now();
    try {
      const res = await fetch(
        `https://speed.cloudflare.com/__down?bytes=0&seq=${i}&t=${Date.now()}`,
        {
          cache: 'no-store',
          signal: ctrl.signal,
        },
      );
      if (!colo) colo = res.headers.get('cf-meta-colo') || '';
      await res.arrayBuffer();
      window.clearTimeout(timer);
      samples.push(Math.max(1, performance.now() - t0));
    } catch {
      window.clearTimeout(timer);
      failures += 1;
    }
  }

  const packetLossPct = Math.round((failures / samplesCount) * 100);
  if (samples.length === 0) {
    return { pingMs: null, minMs: null, maxMs: null, jitterMs: null, packetLossPct, colo };
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
    minMs: Math.round(Math.min(...samples)),
    maxMs: Math.round(Math.max(...samples)),
    jitterMs: Number(jitter.toFixed(1)),
    packetLossPct,
    colo,
  };
}

/**
 * Real DNS-over-HTTPS (DoH) timing & record query via Cloudflare 1.1.1.1 (`Access-Control-Allow-Origin: *`)
 */
async function queryDohRecords(
  domain: string,
  qtypes: string[] = ['A'],
): Promise<{ lookupMs: number | null; records: NetOpsDnsRecord[] }> {
  const records: NetOpsDnsRecord[] = [];
  const t0 = performance.now();
  await Promise.all(
    qtypes.map(async (qt) => {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${qt}`,
          {
            headers: { accept: 'application/dns-json' },
            cache: 'no-store',
            signal: ctrl.signal,
          },
        );
        const data = (await res.json()) as {
          Answer?: Array<{ type: number; TTL?: number; data: string }>;
        };
        window.clearTimeout(timer);
        for (const ans of (data.Answer || []).slice(0, 5)) {
          records.push({
            type: RECORD_TYPE_NAMES[ans.type] || qt,
            value: ans.data.replace(/^"|"$/g, ''),
            ttl: ans.TTL,
          });
        }
      } catch {
        window.clearTimeout(timer);
      }
    }),
  );
  const lookupMs = records.length > 0 ? Math.max(1, Math.round(performance.now() - t0)) : null;
  return { lookupMs, records };
}

function getConnectionLabel(): string {
  if (typeof navigator === 'undefined') return 'Mobile Network';
  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string };
  };
  const conn = nav.connection;
  if (conn?.type === 'wifi') return 'iPhone Wi-Fi';
  if (conn?.type === 'cellular')
    return `Cellular (${(conn.effectiveType || '5G/LTE').toUpperCase()})`;
  if (conn?.effectiveType) return `Active Link (${conn.effectiveType.toUpperCase()})`;
  return navigator.onLine ? 'iPhone Direct Link' : 'Offline';
}

function buildPhoneHops(
  colo: string,
  edgePingMs: number | null,
  dohMs: number | null,
): NetOpsHopMetric[] {
  return [
    {
      id: 'edge',
      label: colo ? `Cloudflare (${colo})` : 'Cloudflare Edge',
      target: 'speed.cloudflare.com',
      latencyMs: edgePingMs,
      status: hopStatus(edgePingMs, 50, 120),
    },
    {
      id: 'doh',
      label: '1.1.1.1 DoH DNS',
      target: 'cloudflare-dns.com',
      latencyMs: dohMs,
      status: hopStatus(dohMs, 55, 130),
    },
  ];
}

export async function runPhoneDirectScan(patch: StatePatcher): Promise<void> {
  patch((prev) => ({
    ...prev,
    scanning: true,
    activeAction: 'Phone-Direct: probing Public IP, Cloudflare Edge RTT & DoH DNS…',
    fixLog: appendLog(prev, '📱 Phone-Direct Scan started (CORS-verified Edge + DoH telemetry)'),
  }));

  const [ipInfo, ping, doh] = await Promise.all([
    fetchEdgeAndPublicIp(),
    measurePhoneEdgePing(5),
    queryDohRecords('cloudflare.com', ['A']),
  ]);
  const ssid = getConnectionLabel();
  const colo = ping.colo || ipInfo.colo;

  const devices: NetworkDevice[] = [
    {
      ip: ipInfo.publicIp !== '--' ? ipInfo.publicIp : 'Online',
      mac: 'THIS IPHONE',
      hostname: 'This iPhone (Direct Mode)',
      vendor: ipInfo.isp || 'Active Mobile / Wi-Fi Link',
      latencyMs: 0,
      isSelf: true,
    },
  ];
  if (colo || ping.pingMs !== null) {
    devices.push({
      ip: '1.1.1.1',
      mac: colo ? `POP ${colo}` : 'ANYCAST',
      hostname: colo ? `Cloudflare Edge (${colo})` : 'Cloudflare Anycast Edge',
      vendor: `RTT ${ping.pingMs ?? '--'}ms · Jitter ${ping.jitterMs ?? 0}ms`,
      latencyMs: ping.pingMs,
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
      colo,
      gatewayIp: colo ? `Edge ${colo}` : 'Mobile GW',
      dnsServers: ['1.1.1.1 DoH'],
      pingMs: ping.pingMs,
      jitterMs: ping.jitterMs,
      packetLossPct: ping.packetLossPct,
      dnsMs: doh.lookupMs ?? ping.pingMs,
      hops: buildPhoneHops(colo, ping.pingMs, doh.lookupMs),
      devices,
      wifiPasswordNote: 'Pair Mac/PC bridge to read saved Keychain Wi-Fi password',
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
        `✅ Phone-Direct: IP ${ipInfo.publicIp} (${ipInfo.isp || 'Direct'}), RTT ${ping.pingMs ?? '--'}ms, DoH ${doh.lookupMs ?? '--'}ms`,
      ),
    };
  });
}

/**
 * Live streaming Phone-Direct Speed Test (~8Hz speedometer needle updates!)
 */
export async function runPhoneDirectSpeedTest(patch: StatePatcher): Promise<void> {
  patch((prev) => ({
    ...prev,
    testingSpeed: true,
    speedPhase: 'ping',
    activeAction: 'Phase 1/3 · Measuring Edge RTT, Jitter & DoH DNS…',
    fixLog: appendLog(prev, '⚡ Phone-Direct Live Speed Benchmark started…'),
  }));

  const [ipInfo, ping, doh] = await Promise.all([
    fetchEdgeAndPublicIp(),
    measurePhoneEdgePing(5),
    queryDohRecords('cloudflare.com', ['A']),
  ]);
  const colo = ping.colo || ipInfo.colo;

  patch((prev) => ({
    ...prev,
    speedPhase: 'download',
    downMbps: 0,
    pingMs: ping.pingMs,
    jitterMs: ping.jitterMs,
    packetLossPct: ping.packetLossPct,
    dnsMs: doh.lookupMs ?? ping.pingMs,
    colo,
    hops: buildPhoneHops(colo, ping.pingMs, doh.lookupMs),
    activeAction: 'Phase 2/3 · Streaming live Download bandwidth…',
  }));

  let downMbps: number | null = null;
  try {
    const dlCtrl = new AbortController();
    const maxTimer = window.setTimeout(() => dlCtrl.abort(), 6000);
    const startTs = performance.now();
    let totalBytes = 0;
    let lastUi = startTs;

    const res = await fetch(
      `https://speed.cloudflare.com/__down?bytes=16000000&t=${Date.now()}`,
      {
        cache: 'no-store',
        signal: dlCtrl.signal,
      },
    );
    const reader = res.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          const now = performance.now();
          if (now - lastUi >= 150) {
            lastUi = now;
            const live = Number(
              ((totalBytes * 8) / Math.max(0.08, (now - startTs) / 1000) / 1_000_000).toFixed(1),
            );
            patch((prev) => ({ ...prev, downMbps: live }));
          }
        }
      }
    } else {
      const buf = await res.arrayBuffer();
      totalBytes += buf.byteLength;
    }
    window.clearTimeout(maxTimer);
    const secs = Math.max(0.08, (performance.now() - startTs) / 1000);
    if (totalBytes > 0) {
      downMbps = Number(((totalBytes * 8) / (secs * 1_000_000)).toFixed(1));
    }
  } catch {
    // Keep partial if any
  }

  patch((prev) => ({
    ...prev,
    downMbps: downMbps ?? prev.downMbps,
    speedPhase: 'upload',
    upMbps: 0,
    activeAction: 'Phase 3/3 · Measuring live Upload throughput…',
  }));

  let upMbps: number | null = null;
  try {
    const sizes = [500_000, 1_200_000, 2_000_000];
    let sent = 0;
    const upStart = performance.now();
    for (let i = 0; i < sizes.length; i += 1) {
      if (performance.now() - upStart > 5000) break;
      const payload = new Uint8Array(sizes[i]);
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 5000);
      await fetch(`https://speed.cloudflare.com/__up?i=${i}&t=${Date.now()}`, {
        method: 'POST',
        body: payload,
        cache: 'no-store',
        signal: ctrl.signal,
      });
      window.clearTimeout(timer);
      sent += payload.byteLength;
      const secs = Math.max(0.08, (performance.now() - upStart) / 1000);
      upMbps = Number(((sent * 8) / (secs * 1_000_000)).toFixed(1));
      const snapUp = upMbps;
      patch((prev) => ({ ...prev, upMbps: snapUp }));
    }
  } catch {
    // Ignore upload abort
  }

  const ssid = getConnectionLabel();
  patch((prev) => {
    const finalDown = downMbps ?? prev.downMbps;
    const finalUp = upMbps ?? prev.upMbps;
    const next: NetworkCommandState = {
      ...prev,
      testingSpeed: false,
      speedPhase: 'idle',
      activeAction: '',
      ssid,
      publicIp: ipInfo.publicIp !== '--' ? ipInfo.publicIp : prev.publicIp,
      isp: ipInfo.isp || prev.isp,
      colo,
      gatewayIp: colo ? `Edge ${colo}` : prev.gatewayIp || 'Mobile GW',
      dnsServers: ['1.1.1.1 DoH'],
      downMbps: finalDown,
      upMbps: finalUp,
      pingMs: ping.pingMs,
      jitterMs: ping.jitterMs,
      packetLossPct: ping.packetLossPct,
      dnsMs: doh.lookupMs ?? ping.pingMs,
      hops: buildPhoneHops(colo, ping.pingMs, doh.lookupMs),
      grade: computeGrade(finalDown, ping.pingMs, ping.packetLossPct),
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
        `✅ Phone-Direct Speed: ↓${finalDown ?? '--'} Mbps · ↑${finalUp ?? '--'} Mbps · RTT ${ping.pingMs ?? '--'}ms`,
      ),
    };
  });
}

/**
 * Phone-Direct Diagnostic Probe (works without Mac/Windows bridge via Cloudflare DoH + HTTPS Timing!)
 */
export async function runPhoneDirectProbe(
  mode: 'ping' | 'dns' | 'ports',
  rawTarget: string,
): Promise<NetOpsProbeResult> {
  const target = sanitizeHost(rawTarget);
  if (!target) {
    throw new Error('Enter a valid domain or IP address (e.g. github.com or 1.1.1.1)');
  }

  const dohA = await queryDohRecords(target, ['A']);
  const resolvedIp = dohA.records.find((r) => r.type === 'A')?.value || target;

  if (mode === 'dns') {
    const full = await queryDohRecords(target, ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT']);
    return {
      ok: full.records.length > 0,
      mode: 'dns',
      target,
      resolvedIp,
      source: 'phone',
      ts: Date.now(),
      summary:
        full.records.length > 0
          ? `Resolved ${full.records.length} record(s) for ${target} in ${full.lookupMs ?? '--'} ms via Cloudflare 1.1.1.1 DoH.`
          : `No public DNS records found for ${target}.`,
      dns: {
        lookupMs: full.lookupMs,
        resolver: 'Cloudflare 1.1.1.1 (DoH)',
        records: full.records,
      },
    };
  }

  if (mode === 'ping') {
    const samples: number[] = [];
    let failures = 0;
    const isCf = target === '1.1.1.1' || target.includes('cloudflare');
    for (let i = 0; i < 4; i += 1) {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3000);
      const t0 = performance.now();
      try {
        if (isCf) {
          const r = await fetch(`https://speed.cloudflare.com/__down?bytes=0&p=${i}&t=${Date.now()}`, {
            cache: 'no-store',
            signal: ctrl.signal,
          });
          await r.arrayBuffer();
        } else {
          await fetch(`https://${target}/favicon.ico?p=${i}&t=${Date.now()}`, {
            mode: 'no-cors',
            cache: 'no-store',
            signal: ctrl.signal,
          });
        }
        window.clearTimeout(timer);
        samples.push(Math.max(1, performance.now() - t0));
      } catch {
        window.clearTimeout(timer);
        failures += 1;
      }
    }

    const lossPct = Math.round((failures / 4) * 100);
    const avgMs = samples.length
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : null;
    const minMs = samples.length ? Math.round(Math.min(...samples)) : null;
    const maxMs = samples.length ? Math.round(Math.max(...samples)) : null;
    let jitterMs: number | null = null;
    if (samples.length > 1) {
      let d = 0;
      for (let i = 1; i < samples.length; i += 1) d += Math.abs(samples[i] - samples[i - 1]);
      jitterMs = Number((d / (samples.length - 1)).toFixed(1));
    }

    return {
      ok: avgMs !== null,
      mode: 'ping',
      target,
      resolvedIp,
      source: 'phone',
      ts: Date.now(),
      summary:
        avgMs !== null
          ? `HTTPS RTT to ${target} (${resolvedIp}): ${avgMs} ms avg (min ${minMs} ms, max ${maxMs} ms, jitter ${jitterMs ?? 0} ms).`
          : `Could not reach https://${target} from iPhone browser (${lossPct}% failed).`,
      ping: {
        sent: 4,
        received: 4 - failures,
        lossPct,
        minMs,
        avgMs,
        maxMs,
        jitterMs,
        httpStatus: avgMs !== null ? 200 : null,
        httpMs: avgMs,
      },
    };
  }

  // Phone-Direct Port Reachability (Browser allows probing web ports 443, 8443, 80, 8080; raw TCP requires paired bridge)
  const webPorts: Array<{ port: number; service: string; proto: 'https' | 'http' }> = [
    { port: 443, service: 'HTTPS', proto: 'https' },
    { port: 8443, service: 'HTTPS-Alt', proto: 'https' },
  ];
  const items: NetOpsPortResult[] = await Promise.all(
    webPorts.map(async ({ port, service, proto }) => {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 2200);
      const t0 = performance.now();
      try {
        await fetch(`${proto}://${target}:${port}/?t=${Date.now()}`, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        window.clearTimeout(timer);
        return { port, service, open: true, latencyMs: Math.max(1, Math.round(performance.now() - t0)) };
      } catch {
        window.clearTimeout(timer);
        return { port, service, open: false, latencyMs: null };
      }
    }),
  );
  const openCount = items.filter((i) => i.open).length;
  return {
    ok: true,
    mode: 'ports',
    target,
    resolvedIp,
    source: 'phone',
    ts: Date.now(),
    summary: `Phone-Direct checked TLS web ports (${openCount}/${items.length} reachable). Pair Mac/Windows bridge for full 14-port raw TCP scan (SSH, Postgres, Redis, Vite, etc.).`,
    ports: {
      scannedCount: items.length,
      openCount,
      items,
    },
  };
}
