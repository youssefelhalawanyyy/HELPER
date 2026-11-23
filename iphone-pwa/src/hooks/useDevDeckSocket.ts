'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type {
  ActivePort,
  AgentNotification,
  AgentProgress,
  AgentQuestion,
  AntigravityFileDiff,
  AntigravityLiveState,
  BridgeHello,
  ClientEvent,
  ClipboardItem,
  DevDeckPublicConfig,
  DockerContainer,
  FocusState,
  GitStatus,
  HeavyProcess,
  LogLine,
  LogStatus,
  MacDeepTelemetry,
  MediaState,
  ProfileId,
  ServerEvent,
  SpeedTestState,
  SystemDoctorReport,
  SystemStats,
  WebhookEvent,
} from '@/types/protocol';

export interface PairingConfig {
  host: string;
  port: number;
  token: string;
  secure?: boolean;
}

function buildBridgeUrls(cfg: { host: string; port: number; secure?: boolean }) {
  const raw = cfg.host.trim().replace(/\/+$/, '');
  const isFullHttps = /^https:\/\//i.test(raw);
  const isFullHttp = /^http:\/\//i.test(raw);

  if (isFullHttps || isFullHttp) {
    try {
      const u = new URL(raw);
      const httpBase = u.origin;
      const wsBase = u.origin.replace(/^http/i, 'ws');
      return { httpBase, wsBase };
    } catch {
      const httpBase = raw;
      const wsBase = raw.replace(/^http/i, 'ws');
      return { httpBase, wsBase };
    }
  }

  const isLocalOrIp = /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})$/i.test(raw);
  const useSecure = Boolean(cfg.secure) || (!isLocalOrIp && cfg.port === 443) || (!isLocalOrIp && raw.includes('.'));
  const httpProto = useSecure ? 'https' : 'http';
  const wsProto = useSecure ? 'wss' : 'ws';
  const portSuffix =
    (useSecure && (!cfg.port || cfg.port === 443)) || (!useSecure && cfg.port === 80)
      ? ''
      : `:${cfg.port || 4747}`;
  return {
    httpBase: `${httpProto}://${raw}${portSuffix}`,
    wsBase: `${wsProto}://${raw}${portSuffix}`,
  };
}

export type ConnectionState = 'unpaired' | 'connecting' | 'connected' | 'reconnecting';

export interface AlertFlash {
  id: string;
  kind: 'success' | 'error' | 'warning';
  message: string;
}

export interface ToastNotice {
  id: string;
  ok: boolean;
  message: string;
}

const STORAGE_KEY = 'devdeck.pairing.v1';

function loadSavedPairing(): PairingConfig | null {
  if (typeof window === 'undefined') return null;

  // 1. Check URL query parameters from QR code scan
  const params = new URLSearchParams(window.location.search);
  const qHost = params.get('host');
  const qPort = params.get('port');
  const qToken = params.get('token');
  if (qHost && qToken) {
    const parsed: PairingConfig = {
      host: qHost,
      port: Number(qPort) || 4747,
      token: qToken,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    // Strip token from browser address bar for cleanliness
    window.history.replaceState({}, '', window.location.pathname);
    return parsed;
  }

  // 2. Fall back to localStorage
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PairingConfig>;
    if (parsed.host && parsed.token) {
      return {
        host: parsed.host,
        port: Number(parsed.port) || 4747,
        token: parsed.token,
      };
    }
  } catch {
    // Ignore storage error
  }
  return null;
}

