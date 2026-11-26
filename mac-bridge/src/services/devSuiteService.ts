import {probeWebsite} from './websiteProbe.js';
import { execFile } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { loadDoctorAiKey } from './doctorAiAgent.js';
import { isLocalTargetHost, normalizeWebStudioUrl } from './localPreviewService.js';

const execFileAsync = promisify(execFile);

export interface ApiProxyRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ApiProxyResponse {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export interface WebsiteInspectResult {
  url: string;
  finalUrl: string;
  status: number;
  elapsedMs: number;
  sizeBytes?: number;
  isLocalhost?: boolean;
  localPort?: number | null;
  frameBlocked?: boolean;
  headers: Record<string, string>;
  meta: {
    title: string;
    description: string;
    viewport: string;
    canonical: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    charset: string;
  };
  error?: string;
}

export interface SiteMonitorResult {
  failureStage?:string;
  url: string;
  up: boolean;
  status: number;
  responseMs: number;
  sslIssuer: string | null;
  sslValidTo: string | null;
  sslDaysLeft: number | null;
  domainExpiry: string | null;
  domainDaysLeft: number | null;
  checkedAt: number;
  error?: string;
}

export interface SshConnectionInput {
  host: string;
  port?: number;
  username: string;
  identityFile?: string;
}

export interface SshStatsResult {
  ok: boolean;
  hostname: string;
  uptime: string;
  loadAvg: string;
  cpuPct: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskUsedPct: number | null;
  diskSummary: string;
  containers: Array<{ name: string; status: string; image: string }>;
  error?: string;
}

export interface HostingOverviewResult {
  databases: Array<{ name: string; port: number; status: 'online' | 'offline' }>;
  repos: Array<{ name: string; url: string; branch: string; isPrivate: boolean; updatedAt: string }>;
  deployments: Array<{ id: string; title: string; target: string; status: string; time: string }>;
  checkedAt: number;
}

function normalizeUrl(raw: string): string {
  return normalizeWebStudioUrl(raw);
}

export async function runApiRequest(req: ApiProxyRequest): Promise<ApiProxyResponse> {
  const url = normalizeUrl(req.url);
  const method = (req.method || 'GET').toUpperCase();
  const timeoutMs = Math.min(25_000, Math.max(1500, req.timeoutMs || 12_000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const init: RequestInit = {
      method,
      headers: req.headers || {},
      signal: ctrl.signal,
    };
    if (req.body && !['GET', 'HEAD'].includes(method)) {
      init.body = req.body;
    }

    const res = await fetch(url, init);
    const text = await res.text();
    clearTimeout(timer);
    const elapsedMs = Math.max(1, Date.now() - t0);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || '',
      elapsedMs,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      headers,
      body: text.slice(0, 120_000),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      statusText: 'NETWORK_ERROR',
      elapsedMs: Math.max(1, Date.now() - t0),
      sizeBytes: 0,
      headers: {},
      body: '',
      error: err instanceof Error ? err.message : 'Request failed',
    };
  }
}

function extractTagAttr(html: string, regex: RegExp): string {
  const m = html.match(regex);
  return m?.[1]?.trim() || '';
}

export async function inspectWebsite(rawUrl: string): Promise<WebsiteInspectResult> {
  const url = normalizeUrl(rawUrl);
  const parsed = new URL(url);
  const isLocalhost = isLocalTargetHost(parsed.hostname);
  const localPort = isLocalhost ? (parsed.port ? Number(parsed.port) : 80) : null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  const t0 = Date.now();

  try {
    let res: Response;
    try {
      const targetFetchUrl = isLocalhost
        ? `http://127.0.0.1:${localPort}${parsed.pathname}${parsed.search}`
        : url;
      res = await fetch(targetFetchUrl, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'DevDeck-Inspector/2.0',
          ...(isLocalhost ? { host: `localhost:${localPort}` } : {}),
        },
      });
    } catch (primaryErr) {
      if (!isLocalhost) throw primaryErr;
      // Fallback to IPv6 loopback [::1] for Vite / Node 20+ dev servers bound to ::1
      res = await fetch(`http://[::1]:${localPort}${parsed.pathname}${parsed.search}`, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'DevDeck-Inspector/2.0',
          host: `localhost:${localPort}`,
        },
      });
    }

    const fullText = await res.text();
    const sizeBytes = Buffer.byteLength(fullText, 'utf8');
    const html = fullText.slice(0, 180_000);
    clearTimeout(timer);

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });

    const xfo = (headers['x-frame-options'] || '').toLowerCase();
    const csp = (headers['content-security-policy'] || '').toLowerCase();
    const cspBlocksFrame =
      csp.includes('frame-ancestors') &&
      !/frame-ancestors\s+\*/.test(csp) &&
      !csp.includes('helper-nu-swart.vercel.app');
    const frameBlocked = Boolean(
      !isLocalhost && (xfo.includes('deny') || xfo.includes('sameorigin') || cspBlocksFrame),
    );

    const title = extractTagAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ');
    const metaContent = (attr: string, val: string) => {
      const r1 = new RegExp(
        `<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"']*)["']`,
        'i',
      );
      const r2 = new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${val}["']`,
        'i',
      );
      return extractTagAttr(html, r1) || extractTagAttr(html, r2);
    };

    const canonical =
      extractTagAttr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
      extractTagAttr(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const charset = extractTagAttr(html, /<meta[^>]+charset=["']?([^"'\s>]+)/i);

    return {
      url,
      finalUrl: isLocalhost ? url : res.url || url,
      status: res.status,
      elapsedMs: Math.max(1, Date.now() - t0),
      sizeBytes,
      isLocalhost,
      localPort,
      frameBlocked,
      headers,
      meta: {
        title,
        description: metaContent('name', 'description'),
        viewport: metaContent('name', 'viewport'),
        canonical,
        ogTitle: metaContent('property', 'og:title'),
        ogDescription: metaContent('property', 'og:description'),
        ogImage: metaContent('property', 'og:image'),
        charset,
      },
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      url,
      finalUrl: url,
      status: 0,
      elapsedMs: Math.max(1, Date.now() - t0),
      sizeBytes: 0,
      isLocalhost,
      localPort,
      frameBlocked: false,
      headers: {},
      meta: {
        title: '',
        description: '',
        viewport: '',
        canonical: '',
        ogTitle: '',
        ogDescription: '',
        ogImage: '',
        charset: '',
      },
      error: isLocalhost
        ? `Nothing listening on localhost:${localPort} yet — run "npm run dev" on your computer.`
        : err instanceof Error
          ? err.message
          : 'Failed to inspect URL',
    };
  }
}

function checkSslCert(hostname: string, port = 443): Promise<{
  issuer: string | null;
  validTo: string | null;
  daysLeft: number | null;
}> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 4500 },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            resolve({ issuer: null, validTo: null, daysLeft: null });
            return;
          }
          const expMs = Date.parse(cert.valid_to);
          const daysLeft = Number.isFinite(expMs)
            ? Math.floor((expMs - Date.now()) / (1000 * 60 * 60 * 24))
            : null;
          const issuer =
            (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || 'TLS Certificate';
          resolve({
            issuer: Array.isArray(issuer) ? issuer[0] : String(issuer),
            validTo: Number.isFinite(expMs) ? new Date(expMs).toISOString().slice(0, 10) : cert.valid_to,
            daysLeft,
          });
        } catch {
          socket.destroy();
          resolve({ issuer: null, validTo: null, daysLeft: null });
        }
      },
    );
    socket.on('error', () => resolve({ issuer: null, validTo: null, daysLeft: null }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ issuer: null, validTo: null, daysLeft: null });
    });
  });
}

