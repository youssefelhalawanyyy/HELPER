import { type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';
import {
  killChildProcessTree,
  spawnCloudflaredQuickTunnel,
} from '../platform/cloudflared.js';

const IDLE_TTL_MS = 45 * 60 * 1000;

const BLOCKED_PORTS = new Set([21, 22, 23, 25, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 6379, 27017]);

const CONSOLE_BRIDGE_SNIPPET = `<script data-devdeck-probe>
(function(){
  if(window.__ddProbe)return;window.__ddProbe=1;
  function send(level,args){
    try{
      parent.postMessage({
        source:'devdeck-preview',
        type:'console',
        level:level,
        text:Array.prototype.slice.call(args).map(function(a){
          if(a instanceof Error)return a.message||String(a);
          if(typeof a==='object'){try{return JSON.stringify(a)}catch(e){return String(a)}}
          return String(a);
        }).join(' '),
        href:location.href,
        ts:Date.now()
      },'*');
    }catch(e){}
  }
  ['error','warn','info'].forEach(function(k){
    var orig=console[k];
    console[k]=function(){send(k,arguments);return orig.apply(console,arguments);};
  });
  window.addEventListener('error',function(e){
    send('error',[e.message||(e.error&&e.error.message)||'Runtime error',e.filename?('('+e.filename+':'+e.lineno+')'):'']);
  });
  window.addEventListener('unhandledrejection',function(e){
    send('error',['Unhandled Promise Rejection:',e.reason]);
  });
  try{parent.postMessage({source:'devdeck-preview',type:'ready',href:location.href,title:document.title,ts:Date.now()},'*');}catch(e){}
})();
</script>`;

interface PreviewEntry {
  key: string;
  targetKind: 'local' | 'remote';
  targetPort: number;
  remoteOrigin?: string;
  proxyServer: http.Server;
  proxyPort: number;
  tunnelProc: ChildProcess | null;
  tunnelUrl: string | null;
  tunnelPromise: Promise<string | null> | null;
  lastUsedAt: number;
}

const entries = new Map<string, PreviewEntry>();

export interface PreviewSessionRequest {
  url: string;
  lanIp: string;
  bridgePort: number;
  wantHttps?: boolean;
  forceProxy?: boolean;
}

export interface PreviewSessionResult {
  ok: boolean;
  normalizedUrl: string;
  isLocalhost: boolean;
  localPort: number | null;
  reachable: boolean;
  previewUrl: string;
  lanUrl: string | null;
  tunnelUrl: string | null;
  mode: 'https-tunnel' | 'lan-proxy' | 'direct';
  error?: string;
}

export function normalizeWebStudioUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('URL or port is required');

  // Support shorthand ":3000", "3000", ":5173/dashboard"
  const portOnly = trimmed.match(/^:?(\d{2,5})(\/.*)?$/);
  if (portOnly) {
    return `http://localhost:${portOnly[1]}${portOnly[2] || ''}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const hostPart = trimmed.split('/')[0].toLowerCase();
  const isLocal =
    hostPart === 'localhost' ||
    hostPart.startsWith('localhost:') ||
    hostPart.startsWith('127.0.0.1') ||
    hostPart.startsWith('[::1]') ||
    hostPart.startsWith('0.0.0.0') ||
    hostPart.endsWith('.local') ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostPart);

  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}

export function isLocalTargetHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function tryTcpConnect(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

export async function probeLocalhostPort(port: number): Promise<{
  reachable: boolean;
  host: '127.0.0.1' | '::1';
}> {
  if (await tryTcpConnect('127.0.0.1', port, 380)) {
    return { reachable: true, host: '127.0.0.1' };
  }
  if (await tryTcpConnect('::1', port, 380)) {
    return { reachable: true, host: '::1' };
  }
  return { reachable: false, host: '127.0.0.1' };
}

function stripFrameBlockingHeaders(rawHeaders: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (
      lower === 'x-frame-options' ||
      lower === 'content-length' ||
      lower === 'transfer-encoding' ||
      lower === 'connection' ||
      lower === 'keep-alive'
    ) {
      continue;
    }
    if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
      const str = Array.isArray(v) ? v.join('; ') : v;
      const cleaned = str
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^frame-ancestors\b/i.test(d))
        .join('; ');
      if (cleaned) out[k] = cleaned;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function injectProbeIntoHtml(html: string): string {
  if (html.includes('data-devdeck-probe')) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${CONSOLE_BRIDGE_SNIPPET}`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${CONSOLE_BRIDGE_SNIPPET}</body>`);
  }
  return `${CONSOLE_BRIDGE_SNIPPET}${html}`;
}

function renderOfflineWaitingPage(port: number): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Waiting for localhost:${port}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090f;color:#e2e8f0;font:14px/1.5 system-ui,-apple-system,sans-serif;padding:24px;text-align:center}
  .card{max-width:340px;padding:22px;border-radius:16px;border:1px solid rgba(34,211,238,.28);background:#0d121c}
  .dot{width:10px;height:10px;border-radius:50%;background:#fbbf24;margin:0 auto 12px;box-shadow:0 0 12px #fbbf24}
  code{font-family:ui-monospace,monospace;color:#22d3ee;background:rgba(34,211,238,.12);padding:2px 6px;border-radius:6px}
  p{color:#94a3b8;font-size:12.5px;margin:8px 0 0}
</style></head><body>
<div class="card">
  <div class="dot"></div>
  <strong>Waiting for <code>localhost:${port}</code></strong>
  <p>Start your dev server (<code>npm run dev</code>) — this preview will connect automatically as soon as port ${port} opens.</p>
</div>
<script>
  try{parent.postMessage({source:'devdeck-preview',type:'offline',port:${port},ts:Date.now()},'*');}catch(e){}
  setTimeout(function(){location.reload();},2200);
</script>
</body></html>`;
}

async function createLocalProxyEntry(
  key: string,
  opts: { targetKind: 'local' | 'remote'; targetPort: number; remoteOrigin?: string },
): Promise<PreviewEntry> {
  const existing = entries.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const proxyServer = http.createServer(async (clientReq, clientRes) => {
    const entry = entries.get(key);
    if (entry) entry.lastUsedAt = Date.now();

    const reqUrl = clientReq.url || '/';
    const acceptHeader = String(clientReq.headers.accept || '');
    const wantsHtml = acceptHeader.includes('text/html') || reqUrl === '/' || !/\.[a-z0-9]{2,5}(\?|$)/i.test(reqUrl);

    let targetHostname = '127.0.0.1';
    let targetPort = opts.targetPort;
    let useTls = false;
    let hostHeader = `localhost:${opts.targetPort}`;
    let originHeader = `http://localhost:${opts.targetPort}`;

    if (opts.targetKind === 'local') {
      const probe = await probeLocalhostPort(opts.targetPort);
      if (!probe.reachable) {
        const body = renderOfflineWaitingPage(opts.targetPort);
        clientRes.writeHead(502, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        clientRes.end(body);
        return;
      }
      targetHostname = probe.host;
    } else if (opts.remoteOrigin) {
      const parsedRemote = new URL(opts.remoteOrigin);
      useTls = parsedRemote.protocol === 'https:';
      targetHostname = parsedRemote.hostname;
      targetPort = parsedRemote.port ? Number(parsedRemote.port) : useTls ? 443 : 80;
      hostHeader = parsedRemote.host;
      originHeader = parsedRemote.origin;
    }

    const fwdHeaders: http.OutgoingHttpHeaders = { ...clientReq.headers };
    fwdHeaders.host = hostHeader;
    if (fwdHeaders.origin) fwdHeaders.origin = originHeader;
    if (fwdHeaders.referer) {
      try {
        const ref = new URL(String(fwdHeaders.referer));
        fwdHeaders.referer = `${originHeader}${ref.pathname}${ref.search}`;
      } catch {
        delete fwdHeaders.referer;
      }
    }
    // Request uncompressed HTML on loopback so we can cleanly strip CSP & inject console probe
    if (wantsHtml) {
      fwdHeaders['accept-encoding'] = 'identity';
    }

    const transport = useTls ? https : http;
    const upstreamReq = transport.request(
      {
        hostname: targetHostname,
        port: targetPort,
        path: reqUrl,
        method: clientReq.method,
        headers: fwdHeaders,
        ...(useTls ? { servername: targetHostname, rejectUnauthorized: false } : {}),
      },
      (upstreamRes) => {
        const cleanHeaders = stripFrameBlockingHeaders(upstreamRes.headers);
        if (cleanHeaders.location && typeof cleanHeaders.location === 'string') {
          cleanHeaders.location = cleanHeaders.location.replace(
            new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${opts.targetPort}`, 'i'),
            '',
          );
        }

        const contentType = String(upstreamRes.headers['content-type'] || '');
        const contentEncoding = String(upstreamRes.headers['content-encoding'] || '');
        const isUncompressedHtml =
          contentType.includes('text/html') && (!contentEncoding || contentEncoding === 'identity');

        if (isUncompressedHtml) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (c: Buffer) => chunks.push(c));
          upstreamRes.on('end', () => {
            const rawHtml = Buffer.concat(chunks).toString('utf8');
            const injected = injectProbeIntoHtml(rawHtml);
            clientRes.writeHead(upstreamRes.statusCode || 200, cleanHeaders);
            clientRes.end(injected, 'utf8');
          });
          upstreamRes.on('error', () => {
            if (!clientRes.headersSent) clientRes.writeHead(502);
            clientRes.end();
          });
        } else {
          if (upstreamRes.headers['content-length']) {
            cleanHeaders['content-length'] = upstreamRes.headers['content-length'];
          }
          clientRes.writeHead(upstreamRes.statusCode || 200, cleanHeaders);
          upstreamRes.pipe(clientRes);
        }
      },
    );

    upstreamReq.on('error', () => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        clientRes.end(opts.targetKind === 'local' ? renderOfflineWaitingPage(opts.targetPort) : 'Upstream unreachable');
      } else {
        clientRes.end();
      }
    });

    clientReq.pipe(upstreamReq);
  });

  // Raw TCP WebSocket upgrade proxy for Vite HMR & Next.js Fast Refresh
  proxyServer.on('upgrade', async (req, clientSocket, head) => {
    if (opts.targetKind !== 'local') {
      clientSocket.destroy();
      return;
    }
    const probe = await probeLocalhostPort(opts.targetPort);
    if (!probe.reachable) {
      clientSocket.destroy();
      return;
    }
    const upstreamSocket = net.connect({ host: probe.host, port: opts.targetPort }, () => {
      const lines = [`${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion || '1.1'}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const v = req.rawHeaders[i + 1];
        const lower = k.toLowerCase();
        if (lower === 'host') {
          lines.push(`Host: localhost:${opts.targetPort}`);
        } else if (lower === 'origin') {
          lines.push(`Origin: http://localhost:${opts.targetPort}`);
        } else {
          lines.push(`${k}: ${v}`);
        }
      }
      lines.push('', '');
      upstreamSocket.write(lines.join('\r\n'));
      if (head && head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });

    upstreamSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstreamSocket.destroy());
  });

  const proxyPort = await new Promise<number>((resolve, reject) => {
    proxyServer.once('error', reject);
    proxyServer.listen(0, '0.0.0.0', () => {
      const addr = proxyServer.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind local preview proxy'));
    });
  });

  const created: PreviewEntry = {
    key,
    targetKind: opts.targetKind,
    targetPort: opts.targetPort,
    remoteOrigin: opts.remoteOrigin,
    proxyServer,
    proxyPort,
    tunnelProc: null,
    tunnelUrl: null,
    tunnelPromise: null,
    lastUsedAt: Date.now(),
  };
  entries.set(key, created);
  return created;
}

function ensureTunnelForEntry(entry: PreviewEntry): Promise<string | null> {
  if (entry.tunnelUrl && entry.tunnelProc && !entry.tunnelProc.killed) {
    return Promise.resolve(entry.tunnelUrl);
  }
  if (entry.tunnelPromise) {
    return entry.tunnelPromise;
  }

  entry.tunnelPromise = new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      entry.tunnelPromise = null;
      if (url) entry.tunnelUrl = url;
      resolve(url);
    };

    const timer = setTimeout(() => finish(null), 18_000);

    spawnCloudflaredQuickTunnel(`http://127.0.0.1:${entry.proxyPort}`, false)
      .then((child) => {
        entry.tunnelProc = child;

        const onData = (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (m) {
            clearTimeout(timer);
            finish(m[0]);
          }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('error', () => {
          clearTimeout(timer);
          entry.tunnelProc = null;
          entry.tunnelUrl = null;
          finish(null);
        });
        child.once('exit', () => {
          clearTimeout(timer);
          entry.tunnelProc = null;
          entry.tunnelUrl = null;
          finish(null);
        });
      })
      .catch(() => {
        clearTimeout(timer);
        finish(null);
      });
  });

  return entry.tunnelPromise;
}

export async function createPreviewSession(req: PreviewSessionRequest): Promise<PreviewSessionResult> {
  let normalizedUrl: string;
  let parsed: URL;
  try {
    normalizedUrl = normalizeWebStudioUrl(req.url);
    parsed = new URL(normalizedUrl);
  } catch (err) {
    return {
      ok: false,
      normalizedUrl: req.url,
      isLocalhost: false,
      localPort: null,
      reachable: false,
      previewUrl: req.url,
      lanUrl: null,
      tunnelUrl: null,
      mode: 'direct',
      error: err instanceof Error ? err.message : 'Invalid URL',
    };
  }

  const pathAndQuery = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
  const isLocal = isLocalTargetHost(parsed.hostname) || parsed.hostname === req.lanIp;

  if (isLocal) {
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        ok: false,
        normalizedUrl,
        isLocalhost: true,
        localPort: null,
        reachable: false,
        previewUrl: normalizedUrl,
        lanUrl: null,
        tunnelUrl: null,
        mode: 'direct',
        error: 'Invalid port number',
      };
    }
    if (port === req.bridgePort || BLOCKED_PORTS.has(port)) {
      return {
        ok: false,
        normalizedUrl,
        isLocalhost: true,
        localPort: port,
        reachable: false,
        previewUrl: normalizedUrl,
        lanUrl: null,
        tunnelUrl: null,
        mode: 'direct',
        error: `Port ${port} is reserved for system/bridge services`,
      };
    }

    const probe = await probeLocalhostPort(port);
    const entry = await createLocalProxyEntry(`local:${port}`, {
      targetKind: 'local',
      targetPort: port,
    });
    const lanUrl = `http://${req.lanIp}:${entry.proxyPort}${pathAndQuery}`;

    if (req.wantHttps !== false) {
      const tunnelBase = await ensureTunnelForEntry(entry);
      if (tunnelBase) {
        return {
          ok: true,
          normalizedUrl: `http://localhost:${port}${pathAndQuery}`,
          isLocalhost: true,
          localPort: port,
          reachable: probe.reachable,
          previewUrl: `${tunnelBase}${pathAndQuery}`,
          lanUrl,
          tunnelUrl: `${tunnelBase}${pathAndQuery}`,
          mode: 'https-tunnel',
        };
      }
    }

    return {
      ok: true,
      normalizedUrl: `http://localhost:${port}${pathAndQuery}`,
      isLocalhost: true,
      localPort: port,
      reachable: probe.reachable,
      previewUrl: lanUrl,
      lanUrl,
      tunnelUrl: null,
      mode: 'lan-proxy',
    };
  }

  // External public URL — if forceProxy is requested (e.g. site blocks iframes with X-Frame-Options), bridge it!
  if (req.forceProxy) {
    const entry = await createLocalProxyEntry(`remote:${parsed.origin}`, {
      targetKind: 'remote',
      targetPort: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
      remoteOrigin: parsed.origin,
    });
    const lanUrl = `http://${req.lanIp}:${entry.proxyPort}${pathAndQuery}`;
    if (req.wantHttps !== false) {
      const tunnelBase = await ensureTunnelForEntry(entry);
      if (tunnelBase) {
        return {
          ok: true,
          normalizedUrl,
          isLocalhost: false,
          localPort: null,
          reachable: true,
          previewUrl: `${tunnelBase}${pathAndQuery}`,
          lanUrl,
          tunnelUrl: `${tunnelBase}${pathAndQuery}`,
          mode: 'https-tunnel',
        };
      }
    }
    return {
      ok: true,
      normalizedUrl,
      isLocalhost: false,
      localPort: null,
      reachable: true,
      previewUrl: lanUrl,
      lanUrl,
      tunnelUrl: null,
      mode: 'lan-proxy',
    };
  }

  return {
    ok: true,
    normalizedUrl,
    isLocalhost: false,
    localPort: null,
    reachable: true,
    previewUrl: normalizedUrl,
    lanUrl: null,
    tunnelUrl: null,
    mode: 'direct',
  };
}

// Reap idle preview tunnels periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now - entry.lastUsedAt > IDLE_TTL_MS) {
      killChildProcessTree(entry.tunnelProc);
      entry.proxyServer.close();
      entries.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function closeAllLocalPreviews(): void {
  for (const [, entry] of entries) {
    killChildProcessTree(entry.tunnelProc);
    entry.proxyServer.close();
  }
  entries.clear();
}
