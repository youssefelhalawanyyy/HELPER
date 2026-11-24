import { Router } from 'express';
import {
  checkSiteMonitor,
  getHostingOverview,
  getSshStats,
  inspectWebsite,
  runApiRequest,
  runSshCommand,
  runSshServiceAction,
  type ApiProxyRequest,
  type SshConnectionInput,
} from '../services/devSuiteService.js';

export function createDevSuiteRouter(opts: {
  expectedToken: string;
  getProjectDir: () => string;
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

  return router;
}
