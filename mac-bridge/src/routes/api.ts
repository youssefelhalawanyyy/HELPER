import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AuthManager } from '../auth.js';
import type { ConfigStore } from '../config.js';
import type { AgentNotification, AgentNotificationStatus } from '../types/protocol.js';

export interface ApiRouterDeps {
  auth: AuthManager;
  config: ConfigStore;
  lanIp: string;
  bridgePort: number;
  onScanSaved?: (filePath: string) => Promise<void>;
  onConfigChanged?: () => void;
  onAgentNotify?: (notification: AgentNotification) => number;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'DevDeck Bridge',
      version: '1.0.0',
      lanIp: deps.lanIp,
      bridgePort: deps.bridgePort,
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
      await deps.onScanSaved(filePath);
    }

    res.json({ ok: true, filename, filePath, bytes: buffer.byteLength });
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