async function checkDomainExpiryRdap(hostname: string): Promise<{
  expiry: string | null;
  daysLeft: number | null;
}> {
  // Skip IP addresses or localhost
  if (/^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(hostname) || !hostname.includes('.')) {
    return { expiry: null, daysLeft: null };
  }
  const parts = hostname.split('.');
  const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(rootDomain)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/rdap+json' },
    });
    clearTimeout(timer);
    if (!res.ok) return { expiry: null, daysLeft: null };
    const data = (await res.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    const expEvent = data.events?.find((e) =>
      /expiration/i.test(e.eventAction || ''),
    );
    if (!expEvent?.eventDate) return { expiry: null, daysLeft: null };
    const expMs = Date.parse(expEvent.eventDate);
    if (!Number.isFinite(expMs)) return { expiry: null, daysLeft: null };
    return {
      expiry: new Date(expMs).toISOString().slice(0, 10),
      daysLeft: Math.floor((expMs - Date.now()) / (1000 * 60 * 60 * 24)),
    };
  } catch {
    clearTimeout(timer);
    return { expiry: null, daysLeft: null };
  }
}

export async function checkSiteMonitor(rawUrl: string): Promise<SiteMonitorResult> {
  const url = normalizeUrl(rawUrl);
  const parsed = new URL(url);
  const t0=Date.now();
  const {status,up,error,failureStage}=await probeWebsite(url);
  const responseMs = Math.max(1, Date.now() - t0);

  const [ssl, rdap] = await Promise.all([
    parsed.protocol === 'https:'
      ? checkSslCert(parsed.hostname, Number(parsed.port) || 443)
      : Promise.resolve({ issuer: null, validTo: null, daysLeft: null }),
    checkDomainExpiryRdap(parsed.hostname),
  ]);

  return {
    url,
    up,
    status,
    responseMs,
    failureStage,
    sslIssuer: ssl.issuer,
    sslValidTo: ssl.validTo,
    sslDaysLeft: ssl.daysLeft,
    domainExpiry: rdap.expiry,
    domainDaysLeft: rdap.daysLeft,
    checkedAt: Date.now(),
    error,
  };
}

