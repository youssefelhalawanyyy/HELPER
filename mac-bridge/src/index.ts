import http from 'node:http';
import os from 'node:os';
import { URL } from 'node:url';
import cors from 'cors';
import express from 'express';
import qrcode from 'qrcode-terminal';
import { WebSocket, WebSocketServer } from 'ws';
import { AuthManager, getLocalLanIp } from './auth.js';
import { ConfigStore } from './config.js';
import { ActiveAppPoller } from './macos/activeApp.js';
import {
  ClipboardTracker,
  copyToMacClipboard,
  expandSnippetTokens,
  triggerMacPaste,
} from './macos/clipboard.js';
import {
  adjustMacBrightness,
  getMacVolumeState,
  lockMacScreen,
  scrollMacVertical,
  setMacMute,
  setMacVolume,
} from './macos/hardware.js';
import { controlMacMedia, getMediaState } from './macos/media.js';
import { isKnownShortcut, runShortcut } from './macos/shortcuts.js';
import { sendToActiveMacTerminal } from './macos/terminal.js';
import { createApiRouter } from './routes/api.js';
import { createWebhookRouter, WebhookStore } from './routes/webhook.js';
import { FocusService } from './services/focusService.js';
import { GitService } from './services/gitService.js';
import { LogStreamer, runConfiguredShellCommand } from './services/logStreamer.js';
import { PortService } from './services/portService.js';
import { StatsService } from './services/statsService.js';
import type { ClientEvent, ServerEvent } from './types/protocol.js';

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4747);
const PWA_PORT = Number(process.env.PWA_PORT || 3000);
const PUBLIC_PWA_URL = (process.env.PUBLIC_PWA_URL || 'https://helper-nu-swart.vercel.app').replace(/\/+$/, '');
const PUBLIC_BRIDGE_URL = (process.env.PUBLIC_BRIDGE_URL || '').replace(/\/+$/, '');

const configStore = new ConfigStore();
const auth = new AuthManager(configStore.getToken());
const lanIp = getLocalLanIp();

const app = express();
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));
app.use(express.text({ limit: '2mb' }));

const clients = new Set<WebSocket>();

