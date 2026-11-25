import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type { AuthManager } from '../auth.js';
import type { ConfigStore } from '../config.js';
import type {
  AgentNotification,
  AgentNotificationStatus,
  AgentProgress,
  AgentQuestion,
} from '../types/protocol.js';

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
  router.post('/pair/local', (req, res) => {
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
        error: 'Local 1-click pairing is only allowed from a browser on this computer (use 6-digit PIN for remote pairing).',
      });
      return;
    }

    res.json({
      ok: true,
      token: deps.auth.token,
      pin: deps.auth.pin,
      host: deps.lanIp,
      port: deps.bridgePort,
      platform: process.platform,
      hostname: os.hostname(),
      tunnelUrl: process.env.PUBLIC_BRIDGE_URL || '',
    });
  });

  router.post('/pair', (req, res) => {
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

    res.json({
      ok: true,
      token: deps.auth.token,
      host: deps.lanIp,
      port: deps.bridgePort,
      platform: process.platform,
      hostname: os.hostname(),
      tunnelUrl: process.env.PUBLIC_BRIDGE_URL || '',
    });
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

  return router;
}