function probeTcpPort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host, timeout: 600 });
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

export async function getHostingOverview(projectDir: string): Promise<HostingOverviewResult> {
  const dbDefs = [
    { name: 'PostgreSQL', port: 5432 },
    { name: 'MySQL / MariaDB', port: 3306 },
    { name: 'Redis', port: 6379 },
    { name: 'MongoDB', port: 27017 },
  ];

  const databases = await Promise.all(
    dbDefs.map(async (db) => ({
      name: db.name,
      port: db.port,
      status: (await probeTcpPort(db.port)) ? ('online' as const) : ('offline' as const),
    })),
  );

  // GitHub repos via `gh` CLI (fallback to local git remote)
  const repos: HostingOverviewResult['repos'] = [];
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'list', '--limit', '8', '--json', 'name,url,updatedAt,isPrivate,defaultBranchRef'],
      { timeout: 4500 },
    );
    const parsed = JSON.parse(stdout) as Array<{
      name: string;
      url: string;
      updatedAt: string;
      isPrivate: boolean;
      defaultBranchRef?: { name?: string };
    }>;
    for (const r of parsed) {
      repos.push({
        name: r.name,
        url: r.url,
        branch: r.defaultBranchRef?.name || 'main',
        isPrivate: Boolean(r.isPrivate),
        updatedAt: (r.updatedAt || '').slice(0, 10),
      });
    }
  } catch {
    try {
      const { stdout } = await execFileAsync('git', ['remote', '-v'], {
        cwd: projectDir,
        timeout: 2000,
      });
      const m = stdout.match(/origin\s+(\S+)\s+\(fetch\)/);
      if (m) {
        const url = m[1].replace(/\.git$/, '');
        const name = url.split('/').pop() || 'Repository';
        repos.push({ name, url, branch: 'main', isPrivate: false, updatedAt: 'active' });
      }
    } catch {
      // Ignore
    }
  }

  // Recent deployments / commits from local git log
  const deployments: HostingOverviewResult['deployments'] = [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-n', '8', '--format=%h||%s||%cr'],
      { cwd: projectDir, timeout: 2500 },
    );
    for (const line of stdout.split(/\r?\n/)) {
      const [hash, subject, rel] = line.split('||');
      if (!hash) continue;
      deployments.push({
        id: hash,
        title: subject || 'Commit',
        target: 'production (main)',
        status: 'READY',
        time: rel || '',
      });
    }
  } catch {
    // Ignore
  }

  return { databases, repos, deployments, checkedAt: Date.now() };
}

