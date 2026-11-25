import { loadDoctorAiKey } from '../services/doctorAiAgent.js';
import { synthesizeNourSpeech } from '../services/devSuiteService.js';
import { applyReviewedFile } from '../services/fileReview.js';
import { createPreviewSession } from '../services/localPreviewService.js';
import { publicPushKey, subscribeDevice } from '../services/watchPush.js';
import { editSites, healthDays, watchList, checkWatched } from '../services/deskMonitor.js';
import { desktopSnapshot, formatPrompt, typeIntoHost } from '../services/missionTools.js';
import { Router } from 'express';
import {
  chatWithNour,
  checkSiteMonitor,
  getHostingOverview,
  getSshStats,
  inspectWebsite,
  runApiRequest,
  runSshCommand,
  runSshServiceAction,
  type ApiProxyRequest,
  type NourChatMessage,
  type SshConnectionInput,
} from '../services/devSuiteService.js';

export function createDevSuiteRouter(opts: {
  expectedToken: string;
  getProjectDir: () => string;
  lanIp: string;
  bridgePort: number;
}): Router {
  const router = Router();

  // Require Bearer token (same auth model as /api/scans)
  router.use((req, res, next) => {
    const authHeader = req.header('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== opts.expectedToken) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    next();
  });

  router.post('/api-request', async (req, res) => {
    const body = req.body as ApiProxyRequest;
    if (!body?.url) {
      res.status(400).json({ ok: false, error: 'Missing url' });
      return;
    }
    const result = await runApiRequest(body);
    res.json(result);
  });

  router.post('/inspect', async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ ok: false, error: 'Missing url' });
      return;
    }
    const result = await inspectWebsite(url);
    res.json(result);
  });

  router.post('/preview-session', async (req, res) => {
    const { url, wantHttps, forceProxy } = req.body as {
      url?: string;
      wantHttps?: boolean;
      forceProxy?: boolean;
    };
    if (!url?.trim()) {
      res.status(400).json({ ok: false, error: 'Missing url' });
      return;
    }
    const session = await createPreviewSession({
      url: url.trim(),
      lanIp: opts.lanIp,
      bridgePort: opts.bridgePort,
      wantHttps,
      forceProxy,
    });
    res.json(session);
  });

  router.post('/monitor', async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ ok: false, error: 'Missing url' });
      return;
    }
    const result = await checkSiteMonitor(url);
    res.json(result);
  });

  router.get('/hosting', async (_req, res) => {
    const result = await getHostingOverview(opts.getProjectDir());
    res.json(result);
  });

  router.post('/ssh/exec', async (req, res) => {
    const { conn, command } = req.body as { conn?: SshConnectionInput; command?: string };
    if (!conn?.host || !conn?.username || !command) {
      res.status(400).json({ ok: false, error: 'Missing SSH host, username, or command' });
      return;
    }
    const result = await runSshCommand(conn, command);
    res.json(result);
  });

  router.post('/ssh/stats', async (req, res) => {
    const { conn } = req.body as { conn?: SshConnectionInput };
    if (!conn?.host || !conn?.username) {
      res.status(400).json({ ok: false, error: 'Missing SSH host or username' });
      return;
    }
    const result = await getSshStats(conn);
    res.json(result);
  });

  router.post('/ssh/service', async (req, res) => {
    const { conn, kind, target, action } = req.body as {
      conn?: SshConnectionInput;
      kind?: 'docker' | 'systemd';
      target?: string;
      action?: 'restart' | 'stop' | 'start';
    };
    if (!conn?.host || !conn?.username || !kind || !target || !action) {
      res.status(400).json({ ok: false, error: 'Missing required SSH service fields' });
      return;
    }
    const result = await runSshServiceAction(conn, kind, target, action);
    res.json(result);
  });

  router.post('/nour/speak', async (req, res) => {
    const text = req.body.text;
    if (typeof text !== 'string' || !text || text.length > 160) {
      res.status(400).json({ error: 'Invalid announcement' });
      return;
    }
    const key = loadDoctorAiKey();
    try {
      res.json(key ? (await synthesizeNourSpeech(text, key)) || {} : {});
    } catch {
      res.json({});
    }
  });
  router.post('/nour/chat', async (req, res) => {
    const { message, history, botName, voiceName, liveContext } = req.body as {
      message?: string;
      history?: NourChatMessage[];
      botName?: string;
      voiceName?: string;
      liveContext?: string;
    };
    if (!message?.trim()) {
      res.status(400).json({ ok: false, error: 'Missing message' });
      return;
    }
    const result = await chatWithNour({
      message: message.trim(),
      history,
      botName,
      voiceName,
      liveContext,
    });
    res.json(result);
  });

  router.get('/push-key', (_req, res) => res.json({ key: publicPushKey() }));
  router.post('/push-subscription', (req, res) => {
    try {
      subscribeDevice(req.body.subscription, req.body.remove === true);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  router.get('/watch', (_req, res) => res.json(watchList()));
  router.get('/health-history', (_req, res) => res.json(healthDays));
  router.post('/watch', async (req, res) => {
    try {
      if (req.body.action === 'check') await checkWatched();
      else editSites(req.body.action, req.body.urls);
      res.json(watchList());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  router.post('/review-file', async (req, res) => {
    try {
      await applyReviewedFile(opts.getProjectDir(), req.body.file, req.body.revision, req.body.action);
      res.json({ ok: true });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });
  router.post('/snapshot', async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await desktopSnapshot());
    } catch {
      res.status(503).json({ error: 'Capture unavailable. Check desktop Screen Recording permission.' });
    }
  });
  router.post('/format-prompt', async (req, res) => {
    try {
      res.json(await formatPrompt(req.body.text));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  router.post('/type', async (req, res) => {
    try {
      await typeIntoHost(req.body.text);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  return router;
}