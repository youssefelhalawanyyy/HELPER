import {cursorLens} from '../services/cursorLens.js';
import {setMacVolume} from '../macos/hardware.js';
import { listBookmarks, saveBookmark, restoreBookmark, capturePage } from '../services/workspaceDesk.js';
import { chainStatus } from '../services/verifiedChain.js';
import { activityWindow, recentIncidents } from '../services/activityHistory.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import { IS_WIN } from '../platform/win32.js';
import { loadDoctorAiKey } from '../services/doctorAiAgent.js';
import { synthesizeNourSpeech } from '../services/devSuiteService.js';
import { applyReviewedFile } from '../services/fileReview.js';
import { createPreviewSession } from '../services/localPreviewService.js';
import { publicPushKey, subscribeDevice } from '../services/watchPush.js';
import { editSites, healthDays, watchList, checkWatched } from '../services/deskMonitor.js';
import { desktopSnapshot, formatPrompt, typeIntoHost } from '../services/missionTools.js';
import type { NetworkCommandService } from '../services/networkCommandService.js';
import type { NetworkFixAction } from '../types/protocol.js';
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
  restoreProject: (dir:string,url?:string)=>void;
  expectedToken: string;
  getProjectDir: () => string;
  lanIp: string;
  bridgePort: number;
  networkService?: NetworkCommandService;
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
  router.get('/chain/:id', (req,res)=>res.json({run:chainStatus(req.params.id) || null}));
  router.get('/cursor-lens',async(_req,res)=>{try{res.set('Cache-Control','no-store').json({image:await cursorLens()});}catch{res.status(503).json({error:'Screen capture unavailable. Check desktop screen recording access.'});}});
  router.post('/volume',async(req,res)=>{
    const value=req.body.value;
    if(!Number.isInteger(value)||value<0||value>100){res.status(400).json({error:'Choose a volume from 0 to 100'});return;}
    try{res.json({value:await setMacVolume(value)});}catch(e){res.status(500).json({error:(e as Error).message});}
  });
  router.get('/bookmarks', (_req,res)=>res.json(listBookmarks()));
  router.post('/bookmarks', async (req,res)=>{
    try { res.json(await saveBookmark(opts.getProjectDir(),req.body)); } catch(e){ res.status(400).json({error:(e as Error).message}); }
  });
  router.post('/bookmarks/restore', async (req,res)=>{
    try { const item=await restoreBookmark(req.body.id); opts.restoreProject(item.dir,item.pages[0]); res.json({ok:true}); } catch(e){ res.status(400).json({error:(e as Error).message}); }
  });
  router.post('/review/capture', async(req,res)=>{
    try {res.set('Cache-Control','no-store').json(await capturePage(req.body.url,req.body.width,req.body.height));}
    catch(e){res.status(400).json({error:(e as Error).message.slice(0,300)});}
  });
  router.get('/activity', (req, res) => {
    const center = Number(req.query.center) || undefined;
    const minutes = Math.min(60, Math.max(1, Number(req.query.minutes) || 10));
    res.set('Cache-Control', 'no-store').json({ ...activityWindow(center, minutes), incidents: recentIncidents() });
  });
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

  // --- NetOps Pro REST Endpoints (Scan, Speed, Fix & Diagnostic Probe) ---
  router.get('/netops/state', (_req, res) => {
    if (!opts.networkService) {
      res.status(503).json({ ok: false, error: 'NetOps service unavailable' });
      return;
    }
    res.json({ ok: true, state: opts.networkService.getLatest() });
  });

  router.post('/netops/scan', async (_req, res) => {
    if (!opts.networkService) {
      res.status(503).json({ ok: false, error: 'NetOps service unavailable' });
      return;
    }
    const state = await opts.networkService.scanNetwork();
    res.json({ ok: true, state });
  });

  router.post('/netops/speedtest', async (_req, res) => {
    if (!opts.networkService) {
      res.status(503).json({ ok: false, error: 'NetOps service unavailable' });
      return;
    }
    const state = await opts.networkService.runSpeedTest();
    res.json({ ok: true, state });
  });

  router.post('/netops/fix', async (req, res) => {
    if (!opts.networkService) {
      res.status(503).json({ ok: false, error: 'NetOps service unavailable' });
      return;
    }
    const action = req.body?.action as NetworkFixAction | undefined;
    if (!action) {
      res.status(400).json({ ok: false, error: 'Missing fix action' });
      return;
    }
    const message = await opts.networkService.runNetworkFix(action);
    res.json({ ok: true, message, state: opts.networkService.getLatest() });
  });

  router.post('/netops/probe', async (req, res) => {
    if (!opts.networkService) {
      res.status(503).json({ ok: false, error: 'NetOps service unavailable' });
      return;
    }
    const mode = req.body?.mode as 'ping' | 'dns' | 'ports' | undefined;
    const target = typeof req.body?.target === 'string' ? req.body.target : '';
    if (!mode || !['ping', 'dns', 'ports'].includes(mode)) {
      res.status(400).json({ ok: false, error: 'Invalid probe mode' });
      return;
    }
    try {
      const result = await opts.networkService.runProbe(mode, target);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Remote PowerShell / macOS Terminal Execution & AI Bridge Autopilot ---
  const execFileAsync = promisify(execFile);

  router.post('/host-shell', async (req, res) => {
    const rawCmd = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    const reqCwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim() : '';
    if (!rawCmd || rawCmd.length > 4000) {
      res.status(400).json({ ok: false, error: 'Enter a command (1–4000 characters)' });
      return;
    }

    const cwd = reqCwd && fs.existsSync(reqCwd) ? reqCwd : opts.getProjectDir() || os.homedir();
    const t0 = Date.now();
    const shellLabel = IS_WIN ? 'Windows PowerShell' : 'macOS Terminal (zsh)';

    try {
      if (IS_WIN) {
        const { stdout, stderr } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${rawCmd}`,
          ],
          {
            cwd,
            timeout: 45_000,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
          },
        );
        res.json({
          ok: true,
          stdout: (stdout || '').trimEnd(),
          stderr: (stderr || '').trimEnd(),
          exitCode: 0,
          durationMs: Date.now() - t0,
          cwd,
          platform: process.platform,
          shell: shellLabel,
        });
      } else {
        const { stdout, stderr } = await execFileAsync(
          '/bin/zsh',
          ['-lc', `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; cd "${cwd.replace(/"/g, '\\"')}" && ${rawCmd}`],
          {
            cwd,
            timeout: 45_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        res.json({
          ok: true,
          stdout: (stdout || '').trimEnd(),
          stderr: (stderr || '').trimEnd(),
          exitCode: 0,
          durationMs: Date.now() - t0,
          cwd,
          platform: process.platform,
          shell: shellLabel,
        });
      }
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string; code?: number | string };
      res.json({
        ok: true,
        stdout: (e.stdout || '').trimEnd(),
        stderr: (e.stderr || e.message || 'Command failed').trimEnd(),
        exitCode: typeof e.code === 'number' ? e.code : 1,
        durationMs: Date.now() - t0,
        cwd,
        platform: process.platform,
        shell: shellLabel,
      });
    }
  });

  router.post('/ai-shell', async (req, res) => {
    const promptText = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 800) : '';
    const targetOs: 'windows' | 'mac' =
      req.body?.targetOs === 'windows' || req.body?.targetOs === 'mac'
        ? req.body.targetOs
        : IS_WIN
          ? 'windows'
          : 'mac';
    const lastError = typeof req.body?.lastError === 'string' ? req.body.lastError.slice(0, 600) : '';

    if (!promptText) {
      res.status(400).json({ ok: false, error: 'Ask a question or describe the task' });
      return;
    }

    const apiKey = loadDoctorAiKey();
    if (apiKey) {
      const sysPrompt = `You are the DevDeck Bridge & Terminal AI Engineer for ${targetOs === 'windows' ? 'Windows 10/11 PowerShell' : 'macOS Terminal (zsh)'}.
Repository path: ${targetOs === 'windows' ? '$env:USERPROFILE\\HELPER' : '~/HELPER'}.
Bridge port: 4747.
Reply ONLY in valid JSON:
{
  "command": "exact single-line ${targetOs === 'windows' ? 'PowerShell' : 'zsh'} command ready to execute",
  "explanation": "1-2 sentences explaining what the command does and how it solves the request"
}
User request: ${promptText}${lastError ? `\nRecent terminal error: ${lastError}` : ''}`;

      for (const model of ['gemini-2.5-flash-lite', 'gemini-3-flash-preview']) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              signal: ctrl.signal,
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: sysPrompt }] }],
                generationConfig: {
                  temperature: 0.15,
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
            },
          );
          clearTimeout(timer);
          if (!r.ok) continue;
          const j = (await r.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const raw = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim()) as {
            command?: string;
            explanation?: string;
          };
          if (parsed.command) {
            res.json({
              ok: true,
              command: parsed.command,
              explanation: parsed.explanation || 'AI command generated for your terminal.',
              source: 'gemini',
            });
            return;
          }
        } catch {
          clearTimeout(timer);
        }
      }
    }

    // Built-in deterministic expert fallback when offline or before Gemini key is configured
    const q = `${promptText} ${lastError}`.toLowerCase();
    let command = '';
    let explanation = '';

    if (/executionpolicy|running scripts is disabled|npm\.ps1/i.test(q)) {
      command =
        targetOs === 'windows'
          ? 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force; & npm.cmd --version'
          : 'chmod +x ~/HELPER/start-mac.command && npm --version';
      explanation =
        'Unblocks PowerShell script execution for your user account and invokes npm.cmd directly.';
    } else if (/port 4747|eaddrinuse|already in use|kill|stuck/i.test(q)) {
      command =
        targetOs === 'windows'
          ? "Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Output 'Cleared port 4747'"
          : "lsof -ti tcp:4747 | xargs kill -9 2>/dev/null || true; echo 'Cleared port 4747'";
      explanation = 'Finds and terminates any stale process holding port 4747.';
    } else if (/firewall|allow|block|quic|tunnel/i.test(q)) {
      command =
        targetOs === 'windows'
          ? "New-NetFirewallRule -DisplayName 'DevDeck Bridge 4747' -Direction Inbound -LocalPort 4747 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue; Write-Output 'Firewall rule ensured for TCP 4747'"
          : 'curl -s http://127.0.0.1:4747/api/health';
      explanation = 'Ensures TCP port 4747 is allowed through the local firewall and verifies bridge health.';
    } else if (/update|pull|latest|upgrade|rebuild/i.test(q)) {
      command =
        targetOs === 'windows'
          ? 'Set-Location "$env:USERPROFILE\\HELPER"; git pull --ff-only; & npm.cmd install; & npm.cmd run build -w mac-bridge'
          : 'cd ~/HELPER && git pull --ff-only && npm install && npm run build -w mac-bridge';
      explanation = 'Pulls the latest code from GitHub, updates packages, and hot-reloads the running bridge.';
    } else {
      command =
        targetOs === 'windows'
          ? 'Invoke-RestMethod -Uri http://127.0.0.1:4747/api/health | ConvertTo-Json'
          : 'curl -s http://127.0.0.1:4747/api/health';
      explanation = 'Checks the live DevDeck Bridge health, platform, LAN IP, and active tunnel status.';
    }

    res.json({
      ok: true,
      command,
      explanation,
      source: 'builtin',
    });
  });

  return router;
}