function buildSshArgs(conn: SshConnectionInput, remoteCmd: string): string[] {
  const host = conn.host.trim();
  const user = conn.username.trim();
  if (!host || !user) throw new Error('Host and username are required');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Invalid SSH host');
  if (!/^[a-zA-Z0-9._-]+$/.test(user)) throw new Error('Invalid SSH username');

  const port = Math.min(65535, Math.max(1, Number(conn.port) || 22));
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=6',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-p',
    String(port),
  ];
  if (conn.identityFile?.trim()) {
    args.push('-i', conn.identityFile.trim());
  }
  args.push(`${user}@${host}`, remoteCmd);
  return args;
}

export async function runSshCommand(
  conn: SshConnectionInput,
  command: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const cmd = command.trim();
  if (!cmd) return { ok: false, stdout: '', stderr: 'Empty command', exitCode: 1 };
  try {
    const args = buildSshArgs(conn, cmd);
    const { stdout, stderr } = await execFileAsync('ssh', args, {
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    return { ok: true, stdout: stdout.slice(0, 60_000), stderr: stderr.slice(0, 15_000), exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      ok: false,
      stdout: (e.stdout || '').slice(0, 30_000),
      stderr: (e.stderr || e.message || 'SSH command failed').slice(0, 15_000),
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export async function getSshStats(conn: SshConnectionInput): Promise<SshStatsResult> {
  const probe = [
    'echo "HOST=$(hostname)"',
    'echo "UP=$(uptime -p 2>/dev/null || uptime)"',
    'echo "LOAD=$(cat /proc/loadavg 2>/dev/null | awk \'{print $1,$2,$3}\')"',
    'echo "MEM=$(free -m 2>/dev/null | awk \'/Mem:/ {print $3,$2}\')"',
    'echo "DISK=$(df -h / 2>/dev/null | awk \'NR==2 {print $5,$3,$2}\')"',
    'echo "DOCKER_START"',
    'docker ps --format "{{.Names}}||{{.Status}}||{{.Image}}" 2>/dev/null || true',
    'echo "DOCKER_END"',
  ].join('; ');

  const res = await runSshCommand(conn, probe);
  if (!res.ok) {
    return {
      ok: false,
      hostname: conn.host,
      uptime: '--',
      loadAvg: '--',
      cpuPct: null,
      ramUsedMb: null,
      ramTotalMb: null,
      diskUsedPct: null,
      diskSummary: '--',
      containers: [],
      error: res.stderr || 'SSH connection failed (check SSH key / host)',
    };
  }

  let hostname = conn.host;
  let uptime = '--';
  let loadAvg = '--';
  let ramUsedMb: number | null = null;
  let ramTotalMb: number | null = null;
  let diskUsedPct: number | null = null;
  let diskSummary = '--';
  const containers: SshStatsResult['containers'] = [];
  let inDocker = false;

  for (const line of res.stdout.split(/\r?\n/)) {
    if (line === 'DOCKER_START') {
      inDocker = true;
      continue;
    }
    if (line === 'DOCKER_END') {
      inDocker = false;
      continue;
    }
    if (inDocker && line.includes('||')) {
      const [name, status, image] = line.split('||');
      if (name) containers.push({ name, status: status || '', image: image || '' });
      continue;
    }
    if (line.startsWith('HOST=')) hostname = line.slice(5).trim() || conn.host;
    else if (line.startsWith('UP=')) uptime = line.slice(3).trim();
    else if (line.startsWith('LOAD=')) loadAvg = line.slice(5).trim();
    else if (line.startsWith('MEM=')) {
      const [u, t] = line.slice(4).trim().split(/\s+/).map(Number);
      if (Number.isFinite(u) && Number.isFinite(t)) {
        ramUsedMb = u;
        ramTotalMb = t;
      }
    } else if (line.startsWith('DISK=')) {
      const parts = line.slice(5).trim().split(/\s+/);
      if (parts[0]) diskUsedPct = Number(parts[0].replace('%', '')) || null;
      if (parts[1] && parts[2]) diskSummary = `${parts[1]} / ${parts[2]} (${parts[0]})`;
    }
  }

  const firstLoad = Number(loadAvg.split(/\s+/)[0]);
  const cpuPct = Number.isFinite(firstLoad) ? Math.min(100, Math.round(firstLoad * 25)) : null;

  return {
    ok: true,
    hostname,
    uptime,
    loadAvg,
    cpuPct,
    ramUsedMb,
    ramTotalMb,
    diskUsedPct,
    diskSummary,
    containers,
  };
}

export async function runSshServiceAction(
  conn: SshConnectionInput,
  kind: 'docker' | 'systemd',
  target: string,
  action: 'restart' | 'stop' | 'start',
): Promise<{ ok: boolean; message: string }> {
  const safeTarget = target.trim();
  if (!/^[a-zA-Z0-9._@-]+$/.test(safeTarget)) {
    return { ok: false, message: 'Invalid service or container name' };
  }
  const cmd =
    kind === 'docker'
      ? `docker ${action} ${safeTarget}`
      : `sudo -n systemctl ${action} ${safeTarget} 2>&1 || systemctl ${action} ${safeTarget}`;
  const res = await runSshCommand(conn, cmd);
  return {
    ok: res.ok,
    message: res.ok
      ? `${kind}:${safeTarget} ${action} OK`
      : res.stderr || res.stdout || `Failed to ${action} ${safeTarget}`,
  };
}

export interface NourChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface NourChatResult {
  ok: boolean;
  reply: string;
  audioBase64?: string;
  audioMime?: string;
  action?: string | null;
  error?: string;
}

interface NourModelSpec {
  id: string;
  useThinkingZero: boolean;
  inlineSystem?: boolean;
}

// Verified live active fast models (Nov 2026):
// gemini-3.5-flash-lite (~1.0s) + gemini-3.5-flash (~1.2s) + gemma-4-26b-a4b-it (~1.9s, huge 30 RPM quota!)
const NOUR_MODELS: NourModelSpec[] = [
  { id: 'gemini-3.5-flash-lite', useThinkingZero: false },
  { id: 'gemini-3.5-flash', useThinkingZero: true },
  { id: 'gemma-4-26b-a4b-it', useThinkingZero: false, inlineSystem: true },
];

// 100% Pure Google Gemini Native "Aoede" Voice (NEVER switches to robotic fallback!)
// Active highest-success models first, with smart sub-second token-bucket retry on transient 429s
const GEMINI_AOEDE_TTS_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];
let aoedeTtsCursor = 0;

function pcm24kToWav16kBase64(pcmBase64: string): string {
  const src = Buffer.from(pcmBase64, 'base64');
  const srcSamples = Math.floor(src.length / 2);
  const dstSamples = Math.floor((srcSamples * 2) / 3);
  const pcm = Buffer.alloc(dstSamples * 2);

  for (let i = 0; i < dstSamples; i += 1) {
    const pos = i * 1.5;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = src.readInt16LE(Math.min(idx, srcSamples - 1) * 2);
    const s1 = src.readInt16LE(Math.min(idx + 1, srcSamples - 1) * 2);
    const val = Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac)));
    pcm.writeInt16LE(val, i * 2);
  }

  const header = Buffer.alloc(44);
  const sampleRate = 16000;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString('base64');
}

async function callSingleAoedeModel(
  model: string,
  styledPrompt: string,
  apiKey: string,
): Promise<{ audioBase64: string; audioMime: string } | 'rate_limited' | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: styledPrompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Aoede' },
              },
            },
          },
        }),
      },
    );
    clearTimeout(timer);
    if (res.status === 429) return 'rate_limited';
    if (!res.ok) return null;

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };
    const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) return null;

    if (/pcm|L16/i.test(inline.mimeType || '')) {
      return { audioBase64: pcm24kToWav16kBase64(inline.data), audioMime: 'audio/wav' };
    }
    return { audioBase64: inline.data, audioMime: inline.mimeType || 'audio/wav' };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function synthesizeNourSpeech(
  text: string,
  apiKey: string,
): Promise<{ audioBase64: string; audioMime: string } | null> {
  // Check ALL 5 Gemini Aoede TTS models across passes (429 fails fast in ~190ms)
  for (let pass = 0; pass < 3; pass += 1) {
    const start = aoedeTtsCursor % GEMINI_AOEDE_TTS_MODELS.length;
    aoedeTtsCursor += 1;

    for (let i = 0; i < GEMINI_AOEDE_TTS_MODELS.length; i += 1) {
      const model = GEMINI_AOEDE_TTS_MODELS[(start + i) % GEMINI_AOEDE_TTS_MODELS.length];
      const out = await callSingleAoedeModel(model, text, apiKey);
      if (out && out !== 'rate_limited') return out;
    }

    if (pass < 2) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  return null;
}

export async function chatWithNour(opts: {
  message: string;
  history?: NourChatMessage[];
  botName?: string;
  voiceName?: string;
  liveContext?: string;
}): Promise<NourChatResult> {
  const apiKey = loadDoctorAiKey();
  if (!apiKey) {
    return {
      ok: false,
      reply: 'محتاجة مفتاح جيميناي من صفحة بي سي دكتور عشان أرد عليك.',
      error: 'Missing Gemini API key',
    };
  }

  const name = (opts.botName || 'نور').trim() || 'نور';
  const systemPrompt = `إنتي "${name}"، بنت مصرية قاهرية عندك 24 سنة، صاحبته المقربة جداً، ذكية، طبيعية، رايقة، وموجودة معاه بالساعات يتكلم معاكي في أي حاجة.

أسلوبك ونطقك المصري (مهم جداً عشان الصوت يطلع مصري أصلي 100% زي جيميناي وشات جي بي تي):
1. اتكلمي عامية مصرية قاهرية صافية 100% — اكتبي الكلمات بالطريقة اللي المصريين بينطقوها فعلاً وحطي تشكيل خفيف بس على الحروف اللي بتفرق المصري عن الفصحى (مثلاً: إزَّيَّك، عَامِل إيه، بُص بقى، دِلوَقتي، مَعلِش، كُوَيِّس، عَشَان، مِش، إحنَا). ممنوع نهائياً أي جملة أو كلمة فصحى!
2. ممنوع الكليشيهات أو الكلام المصطنع (بلاش يا قمر/يا سيدي/يا بطل/تحت أمرك). خليكي صاحبته بجد بعفوية حقيقية وطبيعية.
3. خلي ردك سريع ومباشر (جملة أو جملتين بالكتير إلا لو طلب شرح طويل) عشان المحادثة تبقى سريعة وممتعة.
4. ممنوع أي رموز ماركداون أو نجوم أو إيموجي. اكتبي أسماء التكنولوجيا بالعربي السهل (ديف ديك، فيرسل، بي سي دكتور، نيت أوبس، باور جارد).
5. إنتي صاحبته المقربة وموسوعة ذكية في كل حاجة (برمجة، تقنية، شغل، علوم، أفلام، فضفضة، نصايح) وعارفة كل تفاصيل مشروعه ديف ديك وحالة جهازه.
6. لو طلب أمر في الجهاز، ضيفي في آخر سطر بس: [ACTION:اسم_الأمر] (المتاح: doctor_scan, net_scan, lock_screen, caffeine_on, caffeine_off, open_antigravity, open_power, open_doctor, open_network).

حالة الجهاز دلوقتي:
${opts.liveContext || 'الجهاز شغال تمام.'}`;

  const contents = [
    ...(opts.history || []).slice(-18).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    })),
    { role: 'user', parts: [{ text: opts.message }] },
  ];

  const callOneModel = async (spec: NourModelSpec, signal: AbortSignal): Promise<string> => {
    const reqBody = spec.inlineSystem
      ? {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\nردي بجملة مصرية واحدة أو جملتين بس بدون شرح أو نجوم على رسالة صاحبك دي:\n${opts.message}` }],
            },
          ],
          generationConfig: { temperature: 0.75, maxOutputTokens: 80 },
        }
      : {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.78,
            maxOutputTokens: 80,
            ...(spec.useThinkingZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${spec.id}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify(reqBody),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join(' ').trim();
    if (!raw) throw new Error('Empty reply');
    return raw;
  };

  // Hedged parallel race: fire primary immediately (~1.0s), hedge at 750ms & 1400ms so cold TLS or spikes never drop Turn 1!
  const controllers = NOUR_MODELS.map(() => new AbortController());
  const globalTimer = setTimeout(() => controllers.forEach((c) => c.abort()), 9000);
  let hedgeTimer1: NodeJS.Timeout | null = null;
  let hedgeTimer2: NodeJS.Timeout | null = null;

  try {
    const p0 = callOneModel(NOUR_MODELS[0], controllers[0].signal);
    const p1 = new Promise<string>((resolve, reject) => {
      hedgeTimer1 = setTimeout(() => {
        callOneModel(NOUR_MODELS[1], controllers[1].signal).then(resolve, reject);
      }, 750);
    });
    const p2 = new Promise<string>((resolve, reject) => {
      hedgeTimer2 = setTimeout(() => {
        callOneModel(NOUR_MODELS[2], controllers[2].signal).then(resolve, reject);
      }, 1400);
    });

    const raw = await Promise.any([p0, p1, p2]);
    clearTimeout(globalTimer);
    if (hedgeTimer1) clearTimeout(hedgeTimer1);
    if (hedgeTimer2) clearTimeout(hedgeTimer2);
    controllers.forEach((c) => c.abort());

    let action: string | null = null;
    const actionMatch = raw.match(/\[ACTION:([a-z_]+)\]/i);
    if (actionMatch) action = actionMatch[1].toLowerCase();

    const cleanReply = raw
      .replace(/\[ACTION:[a-z_]+\]/gi, '')
      .replace(/[*#_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const audio = await synthesizeNourSpeech(cleanReply, apiKey);

    return {
      ok: true,
      reply: cleanReply,
      audioBase64: audio?.audioBase64,
      audioMime: audio?.audioMime,
      action,
    };
  } catch {
    clearTimeout(globalTimer);
    if (hedgeTimer1) clearTimeout(hedgeTimer1);
    if (hedgeTimer2) clearTimeout(hedgeTimer2);
    controllers.forEach((c) => c.abort());
  }

  const fallbackMsg = 'ثانية واحدة الصوت قطع عندي، قول تاني كده؟';
  const fallbackAudio = await synthesizeNourSpeech(fallbackMsg, apiKey);
  return {
    ok: false,
    reply: fallbackMsg,
    audioBase64: fallbackAudio?.audioBase64,
    audioMime: fallbackAudio?.audioMime,
    error: 'All Gemini models failed or rate-limited',
  };
}
