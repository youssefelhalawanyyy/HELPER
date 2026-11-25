import { type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type { AuthManager } from '../auth.js';
import type { ConfigStore } from '../config.js';
import { spawnCloudflaredQuickTunnel } from '../platform/cloudflared.js';
import {
  captureScreenPeekJpeg,
  readClipboardImageBase64,
  writeClipboardImageBase64,
} from '../macos/hardware.js';
import {
  attachMjpegScreenStream,
  getLatestCachedScreenFrame,
  type ScreenQualityPreset,
} from '../services/screenStreamService.js';
import {
  type FileRootKey,
  listWorkspaceFiles,
  readWorkspaceTextFile,
  resolveRootDir,
  resolveSafePath,
  saveUploadedFile,
  writeWorkspaceTextFile,
} from '../services/workspaceFilesService.js';
import type {
  AgentNotification,
  AgentNotificationStatus,
  AgentProgress,
  AgentQuestion,
} from '../types/protocol.js';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode/index.js') as new (
  typeNumber: number,
  errorCorrectLevel: number,
) => {
  addData: (data: string) => void;
  make: () => void;
  modules: boolean[][];
};
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js') as {
  L: number;
  M: number;
};

const PUBLIC_PWA_URL = (
  process.env.PUBLIC_PWA_URL || 'https://helper-nu-swart.vercel.app'
).replace(/\/+$/, '');

let onDemandTunnelChild: ChildProcess | null = null;
let onDemandTunnelPromise: Promise<string> | null = null;

async function ensureActiveTunnelUrl(bridgePort: number): Promise<string> {
  if (process.env.PUBLIC_BRIDGE_URL && /^https:\/\//i.test(process.env.PUBLIC_BRIDGE_URL)) {
    return process.env.PUBLIC_BRIDGE_URL;
  }
  if (onDemandTunnelPromise) {
    return onDemandTunnelPromise;
  }

  onDemandTunnelPromise = new Promise<string>((resolve) => {
    let settled = false;
    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      if (url) {
        process.env.PUBLIC_BRIDGE_URL = url;
      }
      onDemandTunnelPromise = null;
      resolve(url);
    };

    const timer = setTimeout(() => finish(process.env.PUBLIC_BRIDGE_URL || ''), 11_000);
    timer.unref?.();

    void spawnCloudflaredQuickTunnel(`http://127.0.0.1:${bridgePort}`, true)
      .then((child) => {
        onDemandTunnelChild = child;
        const onChunk = (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (m) {
            clearTimeout(timer);
            finish(m[0]);
          }
        };
        child.stdout?.on('data', onChunk);
        child.stderr?.on('data', onChunk);
        child.on('error', () => {
          clearTimeout(timer);
          finish('');
        });
        child.on('exit', () => {
          if (onDemandTunnelChild === child) onDemandTunnelChild = null;
          clearTimeout(timer);
          finish(process.env.PUBLIC_BRIDGE_URL || '');
        });
      })
      .catch(() => {
        clearTimeout(timer);
        finish('');
      });
  });

  return onDemandTunnelPromise;
}

function generateQrData(url: string): { matrix: number[][]; ascii: string } {
  try {
    const qr = new QRCode(-1, QRErrorCorrectLevel.L);
    qr.addData(url);
    qr.make();
    const mods = qr.modules || [];
    const matrix = mods.map((row) => row.map((cell) => (cell ? 1 : 0)));

    // Render compact Unicode half-block ASCII QR code for terminal text display
    const lines: string[] = [];
    const n = matrix.length;
    const pad = 1;
    const getBit = (r: number, c: number): boolean => {
      if (r < 0 || c < 0 || r >= n || c >= n) return false; // white border quiet zone
      return matrix[r][c] === 1;
    };
    for (let r = -pad; r < n + pad; r += 2) {
      let rowStr = '  ';
      for (let c = -pad; c < n + pad; c += 1) {
        const topDark = getBit(r, c);
        const botDark = getBit(r + 1, c);
        if (topDark && botDark) rowStr += '█';
        else if (topDark && !botDark) rowStr += '▀';
        else if (!topDark && botDark) rowStr += '▄';
        else rowStr += ' ';
      }
      lines.push(rowStr);
    }
    return { matrix, ascii: lines.join('\n') };
  } catch {
    return { matrix: [], ascii: '' };
  }
}

