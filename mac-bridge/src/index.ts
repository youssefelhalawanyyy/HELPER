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
  wakeMacDisplay,
} from './macos/hardware.js';
import { CaffeineManager } from './macos/caffeine.js';
import { DeepTelemetryService } from './macos/deepTelemetry.js';
import { controlMacMedia, getMediaState } from './macos/media.js';
import {
  clickMacCursor,
  focusMacApp,
  moveMacCursor,
  scrollMacSmooth,
  sendPresentationKey,
  setMacMouseDrag,
  toggleMacDarkMode,
  toggleMacMicMute,
} from './macos/remoteControl.js';
import { isKnownShortcut, runShortcut } from './macos/shortcuts.js';
import { sendToActiveMacTerminal } from './macos/terminal.js';
import { snapFrontmostWindow } from './macos/windowSnap.js';
import { createApiRouter } from './routes/api.js';
import { createWebhookRouter, WebhookStore } from './routes/webhook.js';
import { AntigravityService, runMacSpeedTest } from './services/antigravityService.js';
import { FocusService } from './services/focusService.js';
import { GitService } from './services/gitService.js';
import { LogStreamer, runConfiguredShellCommand } from './services/logStreamer.js';
import { PortService } from './services/portService.js';
import { ProcessAndDockerService } from './services/processService.js';
import { StatsService } from './services/statsService.js';
import type {
  AgentProgress,
  AgentQuestion,
  ClientEvent,
  ServerEvent,
  SpeedTestState,
} from './types/protocol.js';

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

const caffeineManager = new CaffeineManager((active) => {
  broadcast({ type: 'caffeine:state', payload: { active } });
});

const processService = new ProcessAndDockerService(
  (processes) => broadcast({ type: 'processes:update', payload: { processes } }),
  (available, containers) => broadcast({ type: 'docker:update', payload: { available, containers } }),
);

const deepTelemetry = new DeepTelemetryService(
  () => configStore.getAll().projectDir,
  lanIp,
  (data) => broadcast({ type: 'mac:telemetry', payload: data }),
);

const antigravityService = new AntigravityService(
  () => configStore.getAll().projectDir,
  (state) => broadcast({ type: 'antigravity:state', payload: state }),
);