function sendTo(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcast(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// --- Core Services ---
const statsService = new StatsService((stats) => {
  broadcast({ type: 'stats:update', payload: stats });
});

const activeAppPoller = new ActiveAppPoller(
  () => configStore.getPublic().profiles,
  (appName, profileId) => {
    broadcast({ type: 'app:active', payload: { appName, profileId, ts: Date.now() } });
  },
);

const portService = new PortService((ports) => {
  broadcast({ type: 'ports:update', payload: { ports } });
});

const logStreamer = new LogStreamer(
  (line) => broadcast({ type: 'logs:line', payload: line }),
  (status) => broadcast({ type: 'logs:status', payload: status }),
  (kind, message) => broadcast({ type: 'alert:flash', payload: { kind, message } }),
);

const gitService = new GitService(
  () => configStore.getAll().projectDir,
  () => configStore.getAll().deployCommand,
  (status) => broadcast({ type: 'git:status', payload: status }),
);

const clipboardTracker = new ClipboardTracker((current, history) => {
  broadcast({ type: 'clipboard:update', payload: { current, history } });
});

const focusService = new FocusService(
  (state) => broadcast({ type: 'focus:state', payload: state }),
  (message) => broadcast({ type: 'alert:flash', payload: { kind: 'success', message } }),
);

const webhookStore = new WebhookStore((ev) => {
  broadcast({ type: 'webhook:event', payload: ev });
});

// Start background pollers
statsService.start(2000);
activeAppPoller.start(1500);
portService.start(3500);
gitService.start(5000);
clipboardTracker.start(1500);

// --- Express Routes ---
app.use(
  '/api',
  createApiRouter({
    auth,
    config: configStore,
    lanIp,
    bridgePort: BRIDGE_PORT,
    onScanSaved: async (filePath) => {
      await copyToMacClipboard(filePath);
      clipboardTracker.record(filePath);
      broadcast({
        type: 'alert:flash',
        payload: { kind: 'success', message: `Scan saved & path copied: ${filePath}` },
      });
    },
    onConfigChanged: () => {
      broadcast({ type: 'config:sync', payload: configStore.getPublic() });
      void gitService.refresh();
    },
    onAgentNotify: (notification) => {
      broadcast({ type: 'agent:notification', payload: notification });
      const flashKind =
        notification.status === 'error'
          ? 'error'
          : notification.status === 'warning' || notification.status === 'approval'
            ? 'warning'
            : 'success';
      broadcast({
        type: 'alert:flash',
        payload: { kind: flashKind, message: `${notification.title}: ${notification.message.slice(0, 64)}` },
      });
      return clients.size;
    },
  }),
);

app.use('/hook', createWebhookRouter(webhookStore));

// --- Client Event Dispatcher ---
async function handleClientEvent(ws: WebSocket, msg: ClientEvent): Promise<void> {
  const reply = (requestId: string, ok: boolean, message: string, data?: unknown) => {
    sendTo(ws, { type: 'action:result', payload: { requestId, ok, message, data } });
  };

  switch (msg.type) {
    case 'macro:execute': {
      const { requestId, macroId } = msg.payload;
      const macro = configStore.getAll().macros.find((m) => m.id === macroId);
      if (!macro) {
        reply(requestId, false, `Macro "${macroId}" not found`);
        return;
      }

      try {
        if (macro.actionType === 'shortcut') {
          if (!isKnownShortcut(macro.payload)) {
            reply(requestId, false, `Shortcut "${macro.payload}" is not whitelisted`);
            return;
          }
          const resultMsg = await runShortcut(macro.payload);
          reply(requestId, true, resultMsg);
          if (macro.payload === 'system.toggleMute') {
            broadcast({ type: 'media:state', payload: await getMediaState() });
          }
        } else if (macro.actionType === 'shell') {
          const res = await runConfiguredShellCommand(macro.payload, configStore.getAll().projectDir);
          reply(requestId, res.ok, res.output);
          broadcast({
            type: 'alert:flash',
            payload: { kind: res.ok ? 'success' : 'error', message: `${macro.label}: ${res.output.slice(0, 70)}` },
          });
        } else if (macro.actionType === 'terminal') {
          const resultMsg = await sendToActiveMacTerminal(macro.payload);
          reply(requestId, true, resultMsg);
        } else if (macro.actionType === 'stream') {
          const preset = configStore.getAll().logPresets.find((p) => p.id === macro.payload);
          if (!preset) {
            reply(requestId, false, `Log preset "${macro.payload}" not found`);
            return;
          }
          logStreamer.startPreset(preset, configStore.getAll().projectDir);
          reply(requestId, true, `Streaming ${preset.label} in Live Monitor`);
        } else if (macro.actionType === 'snippet') {
          const expanded = expandSnippetTokens(macro.payload);
          await copyToMacClipboard(expanded);
          clipboardTracker.record(expanded);
          try {
            await triggerMacPaste();
          } catch {
            // Accessibility permission optional
          }
          reply(requestId, true, `Injected ${macro.label}`);
        }
      } catch (err) {
        reply(requestId, false, err instanceof Error ? err.message : 'Macro execution failed');
      }
      return;
    }

    case 'macro:upsert': {
      const { requestId, macro } = msg.payload;
      if (!macro.id || !macro.label) {
        reply(requestId, false, 'Macro requires id and label');
        return;
      }
      configStore.upsertMacro(macro);
      broadcast({ type: 'config:sync', payload: configStore.getPublic() });
      reply(requestId, true, `Saved macro "${macro.label}"`);
      return;
    }

    case 'macro:delete': {
      const { requestId, macroId } = msg.payload;
      const deleted = configStore.deleteMacro(macroId);
      broadcast({ type: 'config:sync', payload: configStore.getPublic() });
      reply(requestId, deleted, deleted ? 'Macro deleted' : 'Macro not found');
      return;
    }

    case 'snippet:inject': {
      const { requestId, text, autoPaste } = msg.payload;
      try {
        const expanded = expandSnippetTokens(text);
        await copyToMacClipboard(expanded);
        clipboardTracker.record(expanded);
        if (autoPaste) {
          try {
            await triggerMacPaste();
          } catch {
            reply(requestId, true, 'Copied to Mac clipboard (enable Accessibility for auto-paste)');
            return;
          }
        }
        reply(requestId, true, autoPaste ? 'Pasted on Mac' : 'Copied to Mac clipboard');
      } catch (err) {
        reply(requestId, false, err instanceof Error ? err.message : 'Clipboard failed');
      }
      return;
    }

    case 'snippet:upsert': {
      const { requestId, snippet } = msg.payload;
      configStore.upsertSnippet(snippet);
      broadcast({ type: 'config:sync', payload: configStore.getPublic() });
      reply(requestId, true, `Saved snippet "${snippet.label}"`);
      return;
    }

    case 'snippet:delete': {
      const { requestId, snippetId } = msg.payload;
      const deleted = configStore.deleteSnippet(snippetId);
      broadcast({ type: 'config:sync', payload: configStore.getPublic() });
      reply(requestId, deleted, deleted ? 'Snippet deleted' : 'Snippet not found');
      return;
    }

    case 'ports:refresh': {
      const ports = await portService.scan();
      reply(msg.payload.requestId, true, `Found ${ports.length} active dev ports`);
      return;
    }

    case 'port:kill': {
      const { requestId, pid, port } = msg.payload;
      const res = await portService.killPort(pid, port);
      reply(requestId, res.ok, res.message);
      if (res.ok) {
        broadcast({ type: 'alert:flash', payload: { kind: 'warning', message: res.message } });
      }
      return;
    }

    case 'logs:start': {
      const { requestId, presetId } = msg.payload;
      const preset = configStore.getAll().logPresets.find((p) => p.id === presetId);
      if (!preset) {
        reply(requestId, false, 'Log preset not found');
        return;
      }
      logStreamer.startPreset(preset, configStore.getAll().projectDir);
      reply(requestId, true, `Streaming ${preset.label}`);
      return;
    }

    case 'logs:stop': {
      logStreamer.stop();
      reply(msg.payload.requestId, true, 'Stopped log stream');
      return;
    }

    case 'git:refresh': {
      await gitService.refresh();
      reply(msg.payload.requestId, true, 'Git status refreshed');
      return;
    }

    case 'git:deploy': {
      const { requestId, action } = msg.payload;
      const res = await gitService.deploy(action);
      reply(requestId, res.ok, res.message);
      broadcast({
        type: 'alert:flash',
        payload: { kind: res.ok ? 'success' : 'error', message: res.message.slice(0, 80) },
      });
      return;
    }

    case 'webhook:replay': {
      const { requestId, eventId, targetBaseUrl } = msg.payload;
      const base = targetBaseUrl || `http://127.0.0.1:${BRIDGE_PORT}`;
      const res = await webhookStore.replay(eventId, base);
      reply(requestId, res.ok, res.message);
      return;
    }

    case 'webhook:copy': {
      const { requestId, eventId } = msg.payload;
      const ev = webhookStore.getById(eventId);
      if (!ev) {
        reply(requestId, false, 'Webhook event not found');
        return;
      }
      const formatted = JSON.stringify(ev.body ?? { path: ev.path, query: ev.query }, null, 2);
      await copyToMacClipboard(formatted);
      clipboardTracker.record(formatted);
      reply(requestId, true, 'Webhook JSON copied to Mac clipboard');
      return;
    }

    case 'hardware:dial': {
      const { mode, delta, value } = msg.payload;
      try {
        if (mode === 'volume') {
          let nextVol: number;
          if (typeof value === 'number') {
            nextVol = await setMacVolume(value);
          } else {
            const current = await getMacVolumeState();
            nextVol = await setMacVolume(current.volume + delta);
          }
          broadcast({ type: 'media:state', payload: { ...(await getMediaState()), volume: nextVol } });
        } else if (mode === 'brightness') {
          const nextBright = await adjustMacBrightness(delta > 0 ? 1 : -1);
          broadcast({
            type: 'media:state',
            payload: { ...(await getMediaState()), brightness: nextBright },
          });
        } else if (mode === 'scroll') {
          await scrollMacVertical(delta);
        }
      } catch {
        // Ignore transient AppleScript errors during rapid dial ticks
      }
      return;
    }

    case 'hardware:mute': {
      const { requestId, muted } = msg.payload;
      await setMacMute(muted);
      broadcast({ type: 'media:state', payload: await getMediaState() });
      reply(requestId, true, muted ? 'Mac muted' : 'Mac unmuted');
      return;
    }

    case 'hardware:lock': {
      await lockMacScreen();
      reply(msg.payload.requestId, true, 'Mac screen locked');
      return;
    }

    case 'voice:transcript': {
      const { requestId, text, autoPaste } = msg.payload;
      if (!text.trim()) {
        reply(requestId, false, 'Empty transcript');
        return;
      }
      await copyToMacClipboard(text);
      clipboardTracker.record(text);
      if (autoPaste) {
        try {
          await triggerMacPaste();
        } catch {
          reply(requestId, true, 'Transcript copied (enable Accessibility for auto-paste)');
          return;
        }
      }
      reply(requestId, true, autoPaste ? 'Voice prompt pasted on Mac' : 'Voice prompt copied to Mac');
      return;
    }

    case 'focus:start': {
      const note = await focusService.start(msg.payload.durationMin);
      reply(msg.payload.requestId, true, note);
      return;
    }

    case 'focus:stop': {
      const note = await focusService.stop(false);
      reply(msg.payload.requestId, true, note);
      return;
    }

    case 'clipboard:copy': {
      const { requestId, text, autoPaste } = msg.payload;
      await copyToMacClipboard(text);
      clipboardTracker.record(text);
      if (autoPaste) {
        try {
          await triggerMacPaste();
        } catch {
          // Optional
        }
      }
      reply(requestId, true, 'Copied to Mac clipboard');
      return;
    }

    case 'media:control': {
      const { requestId, action } = msg.payload;
      const result = await controlMacMedia(action);
      broadcast({ type: 'media:state', payload: await getMediaState() });
      reply(requestId, true, result);
      return;
    }

    case 'preview:set': {
      const { requestId, url } = msg.payload;
      if (!/^https?:\/\//i.test(url.trim())) {
        reply(requestId, false, 'Preview URL must start with http:// or https://');
        return;
      }
      configStore.updateSettings({ previewUrl: url.trim() });
      broadcast({ type: 'preview:url', payload: { url: url.trim(), label: 'Synced Preview' } });
      reply(requestId, true, 'Preview URL synced');
      return;
    }
  }
}

// --- HTTP & WebSocket Server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const token = parsedUrl.searchParams.get('token');

  if (!auth.verifyToken(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  clients.add(ws);

  // Hydrate newly connected iPhone immediately
  sendTo(ws, {
    type: 'hello',
    payload: {
      hostname: os.hostname(),
      lanIp,
      bridgePort: BRIDGE_PORT,
      pwaPort: PWA_PORT,
      projectDir: configStore.getAll().projectDir,
      version: '1.0.0',
    },
  });
  sendTo(ws, { type: 'config:sync', payload: configStore.getPublic() });
  sendTo(ws, { type: 'stats:update', payload: statsService.getLatest() });
  const activeApp = activeAppPoller.getCurrent();
  sendTo(ws, { type: 'app:active', payload: { ...activeApp, ts: Date.now() } });
  sendTo(ws, { type: 'ports:update', payload: { ports: portService.getLatest() } });
  sendTo(ws, { type: 'logs:status', payload: logStreamer.getStatus() });
  for (const line of logStreamer.getRecentLines().slice(-40)) {
    sendTo(ws, { type: 'logs:line', payload: line });
  }
  sendTo(ws, { type: 'git:status', payload: gitService.getLatest() });
  sendTo(ws, { type: 'clipboard:update', payload: clipboardTracker.getState() });
  sendTo(ws, { type: 'focus:state', payload: focusService.getState() });
  sendTo(ws, {
    type: 'preview:url',
    payload: { url: configStore.getAll().previewUrl, label: 'Local Dev' },
  });
  for (const ev of webhookStore.getRecent().slice(0, 15).reverse()) {
    sendTo(ws, { type: 'webhook:event', payload: ev });
  }
  void getMediaState().then((media) => sendTo(ws, { type: 'media:state', payload: media }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientEvent;
      if (!msg || typeof msg.type !== 'string') return;
      void handleClientEvent(ws, msg);
    } catch {
      // Ignore malformed JSON frames
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

server.listen(BRIDGE_PORT, '0.0.0.0', () => {
  const bridgeHost = PUBLIC_BRIDGE_URL || lanIp;
  const bridgePortParam = PUBLIC_BRIDGE_URL ? 443 : BRIDGE_PORT;
  const pairUrl = `${PUBLIC_PWA_URL}/?host=${encodeURIComponent(bridgeHost)}&port=${bridgePortParam}&token=${encodeURIComponent(auth.token)}`;
  const localUrl = `http://${lanIp}:${PWA_PORT}/?host=${encodeURIComponent(lanIp)}&port=${BRIDGE_PORT}&token=${encodeURIComponent(auth.token)}`;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                  DEVDECK MAC BRIDGE v1.0                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  PWA URL   : ${PUBLIC_PWA_URL}`.padEnd(59) + '║');
  console.log(`║  Bridge WS : ${PUBLIC_BRIDGE_URL ? PUBLIC_BRIDGE_URL.replace(/^http/, 'ws') : `ws://${lanIp}:${BRIDGE_PORT}`}/ws`.padEnd(59) + '║');
  console.log(`║  Pair PIN  : ${auth.pin}`.padEnd(59) + '║');
  console.log(`║  Webhook   : http://${lanIp}:${BRIDGE_PORT}/hook/<path>`.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Scan with iPhone 14 Camera to open DevDeck on Vercel:\n');
  qrcode.generate(pairUrl, { small: true });
  console.log(`\nVercel Pair URL:\n${pairUrl}`);
  console.log(`\nLocal Wi-Fi Pair URL (when running npm run dev):\n${localUrl}\n`);
});

process.on('SIGINT', () => {
  statsService.stop();
  activeAppPoller.stop();
  portService.stop();
  gitService.stop();
  clipboardTracker.stop();
  logStreamer.stop();
  server.close(() => process.exit(0));
});