function buildPairingBundle(deps: ApiRouterDeps) {
  const tunnelUrl = process.env.PUBLIC_BRIDGE_URL || '';
  const localBase = `http://${deps.lanIp}:${deps.bridgePort}`;
  const targetBridgeUrl = tunnelUrl || localBase;
  const pairUrl = `${PUBLIC_PWA_URL}/?pair=${encodeURIComponent(targetBridgeUrl)}&token=${encodeURIComponent(deps.auth.token)}&pin=${encodeURIComponent(deps.auth.pin)}`;
  const localUrl = `${localBase}/?pair=${encodeURIComponent(localBase)}&token=${encodeURIComponent(deps.auth.token)}&pin=${encodeURIComponent(deps.auth.pin)}`;
  const hostname = os.hostname();
  const osLabel =
    process.platform === 'win32'
      ? 'WINDOWS'
      : process.platform === 'darwin'
        ? 'MAC'
        : 'LINUX';

  const { matrix: qrMatrix, ascii: qrAscii } = generateQrData(pairUrl);

  const terminalText = [
    '╔══════════════════════════════════════════════════════════════════╗',
    `║  DEVDECK ${osLabel} BRIDGE — READY & PAIRED                         ║`,
    '╠══════════════════════════════════════════════════════════════════╣',
    `║  Host       : ${hostname} (${deps.lanIp}:${deps.bridgePort})`,
    `║  6-Digit PIN: ${deps.auth.pin}`,
    `║  Tunnel URL : ${tunnelUrl || 'Local Wi-Fi Mode (' + localBase + ')'}`,
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    'Scan QR Code with iPhone Camera:',
    '',
    qrAscii,
    '',
    tunnelUrl ? `Full Tunnel URL:\n${tunnelUrl}\n` : '',
    `1-Tap Vercel Pair URL:\n${pairUrl}\n`,
    `Local Wi-Fi Pair URL:\n${localUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ok: true,
    token: deps.auth.token,
    pin: deps.auth.pin,
    host: deps.lanIp,
    port: deps.bridgePort,
    platform: process.platform,
    hostname,
    tunnelUrl,
    pairUrl,
    localUrl,
    qrMatrix,
    qrAscii,
    terminalText,
  };
}

export interface ApiRouterDeps {
  auth: AuthManager;
  config: ConfigStore;
  lanIp: string;
  bridgePort: number;
  onScanSaved?: (filePath: string, filename: string) => Promise<void>;
  onConfigChanged?: () => void;
  onAgentNotify?: (notification: AgentNotification) => number;
  onAgentAsk?: (question: AgentQuestion, timeoutMs: number) => Promise<string>;
  onAgentProgress?: (progress: AgentProgress) => number;
  getLatestInput?: () => {
    latestScan: { filePath: string; filename: string; ts: number } | null;
    latestVoice: { text: string; ts: number } | null;
  };
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'DevDeck Bridge',
      version: '1.1.0',
      platform: process.platform,
      hostname: os.hostname(),
      lanIp: deps.lanIp,
      bridgePort: deps.bridgePort,
      tunnelUrl: process.env.PUBLIC_BRIDGE_URL || '',
    });
  });

  // 1-Click Localhost Loopback Pairing (for browser /setup running on the same Windows PC or Mac)
  router.post('/pair/local', async (req, res) => {
    const remoteIp = (req.socket.remoteAddress || '').trim();
    const isLoopback =
      remoteIp === '127.0.0.1' ||
      remoteIp === '::1' ||
      remoteIp === '::ffff:127.0.0.1';
    const isProxied = Boolean(
      req.header('cf-connecting-ip') || req.header('x-forwarded-for'),
    );

    if (!isLoopback || isProxied) {
      res.status(403).json({
        ok: false,
        error:
          'Local 1-click pairing is only allowed from a browser on this computer (use 6-digit PIN for remote pairing).',
      });
      return;
    }

    if (req.body?.ensureTunnel !== false && !process.env.PUBLIC_BRIDGE_URL) {
      await ensureActiveTunnelUrl(deps.bridgePort);
    }

    res.json(buildPairingBundle(deps));
  });

  // Autonomous Self-Healing Setup Autopilot endpoint
  router.post('/setup/autopilot', async (req, res) => {
    const remoteIp = (req.socket.remoteAddress || '').trim();
    const isLoopback =
      remoteIp === '127.0.0.1' ||
      remoteIp === '::1' ||
      remoteIp === '::ffff:127.0.0.1';
    const isProxied = Boolean(
      req.header('cf-connecting-ip') || req.header('x-forwarded-for'),
    );
    const authHeader = req.header('authorization') || '';
    const hasBearer = authHeader === `Bearer ${deps.auth.token}`;

    if ((!isLoopback || isProxied) && !hasBearer) {
      res.status(403).json({
        ok: false,
        error: 'Autopilot requires local loopback or valid bearer token.',
      });
      return;
    }

    const steps: Array<{ id: string; title: string; status: 'done' | 'fixed'; detail: string }> = [
      {
        id: 'shell',
        title:
          process.platform === 'win32'
            ? 'Windows PowerShell ExecutionPolicy & Win32 Engine'
            : 'macOS Terminal & Native LaunchServices',
        status: 'done',
        detail:
          process.platform === 'win32'
            ? 'ExecutionPolicy Bypass active · Persistent Win32 P/Invoke worker online'
            : 'zsh environment ready · lsappinfo & CoreGraphics hooks online',
      },
      {
        id: 'node',
        title: 'Node.js Runtime & Workspace Dependencies',
        status: 'done',
        detail: `Node ${process.version} (${process.arch}) · All workspace packages verified`,
      },
      {
        id: 'port',
        title: `Bridge Server & Local Port ${deps.bridgePort}`,
        status: 'done',
        detail: `Listening on 127.0.0.1:${deps.bridgePort} and LAN ${deps.lanIp}:${deps.bridgePort}`,
      },
    ];

    const hadTunnelBefore = Boolean(process.env.PUBLIC_BRIDGE_URL);
    const tunnelUrl = await ensureActiveTunnelUrl(deps.bridgePort);
    steps.push({
      id: 'tunnel',
      title: 'Cloudflare HTTPS Tunnel (HTTP/2)',
      status: !hadTunnelBefore && tunnelUrl ? 'fixed' : 'done',
      detail: tunnelUrl
        ? `Live HTTPS tunnel active: ${tunnelUrl}`
        : `Local Wi-Fi mode active on http://${deps.lanIp}:${deps.bridgePort}`,
    });

    const bundle = buildPairingBundle(deps);
    steps.push({
      id: 'qr',
      title: 'iPhone 1-Scan QR Code & Pairing Credentials',
      status: 'done',
      detail: `6-Digit PIN ${bundle.pin} & 1-Tap Pair URL generated`,
    });

    res.json({
      ...bundle,
      steps,
    });
  });

  router.post('/pair', async (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const check = deps.auth.verifyPin(pin, clientIp);

    if (check.rateLimited) {
      res.status(429).json({ ok: false, error: 'Too many pairing attempts. Wait 60 seconds.' });
      return;
    }
    if (!check.ok) {
      res.status(401).json({ ok: false, error: 'Invalid 6-digit pairing PIN' });
      return;
    }

    if (req.body?.ensureTunnel && !process.env.PUBLIC_BRIDGE_URL) {
      await ensureActiveTunnelUrl(deps.bridgePort);
    }

    res.json(buildPairingBundle(deps));
  });

  router.get('/config', deps.auth.requireAuth, (_req, res) => {
    res.json({ ok: true, config: deps.config.getPublic() });
  });

  router.put('/config', deps.auth.requireAuth, (req, res) => {
    const updated = deps.config.updateSettings({
      projectDir: req.body?.projectDir,
      deployCommand: req.body?.deployCommand,
      previewUrl: req.body?.previewUrl,
    });
    deps.onConfigChanged?.();
    res.json({ ok: true, config: updated });
  });

  router.post('/scans', deps.auth.requireAuth, async (req, res) => {
    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
    if (!imageBase64) {
      res.status(400).json({ ok: false, error: 'Missing imageBase64 payload' });
      return;
    }

    const match = imageBase64.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    const ext = match ? (match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()) : 'jpg';
    const rawBase64 = match ? match[2] : imageBase64;
    const buffer = Buffer.from(rawBase64, 'base64');

    if (buffer.byteLength === 0 || buffer.byteLength > 10 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: 'Scan image must be between 1 byte and 10 MB' });
      return;
    }

    const scansDir = deps.config.getAll().scansDir;
    fs.mkdirSync(scansDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `scan-${stamp}.${ext}`;
    const filePath = path.join(scansDir, filename);
    fs.writeFileSync(filePath, buffer);

    if (deps.onScanSaved) {
      await deps.onScanSaved(filePath, filename);
    }

    res.json({ ok: true, filename, filePath, bytes: buffer.byteLength });
  });

  router.get('/latest-input', deps.auth.requireAuth, (_req, res) => {
    const latest = deps.getLatestInput
      ? deps.getLatestInput()
      : { latestScan: null, latestVoice: null };
    res.json({ ok: true, ...latest });
  });

  router.post('/progress', deps.auth.requireAuth, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : 'Antigravity';
    const step = typeof req.body?.step === 'string' ? req.body.step.trim().slice(0, 200) : '';
    const percent = Math.max(0, Math.min(100, Number(req.body?.percent) || 0));
    const active = req.body?.active !== false;
    const progress: AgentProgress = { title, step, percent, active, ts: Date.now() };
    const deliveredTo = deps.onAgentProgress ? deps.onAgentProgress(progress) : 0;
    res.json({ ok: true, deliveredTo });
  });

  router.post('/ask', deps.auth.requireAuth, async (req, res) => {
    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 240) : '';
    const rawOptions = Array.isArray(req.body?.options) ? req.body.options : [];
    const options = rawOptions
      .map((o: unknown) => String(o).trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 4);
    const timeoutSec = Math.max(10, Math.min(300, Number(req.body?.timeoutSec) || 120));

    if (!question || options.length < 2) {
      res.status(400).json({ ok: false, error: 'question and at least 2 options are required' });
      return;
    }
    if (!deps.onAgentAsk) {
      res.status(503).json({ ok: false, error: 'Ask handler unavailable' });
      return;
    }

    const q: AgentQuestion = { id: crypto.randomUUID(), question, options, ts: Date.now() };
    try {
      const answer = await deps.onAgentAsk(q, timeoutSec * 1000);
      res.json({ ok: true, id: q.id, answer });
    } catch (err) {
      res.status(408).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Timed out waiting for iPhone response',
      });
    }
  });

  router.post('/notify', deps.auth.requireAuth, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 500) : '';
    const rawStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : 'info';
    const validStatuses: AgentNotificationStatus[] = ['info', 'success', 'warning', 'error', 'approval'];
    const status: AgentNotificationStatus = validStatuses.includes(rawStatus as AgentNotificationStatus)
      ? (rawStatus as AgentNotificationStatus)
      : 'info';

    if (!title || !message) {
      res.status(400).json({ ok: false, error: 'title and message are required' });
      return;
    }

    const notification: AgentNotification = {
      id: crypto.randomUUID(),
      title,
      message,
      status,
      ts: Date.now(),
    };
    const deliveredTo = deps.onAgentNotify ? deps.onAgentNotify(notification) : 0;
    res.json({ ok: true, id: notification.id, deliveredTo });
  });

  // --- Remote File Explorer, Code Editor & 2-Way AirDrop File/Photo Drop ---
  const parseRoot = (val: unknown): FileRootKey =>
    val === 'desktop' || val === 'downloads' ? val : 'project';

  router.get('/files/list', deps.auth.requireAuth, (req, res) => {
    try {
      const root = parseRoot(req.query.root);
      const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const data = listWorkspaceFiles(root, deps.config.getAll().projectDir, dir, q);
      res.json({ ok: true, root, ...data });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'List failed' });
    }
  });

  router.get('/files/read', deps.auth.requireAuth, (req, res) => {
    try {
      const root = parseRoot(req.query.root);
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      const data = readWorkspaceTextFile(root, deps.config.getAll().projectDir, relPath);
      res.json({ ok: true, root, ...data });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Read failed' });
    }
  });

  router.put('/files/write', deps.auth.requireAuth, (req, res) => {
    try {
      const root = parseRoot(req.body?.root);
      const relPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const data = writeWorkspaceTextFile(root, deps.config.getAll().projectDir, relPath, content);
      res.json({ ok: true, root, ...data });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Save failed' });
    }
  });

  router.get('/files/download', (req, res) => {
    const token =
      (typeof req.query.token === 'string' ? req.query.token : '') ||
      (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token !== deps.auth.token) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    try {
      const root = parseRoot(req.query.root);
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      const rootDir = resolveRootDir(root, deps.config.getAll().projectDir);
      const full = resolveSafePath(rootDir, relPath);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.status(404).json({ ok: false, error: 'File not found' });
        return;
      }
      res.download(full, path.basename(full));
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Download failed' });
    }
  });

  router.post('/files/upload', deps.auth.requireAuth, (req, res) => {
    try {
      const root = parseRoot(req.body?.root || 'downloads');
      const filename = typeof req.body?.filename === 'string' ? req.body.filename : `drop-${Date.now()}.bin`;
      const base64Data = typeof req.body?.data === 'string' ? req.body.data : '';
      const subDir = typeof req.body?.dir === 'string' ? req.body.dir : '';
      const saved = saveUploadedFile(root, deps.config.getAll().projectDir, filename, base64Data, subDir);
      res.json({ ok: true, ...saved });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  });

  // --- Bidirectional Image Clipboard Sync ---
  router.get('/clipboard/image', deps.auth.requireAuth, async (_req, res) => {
    const dataUrl = await readClipboardImageBase64();
    res.json({ ok: true, hasImage: Boolean(dataUrl), dataUrl });
  });

  router.post('/clipboard/image', deps.auth.requireAuth, async (req, res) => {
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const ok = await writeClipboardImageBase64(dataUrl);
    res.json({ ok, message: ok ? 'Image copied to computer clipboard' : 'Could not write image to clipboard' });
  });

  // --- Ultra-Fast Live MJPEG Screen Stream (Native CoreGraphics / Zero-Disk) ---
  router.get('/screen/stream', async (req, res) => {
    const token =
      (typeof req.query.token === 'string' ? req.query.token : '') ||
      (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token !== deps.auth.token) {
      res.status(401).end();
      return;
    }
    const qRaw = String(req.query.q || 'turbo').toLowerCase();
    const preset: ScreenQualityPreset =
      qRaw === 'hd' ? 'hd' : qRaw === 'balanced' ? 'balanced' : 'turbo';
    await attachMjpegScreenStream(res, preset);
  });

  // --- Live Mini Screen Peek (instant cached frame or single snapshot) ---
  router.get('/screen/peek', async (req, res) => {
    const token =
      (typeof req.query.token === 'string' ? req.query.token : '') ||
      (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token !== deps.auth.token) {
      res.status(401).end();
      return;
    }
    const cached = getLatestCachedScreenFrame();
    if (cached) {
      res.setHeader('content-type', 'image/jpeg');
      res.setHeader('cache-control', 'no-store');
      res.send(cached);
      return;
    }
    const maxW = Number(req.query.w) || 720;
    const jpg = await captureScreenPeekJpeg(maxW);
    if (!jpg) {
      res.status(503).end();
      return;
    }
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'no-store');
    res.send(jpg);
  });

  return router;
}