// Live bidirectional Antigravity MCP state
let activeQuestion: AgentQuestion | null = null;
const pendingQuestionResolvers = new Map<
  string,
  { resolve: (answer: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>();
let latestProgress: AgentProgress = { title: '', step: '', percent: 0, active: false, ts: 0 };
let latestScan: { filePath: string; filename: string; ts: number } | null = null;
let latestVoice: { text: string; ts: number } | null = null;
let latestSpeedTest: SpeedTestState = {
  running: false,
  downMbps: null,
  upMbps: null,
  pingMs: null,
  ts: 0,
};

// Start background pollers
statsService.start(2000);
activeAppPoller.start(1500);
portService.start(3500);
gitService.start(5000);
clipboardTracker.start(1500);
processService.start(4500);
deepTelemetry.start(6000);
antigravityService.start(2500);

// --- Express Routes ---
app.use(
  '/api',
  createApiRouter({
    auth,
    config: configStore,
    lanIp,
    bridgePort: BRIDGE_PORT,
    onScanSaved: async (filePath, filename) => {
      latestScan = { filePath, filename, ts: Date.now() };
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
    onAgentAsk: (question, timeoutMs) =>
      new Promise<string>((resolve, reject) => {
        activeQuestion = question;
        broadcast({ type: 'agent:question', payload: question });
        broadcast({
          type: 'alert:flash',
          payload: { kind: 'warning', message: `Antigravity asks: ${question.question.slice(0, 56)}` },
        });
        const timer = setTimeout(() => {
          pendingQuestionResolvers.delete(question.id);
          if (activeQuestion?.id === question.id) {
            activeQuestion = null;
            broadcast({ type: 'agent:question', payload: null });
          }
          reject(new Error('Timed out waiting for tap on iPhone'));
        }, timeoutMs);
        pendingQuestionResolvers.set(question.id, { resolve, reject, timer });
      }),
    onAgentProgress: (progress) => {
      latestProgress = progress;
      broadcast({ type: 'agent:progress', payload: progress });
      return clients.size;
    },
    getLatestInput: () => ({ latestScan, latestVoice }),
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
      reply(msg.payload.requestId, true, 'Mac display locked');
      return;
    }

    case 'hardware:wake': {
      await wakeMacDisplay();
      reply(msg.payload.requestId, true, 'Mac display woken');
      return;
    }

    case 'hardware:caffeine': {
      const active = caffeineManager.setActive(msg.payload.active);
      reply(msg.payload.requestId, true, active ? 'Caffeine ON — Mac will stay awake' : 'Caffeine OFF');
      return;
    }

    case 'window:snap': {
      try {
        const resMsg = await snapFrontmostWindow(msg.payload.position);
        reply(msg.payload.requestId, true, resMsg);
      } catch (err) {
        reply(
          msg.payload.requestId,
          false,
          err instanceof Error ? err.message : 'Window snap requires Accessibility permission',
        );
      }
      return;
    }

    case 'processes:refresh': {
      await processService.scanProcesses();
      reply(msg.payload.requestId, true, 'Process list refreshed');
      return;
    }

    case 'process:kill': {
      const res = await processService.killProcess(msg.payload.pid);
      reply(msg.payload.requestId, res.ok, res.message);
      if (res.ok) {
        broadcast({ type: 'alert:flash', payload: { kind: 'warning', message: res.message } });
      }
      return;
    }

    case 'docker:refresh': {
      await processService.scanDocker();
      reply(msg.payload.requestId, true, 'Docker containers refreshed');
      return;
    }

    case 'docker:action': {
      const res = await processService.runDockerAction(msg.payload.id, msg.payload.action);
      reply(msg.payload.requestId, res.ok, res.message);
      return;
    }

    case 'app:focus': {
      try {
        const resMsg = await focusMacApp(
          msg.payload.appName,
          deepTelemetry.getLatest().runningApps,
        );
        reply(msg.payload.requestId, true, resMsg);
      } catch (err) {
        reply(msg.payload.requestId, false, err instanceof Error ? err.message : 'App launch failed');
      }
      return;
    }

    case 'trackpad:move': {
      void moveMacCursor(msg.payload.dx, msg.payload.dy, msg.payload.drag);
      return;
    }

    case 'trackpad:click': {
      void clickMacCursor(msg.payload.button);
      return;
    }

    case 'trackpad:drag': {
      void setMacMouseDrag(msg.payload.down);
      return;
    }

    case 'trackpad:scroll': {
      void scrollMacSmooth(msg.payload.dx, msg.payload.dy);
      return;
    }

    case 'presentation:key': {
      try {
        const resMsg = await sendPresentationKey(msg.payload.action);
        reply(msg.payload.requestId, true, resMsg);
      } catch (err) {
        reply(msg.payload.requestId, false, err instanceof Error ? err.message : 'Slide key failed');
      }
      return;
    }

    case 'system:toggleDarkMode': {
      try {
        const dark = await toggleMacDarkMode();
        await deepTelemetry.refresh();
        reply(msg.payload.requestId, true, dark ? 'macOS Dark Mode ON' : 'macOS Light Mode ON');
      } catch (err) {
        reply(msg.payload.requestId, false, err instanceof Error ? err.message : 'Toggle failed');
      }
      return;
    }

    case 'system:toggleMic': {
      try {
        const res = await toggleMacMicMute();
        await deepTelemetry.refresh();
        reply(msg.payload.requestId, true, res.micMuted ? 'Mac Mic MUTED' : 'Mac Mic LIVE');
      } catch (err) {
        reply(msg.payload.requestId, false, err instanceof Error ? err.message : 'Mic toggle failed');
      }
      return;
    }

    case 'script:run': {
      const scripts = deepTelemetry.getLatest().projectScripts;
      const found = scripts.find((s) => s.name === msg.payload.scriptName);
      if (!found) {
        reply(msg.payload.requestId, false, `Script "${msg.payload.scriptName}" not found in package.json`);
        return;
      }
      logStreamer.startPreset(
        { id: `pkg-${found.name}`, label: `npm run ${found.name}`, command: 'npm', args: ['run', found.name] },
        configStore.getAll().projectDir,
      );
      reply(msg.payload.requestId, true, `Streaming npm run ${found.name}`);
      return;
    }

    case 'telemetry:refresh': {
      await deepTelemetry.refresh();
      await antigravityService.refresh();
      reply(msg.payload.requestId, true, 'Mac & Antigravity telemetry refreshed');
      return;
    }

    case 'agent:answer': {
      const { requestId, questionId, answer } = msg.payload;
      const pending = pendingQuestionResolvers.get(questionId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingQuestionResolvers.delete(questionId);
        pending.resolve(answer);
      }
      if (activeQuestion?.id === questionId) {
        activeQuestion = null;
        broadcast({ type: 'agent:question', payload: null });
      }
      reply(requestId, true, `Sent "${answer}" to Antigravity`);
      return;
    }

    case 'antigravity:slash': {
      const { requestId, command } = msg.payload;
      const allowed = new Set(['/plan', '/boost', '/goal', '/compact', '/grill-me', '/learn', '/teamwork']);
      if (!allowed.has(command)) {
        reply(requestId, false, `Slash command "${command}" is not allowed`);
        return;
      }
      try {
        await focusMacApp('Antigravity IDE', deepTelemetry.getLatest().runningApps);
        await new Promise((r) => setTimeout(r, 140));
        await runShortcut('antigravity.agentChat');
        await new Promise((r) => setTimeout(r, 100));
        await copyToMacClipboard(`${command} `);
        await triggerMacPaste();
        reply(requestId, true, `Injected ${command} into Antigravity IDE`);
      } catch (err) {
        reply(requestId, false, err instanceof Error ? err.message : 'Slash command failed');
      }
      return;
    }

    case 'antigravity:prompt': {
      const { requestId, text, submit } = msg.payload;
      const clean = text.trim();
      if (!clean) {
        reply(requestId, false, 'Empty prompt');
        return;
      }
      try {
        await focusMacApp('Antigravity IDE', deepTelemetry.getLatest().runningApps);
        await new Promise((r) => setTimeout(r, 140));
        await runShortcut('antigravity.agentChat');
        await new Promise((r) => setTimeout(r, 100));
        await copyToMacClipboard(clean);
        await triggerMacPaste();
        if (submit) {
          await new Promise((r) => setTimeout(r, 80));
          await runShortcut('antigravity.acceptChanges');
        }
        reply(requestId, true, 'Prompt sent to Antigravity IDE');
      } catch (err) {
        reply(requestId, false, err instanceof Error ? err.message : 'Prompt send failed');
      }
      return;
    }

    case 'speedtest:run': {
      if (latestSpeedTest.running) {
        reply(msg.payload.requestId, false, 'Speed test already running');
        return;
      }
      latestSpeedTest = { ...latestSpeedTest, running: true, error: undefined, ts: Date.now() };
      broadcast({ type: 'speedtest:state', payload: latestSpeedTest });
      reply(msg.payload.requestId, true, 'Running Mac internet speed test…');
      void runMacSpeedTest()
        .then((res) => {
          latestSpeedTest = { running: false, ...res, ts: Date.now() };
          broadcast({ type: 'speedtest:state', payload: latestSpeedTest });
          broadcast({
            type: 'alert:flash',
            payload: { kind: 'success', message: `Speed: ↓${res.downMbps} Mbps · ↑${res.upMbps} Mbps` },
          });
        })
        .catch((err) => {
          latestSpeedTest = {
            ...latestSpeedTest,
            running: false,
            error: err instanceof Error ? err.message : 'Speed test failed',
            ts: Date.now(),
          };
          broadcast({ type: 'speedtest:state', payload: latestSpeedTest });
        });
      return;
    }

    case 'voice:transcript': {
      const { requestId, text, autoPaste } = msg.payload;
      if (!text.trim()) {
        reply(requestId, false, 'Empty transcript');
        return;
      }
      latestVoice = { text: text.trim(), ts: Date.now() };
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
  sendTo(ws, { type: 'caffeine:state', payload: { active: caffeineManager.isActive() } });
  sendTo(ws, { type: 'processes:update', payload: { processes: processService.getLatestProcesses() } });
  sendTo(ws, { type: 'docker:update', payload: processService.getLatestDocker() });
  sendTo(ws, { type: 'mac:telemetry', payload: deepTelemetry.getLatest() });
  sendTo(ws, { type: 'antigravity:state', payload: antigravityService.getLatest() });
  sendTo(ws, { type: 'agent:progress', payload: latestProgress });
  sendTo(ws, { type: 'speedtest:state', payload: latestSpeedTest });
  if (activeQuestion) {
    sendTo(ws, { type: 'agent:question', payload: activeQuestion });
  }
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
  const line = (text: string) => `║  ${text.padEnd(60)}║`;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    DEVDECK MAC BRIDGE v1.0                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(line(`PWA URL   : ${PUBLIC_PWA_URL}`));
  console.log(line(`6-DIGIT PIN: ${auth.pin}`));
  console.log(line(`WEBHOOK   : http://${lanIp}:${BRIDGE_PORT}/hook/<path>`));
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(line('OPTION 1: HTTPS TUNNEL (Vercel / iPhone 14 Safari)'));
  console.log(line('  1. Open Terminal 2 & run:'));
  console.log(line('     npx -y cloudflared tunnel --url http://127.0.0.1:4747'));
  console.log(line('  2. In DevDeck -> Tab: "HTTPS Tunnel (Vercel / iPhone)"'));
  console.log(line(`  3. Tunnel URL : ${PUBLIC_BRIDGE_URL || 'Paste https://....trycloudflare.com'}`));
  console.log(line(`  4. 6-Digit PIN: ${auth.pin}`));
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(line('OPTION 2: LOCAL MAC / LAN IP (Mac Chrome or Local Wi-Fi)'));
  console.log(line('  1. In DevDeck -> Tab: "Local Mac / LAN IP"'));
  console.log(line(`  2. Mac IP     : 127.0.0.1 (this Mac) or ${lanIp} (Wi-Fi)`));
  console.log(line(`  3. Bridge Port: ${BRIDGE_PORT}`));
  console.log(line(`  4. 6-Digit PIN: ${auth.pin}`));
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log('Scan QR Code with iPhone 14 Camera:\n');
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
  caffeineManager.stop();
  processService.stop();
  deepTelemetry.stop();
  antigravityService.stop();
  server.close(() => process.exit(0));
});