export function useDevDeckSocket() {
  const [pairing, setPairing] = useState<PairingConfig | null>(null);
  const [status, setStatus] = useState<ConnectionState>('unpaired');
  const [hello, setHello] = useState<BridgeHello | null>(null);
  const [config, setConfig] = useState<DevDeckPublicConfig | null>(null);
  const [stats, setStats] = useState<SystemStats>({
    cpuPct: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    ramPct: 0,
    diskUsedGb: 0,
    diskTotalGb: 0,
    diskPct: 0,
    netRxKBs: 0,
    netTxKBs: 0,
    batteryPct: null,
    batteryCharging: false,
    ts: 0,
  });
  const [activeApp, setActiveApp] = useState<{ appName: string; profileId: ProfileId }>({
    appName: 'macOS',
    profileId: 'vscode',
  });
  const [ports, setPorts] = useState<ActivePort[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logStatus, setLogStatus] = useState<LogStatus>({
    running: false,
    presetId: null,
    command: null,
    pid: null,
    exitCode: null,
  });
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    isGitRepo: false,
    repoName: 'project',
    path: '',
    branch: 'main',
    uncommitted: 0,
    ahead: 0,
    behind: 0,
    files: [],
    lastUpdated: 0,
  });
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [clipboard, setClipboard] = useState<{ current: string; history: ClipboardItem[] }>({
    current: '',
    history: [],
  });
  const [focusState, setFocusState] = useState<FocusState>({
    active: false,
    remainingSec: 25 * 60,
    totalSec: 25 * 60,
    dndEnabled: false,
  });
  const [mediaState, setMediaState] = useState<MediaState>({
    volume: 50,
    muted: false,
    brightness: 70,
    playing: false,
    track: 'No Media Active',
    artist: 'Spotify / Apple Music',
    player: 'System',
  });
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  const [alertFlash, setAlertFlash] = useState<AlertFlash | null>(null);
  const [agentNotification, setAgentNotification] = useState<AgentNotification | null>(null);
  const [agentQuestion, setAgentQuestion] = useState<AgentQuestion | null>(null);
  const [agentProgress, setAgentProgress] = useState<AgentProgress>({
    title: '',
    step: '',
    percent: 0,
    active: false,
    ts: 0,
  });
  const [antigravityState, setAntigravityState] = useState<AntigravityLiveState>({
    active: false,
    statusLabel: 'IDLE',
    lastActivityTs: 0,
    conversationId: '',
    pinnedSessionId: null,
    sessions: [],
    model: '',
    stepCount: 0,
    contextTokens: 0,
    currentFocus: '',
    lastUserPrompt: '',
    steps: [],
    recentEvents: [],
    chatTurns: [],
    terminalRuns: [],
    artifactName: '',
    artifactPreview: '',
    diffFiles: [],
    totalAdded: 0,
    totalRemoved: 0,
  });
  const [antigravityDiff, setAntigravityDiff] = useState<AntigravityFileDiff | null>(null);
  const [doctorReport, setDoctorReport] = useState<SystemDoctorReport>({
    scanning: false,
    repairing: false,
    aiConfigured: false,
    activeAction: '',
    score: 0,
    grade: 'GOOD',
    summaryEnglish: 'Tap "SCAN" to inspect CPU, RAM, disk health, junk files, crashes, and corrupted system files.',
    platform: '',
    scannedAt: 0,
    metrics: {
      cpuPct: 0,
      ramPct: 0,
      ramUsedGb: 0,
      ramTotalGb: 0,
      diskFreeGb: 0,
      diskPct: 0,
      tempJunkMb: 0,
      crashReportsCount: 0,
      startupCount: 0,
      uptimeHours: 0,
      integrityStatus: 'Not Checked',
      securityStatus: 'Not Scanned',
      corruptedFilesCount: 0,
    },
    issues: [],
    repairLog: [],
    terminalLines: [],
    postReport: null,
  });
  const [speedTest, setSpeedTest] = useState<SpeedTestState>({
    running: false,
    downMbps: null,
    upMbps: null,
    pingMs: null,
    ts: 0,
  });
  const [caffeineActive, setCaffeineActive] = useState(false);
  const [processes, setProcesses] = useState<HeavyProcess[]>([]);
  const [docker, setDocker] = useState<{ available: boolean; containers: DockerContainer[] }>({
    available: false,
    containers: [],
  });
  const [macTelemetry, setMacTelemetry] = useState<MacDeepTelemetry | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const flashTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const triggerFlash = useCallback((kind: AlertFlash['kind'], message: string) => {
    setAlertFlash({ id: makeRequestId(), kind, message });
    if (kind === 'success') soundEngine.playSuccessChime();
    else if (kind === 'error') soundEngine.playErrorThud();

    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setAlertFlash(null), 2200);
  }, []);

  const showToast = useCallback((ok: boolean, message: string) => {
    setToast({ id: makeRequestId(), ok, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const saved = loadSavedPairing();
    if (saved) {
      setPairing(saved);
    }
  }, []);

  const connect = useCallback(
    (cfg: PairingConfig) => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      setStatus(retryCountRef.current > 0 ? 'reconnecting' : 'connecting');
      const { wsBase } = buildBridgeUrls(cfg);
      const wsUrl = `${wsBase}/ws?token=${encodeURIComponent(cfg.token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCountRef.current = 0;
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as ServerEvent;
          switch (msg.type) {
            case 'hello':
              setHello(msg.payload);
              break;
            case 'config:sync':
              setConfig(msg.payload);
              if (msg.payload.previewUrl) setPreviewUrl(msg.payload.previewUrl);
              break;
            case 'stats:update':
              setStats(msg.payload);
              break;
            case 'app:active':
              setActiveApp({ appName: msg.payload.appName, profileId: msg.payload.profileId });
              break;
            case 'ports:update':
              setPorts(msg.payload.ports);
              break;
            case 'logs:line':
              setLogs((prev) => [...prev.slice(-199), msg.payload]);
              break;
            case 'logs:status':
              setLogStatus(msg.payload);
              break;
            case 'git:status':
              setGitStatus(msg.payload);
              break;
            case 'webhook:event':
              setWebhooks((prev) => [msg.payload, ...prev.filter((w) => w.id !== msg.payload.id)].slice(0, 40));
              break;
            case 'clipboard:update':
              setClipboard(msg.payload);
              break;
            case 'focus:state':
              setFocusState(msg.payload);
              break;
            case 'media:state':
              setMediaState(msg.payload);
              break;
            case 'preview:url':
              setPreviewUrl(msg.payload.url);
              break;
            case 'alert:flash':
              triggerFlash(msg.payload.kind, msg.payload.message);
              break;
            case 'agent:notification':
              setAgentNotification(msg.payload);
              break;
            case 'agent:question':
              setAgentQuestion(msg.payload);
              if (msg.payload) soundEngine.playSuccessChime();
              break;
            case 'agent:progress':
              setAgentProgress(msg.payload);
              break;
            case 'antigravity:state':
              setAntigravityState(msg.payload);
              break;
            case 'antigravity:diff':
              setAntigravityDiff(msg.payload);
              break;
            case 'doctor:state':
              setDoctorReport(msg.payload);
              break;
            case 'speedtest:state':
              setSpeedTest(msg.payload);
              break;
            case 'caffeine:state':
              setCaffeineActive(msg.payload.active);
              break;
            case 'processes:update':
              setProcesses(msg.payload.processes);
              break;
            case 'docker:update':
              setDocker(msg.payload);
              break;
            case 'mac:telemetry':
              setMacTelemetry(msg.payload);
              break;
            case 'action:result':
              showToast(msg.payload.ok, msg.payload.message);
              if (!msg.payload.ok) soundEngine.playErrorThud();
              break;
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = (ev) => {
        wsRef.current = null;
        if (ev.code === 4001) {
          // Invalid token -> return to pairing screen
          setStatus('unpaired');
          showToast(false, 'Pairing token expired or invalid');
          return;
        }
        setStatus('reconnecting');
        const delay = Math.min(5000, 750 * Math.pow(1.4, retryCountRef.current));
        retryCountRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(() => connect(cfg), delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    },
    [showToast, triggerFlash],
  );

  useEffect(() => {
    if (!pairing) {
      setStatus('unpaired');
      return;
    }
    connect(pairing);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        retryCountRef.current = 0;
        connect(pairing);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [pairing, connect]);

  const savePairing = useCallback((next: PairingConfig) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    retryCountRef.current = 0;
    setPairing(next);
  }, []);

  const clearPairing = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    setPairing(null);
    setStatus('unpaired');
  }, []);

  const pairWithPin = useCallback(
    async (host: string, port: number, pin: string): Promise<{ ok: boolean; error?: string }> => {
      const { httpBase } = buildBridgeUrls({ host, port });
      try {
        const res = await fetch(`${httpBase}/api/pair`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
        if (!res.ok || !data.ok || !data.token) {
          return { ok: false, error: data.error || 'Pairing failed' };
        }
        savePairing({ host, port, token: data.token });
        soundEngine.playSuccessChime();
        return { ok: true };
      } catch {
        const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const isLanIp = /^http:\/\/(?!127\.0\.0\.1|localhost)/i.test(httpBase);
        if (pageIsHttps && isLanIp) {
          return {
            ok: false,
            error: `HTTPS blocks HTTP LAN IPs (${httpBase}). Use 127.0.0.1 on this Mac, or an https://....trycloudflare.com tunnel on iPhone.`,
          };
        }
        return {
          ok: false,
          error: `Cannot reach Mac bridge at ${httpBase}. Make sure npm run dev:bridge (and cloudflared if using a tunnel) is running.`,
        };
      }
    },
    [savePairing],
  );

  const sendEvent = useCallback((event: ClientEvent): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      showToast(false, 'Not connected to Mac bridge');
      return false;
    }
    wsRef.current.send(JSON.stringify(event));
    return true;
  }, [showToast]);

  const clearLogs = useCallback(() => setLogs([]), []);
  const dismissAgentNotification = useCallback(() => setAgentNotification(null), []);

  const bridgeBaseUrl = pairing ? buildBridgeUrls(pairing).httpBase : null;

  return {
    pairing,
    bridgeBaseUrl,
    status,
    hello,
    config,
    stats,
    activeApp,
    ports,
    logs,
    logStatus,
    gitStatus,
    webhooks,
    clipboard,
    focusState,
    mediaState,
    previewUrl,
    alertFlash,
    agentNotification,
    agentQuestion,
    agentProgress,
    antigravityState,
    antigravityDiff,
    doctorReport,
    speedTest,
    caffeineActive,
    processes,
    docker,
    macTelemetry,
    toast,
    sendEvent,
    pairWithPin,
    savePairing,
    clearPairing,
    clearLogs,
    dismissAgentNotification,
    showToast,
    triggerFlash,
  };
}

export type DevDeckState = ReturnType<typeof useDevDeckSocket>;
