'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Laptop,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import styles from './WebsiteTesterView.module.css';

interface InspectData {
  url: string;
  finalUrl: string;
  status: number;
  elapsedMs: number;
  sizeBytes?: number;
  isLocalhost?: boolean;
  localPort?: number | null;
  frameBlocked?: boolean;
  headers: Record<string, string>;
  meta: {
    title: string;
    description: string;
    viewport: string;
    canonical: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    charset: string;
  };
  error?: string;
}

interface PreviewSessionResponse {
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

interface ConsoleEntry {
  id: string;
  level: 'error' | 'warn' | 'info';
  text: string;
  ts: number;
}

type StudioTab = 'audit' | 'console' | 'headers' | 'share';

const STORAGE_LAST_URL = 'devdeck.webstudio.lastUrl.v2';
const NON_WEB_PORTS = new Set([4747, 5432, 6379, 27017, 3306, 1433, 9229]);

const VIEWPORTS = [
  { id: 'mobile', label: 'iPhone', w: 393, h: 852, kind: 'mobile', Icon: Smartphone },
  { id: 'tablet', label: 'iPad', w: 820, h: 1180, kind: 'mobile', Icon: Tablet },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800, kind: 'desktop', Icon: Laptop },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900, kind: 'desktop', Icon: Monitor },
  { id: 'fluid', label: 'Fit', w: 0, h: 0, kind: 'fluid', Icon: Maximize2 },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]['id'];

function normalizeClientUrl(raw: string): {
  normalized: string;
  isLocal: boolean;
  localPort: number | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { normalized: 'http://localhost:3000', isLocal: true, localPort: 3000 };
  }
  const portShorthand = trimmed.match(/^:?(\d{2,5})(\/.*)?$/);
  if (portShorthand) {
    const port = Number(portShorthand[1]);
    return {
      normalized: `http://localhost:${port}${portShorthand[2] || ''}`,
      isLocal: true,
      localPort: port,
    };
  }

  let withProto = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    const hostPart = trimmed.split('/')[0].toLowerCase();
    const looksLocal =
      hostPart === 'localhost' ||
      hostPart.startsWith('localhost:') ||
      hostPart.startsWith('127.0.0.1') ||
      hostPart.startsWith('[::1]') ||
      hostPart.startsWith('0.0.0.0') ||
      hostPart.endsWith('.local') ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostPart);
    withProto = `${looksLocal ? 'http' : 'https'}://${trimmed}`;
  }

  try {
    const u = new URL(withProto);
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
    const localPort = isLocal ? (u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80) : null;
    return { normalized: u.toString(), isLocal, localPort };
  } catch {
    return { normalized: withProto, isLocal: false, localPort: null };
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function WebsiteTesterView({ deck }: { deck: DevDeckState }) {
  const baseId = useId();
  const [urlInput, setUrlInput] = useState('http://localhost:3000');
  const [targetUrl, setTargetUrl] = useState('http://localhost:3000');
  const [resolvedFrameUrl, setResolvedFrameUrl] = useState('');
  const [sessionInfo, setSessionInfo] = useState<PreviewSessionResponse | null>(null);
  const [vpId, setVpId] = useState<ViewportId>('mobile');
  const [rotated, setRotated] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rightTab, setRightTab] = useState<StudioTab>('audit');
  const [headerFilter, setHeaderFilter] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [bridging, setBridging] = useState(false);
  const [inspect, setInspect] = useState<InspectData | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [copiedShare, setCopiedShare] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [stageSize, setStageSize] = useState({ w: 360, h: 240 });
  const [bugPinMode, setBugPinMode] = useState(false);
  const [bugPin, setBugPin] = useState<{ xPct: number; yPct: number; pxX: number; pxY: number } | null>(null);
  const [bugNote, setBugNote] = useState('');
  const [sendingBug, setSendingBug] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  const isConnected = deck.status === 'connected' && Boolean(deck.bridgeBaseUrl && deck.pairing?.token);

  // Detect live dev ports running on the paired Mac/PC (e.g. :3000, :5173, :8080, :4321)
  const webDevPorts = useMemo(
    () =>
      deck.ports
        .filter((p) => !NON_WEB_PORTS.has(p.port) && p.port >= 80 && p.port <= 65535)
        .filter((p, idx, arr) => arr.findIndex((x) => x.port === p.port) === idx),
    [deck.ports],
  );

  // Measure available device stage dimensions dynamically
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 40 && r.height > 40) {
        setStageSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // Listen for live console logs & runtime errors posted from proxied localhost preview
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== 'devdeck-preview') return;
      if (d.type === 'console' && typeof d.text === 'string') {
        const level: ConsoleEntry['level'] =
          d.level === 'error' ? 'error' : d.level === 'warn' ? 'warn' : 'info';
        setConsoleLogs((prev) => [
          ...prev.slice(-79),
          {
            id: `${d.ts || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            level,
            text: d.text,
            ts: d.ts || Date.now(),
          },
        ]);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const loadSite = useCallback(
    async (rawTarget?: string, opts?: { silentPoll?: boolean }) => {
      const silent = Boolean(opts?.silentPoll);
      if (!silent) soundEngine.playClick();

      const candidate = (rawTarget ?? urlInput).trim();
      const { normalized, isLocal } = normalizeClientUrl(candidate);

      if (!silent) {
        setUrlInput(normalized);
        setTargetUrl(normalized);
        setConsoleLogs([]);
        try {
          localStorage.setItem(STORAGE_LAST_URL, normalized);
        } catch {
          // Ignore storage quota
        }
      }

      const browserIsLocalMachine =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const wantHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

      if (!silent) setInspecting(true);

      try {
        if (isConnected && deck.bridgeBaseUrl && deck.pairing?.token) {
          const authHeaders = {
            'content-type': 'application/json',
            authorization: `Bearer ${deck.pairing.token}`,
          };

          if (isLocal) {
            if (!silent) setBridging(true);
            const [sessionRes, inspectRes] = await Promise.all([
              fetch(`${deck.bridgeBaseUrl}/api/devsuite/preview-session`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: normalized, wantHttps }),
              }),
              fetch(`${deck.bridgeBaseUrl}/api/devsuite/inspect`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: normalized }),
              }),
            ]);

            const session = (await sessionRes.json()) as PreviewSessionResponse;
            const inspectJson = (await inspectRes.json()) as InspectData;

            setSessionInfo(session);
            setInspect(inspectJson);
            setBridging(false);

            if (session.ok && session.previewUrl) {
              setResolvedFrameUrl(session.previewUrl);
              if (!silent) setFrameKey((k) => k + 1);
            }
          } else {
            // Public / remote site: inspect first, and if X-Frame-Options blocks framing, bridge-unblock automatically!
            setSessionInfo(null);
            setResolvedFrameUrl(normalized);
            if (!silent) setFrameKey((k) => k + 1);

            const inspectRes = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/inspect`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ url: normalized }),
            });
            const inspectJson = (await inspectRes.json()) as InspectData;
            setInspect(inspectJson);

            if (inspectJson.frameBlocked) {
              setBridging(true);
              const proxyRes = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/preview-session`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: normalized, wantHttps, forceProxy: true }),
              });
              const proxySession = (await proxyRes.json()) as PreviewSessionResponse;
              setBridging(false);
              if (proxySession.ok && proxySession.previewUrl) {
                setSessionInfo(proxySession);
                setResolvedFrameUrl(proxySession.previewUrl);
                setFrameKey((k) => k + 1);
              }
            }
          }
        } else {
          // Standalone phone mode (bridge not paired yet)
          setSessionInfo(null);
          if (isLocal && !browserIsLocalMachine) {
            setResolvedFrameUrl('');
            setInspect({
              url: normalized,
              finalUrl: normalized,
              status: 0,
              elapsedMs: 0,
              isLocalhost: true,
              headers: {},
              meta: {
                title: '',
                description: '',
                viewport: '',
                canonical: '',
                ogTitle: '',
                ogDescription: '',
                ogImage: '',
                charset: '',
              },
              error: 'Pair your Mac/PC bridge to tunnel localhost dev servers live to your iPhone.',
            });
          } else {
            setResolvedFrameUrl(normalized);
            if (!silent) setFrameKey((k) => k + 1);
            const t0 = performance.now();
            const res = await fetch(normalized);
            const html = await res.text();
            const headers: Record<string, string> = {};
            res.headers.forEach((v, k) => {
              headers[k] = v;
            });
            const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
            setInspect({
              url: normalized,
              finalUrl: res.url || normalized,
              status: res.status,
              elapsedMs: Math.round(performance.now() - t0),
              sizeBytes: html.length,
              headers,
              meta: {
                title,
                description: '',
                viewport: '',
                canonical: '',
                ogTitle: '',
                ogDescription: '',
                ogImage: '',
                charset: '',
              },
            });
          }
        }
      } catch (err) {
        setBridging(false);
        setInspect({
          url: normalized,
          finalUrl: normalized,
          status: 0,
          elapsedMs: 0,
          isLocalhost: isLocal,
          headers: {},
          meta: {
            title: '',
            description: '',
            viewport: '',
            canonical: '',
            ogTitle: '',
            ogDescription: '',
            ogImage: '',
            charset: '',
          },
          error:
            err instanceof Error
              ? `${err.message}${!isConnected ? ' — Pair Mac/PC bridge for full cross-origin & localhost inspection.' : ''}`
              : 'Inspection failed',
        });
      } finally {
        if (!silent) setInspecting(false);
      }
    },
    [urlInput, isConnected, deck.bridgeBaseUrl, deck.pairing?.token],
  );

  // Smart initial load: prefer saved URL, or active localhost dev server, or live PWA URL
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let initial = 'http://localhost:3000';
    try {
      const saved = localStorage.getItem(STORAGE_LAST_URL);
      if (saved) initial = saved;
      else if (webDevPorts[0]) initial = `http://localhost:${webDevPorts[0].port}`;
      else if (!isConnected) initial = 'https://helper-nu-swart.vercel.app';
    } catch {
      // Ignore
    }
    setUrlInput(initial);
    setTargetUrl(initial);
    void loadSite(initial, { silentPoll: true });
  }, [isConnected, loadSite, webDevPorts]);

  // Re-connect localhost tunnel automatically when bridge transitions to connected
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (!prevConnectedRef.current && isConnected) {
      void loadSite(targetUrl, { silentPoll: true });
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, loadSite, targetUrl]);

  // Auto-poll every 2.5s if user is waiting on a localhost port that hasn't started listening yet!
  const parsedTarget = useMemo(() => normalizeClientUrl(targetUrl), [targetUrl]);
  const waitingForLocalServer =
    isConnected && parsedTarget.isLocal && sessionInfo !== null && !sessionInfo.reachable;

  useEffect(() => {
    if (!waitingForLocalServer) return;
    const timer = window.setInterval(() => {
      void loadSite(targetUrl, { silentPoll: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [waitingForLocalServer, loadSite, targetUrl]);

  const startProjectDevServer = () => {
    soundEngine.playClick();
    const hasDevScript = deck.macTelemetry?.projectScripts?.some((s) => s.name === 'dev');
    if (hasDevScript) {
      deck.sendEvent({
        type: 'script:run',
        payload: { requestId: makeRequestId(), scriptName: 'dev' },
      });
    } else {
      const devPreset = deck.config?.logPresets?.find((p) => /dev/i.test(p.id) || /dev/i.test(p.label));
      if (devPreset) {
        deck.sendEvent({
          type: 'logs:start',
          payload: { requestId: makeRequestId(), presetId: devPreset.id },
        });
      } else {
        deck.showToast(false, 'Run "npm run dev" in your project terminal — Web Studio will auto-connect');
        return;
      }
    }
    deck.showToast(true, 'Starting npm run dev — preview will connect automatically');
  };

  const vp = VIEWPORTS.find((v) => v.id === vpId) || VIEWPORTS[0];
  const isFluid = vp.kind === 'fluid';
  const vpW = isFluid ? Math.max(320, stageSize.w - 12) : rotated ? vp.h : vp.w;
  const vpH = isFluid ? Math.max(200, stageSize.h - 12) : rotated ? vp.w : vp.h;
  const chromeHeight = vp.kind === 'desktop' ? 18 : vp.kind === 'mobile' && !rotated ? 14 : 0;
  const availW = Math.max(120, stageSize.w - 14);
  const availH = Math.max(100, stageSize.h - 14 - chromeHeight);
  const scale = isFluid ? 1 : Math.min(1, availW / vpW, availH / vpH);
  const scaledW = Math.max(80, Math.round(vpW * scale));
  const scaledH = Math.max(60, Math.round(vpH * scale));

  // Shareable / scannable URL: prefer public HTTPS tunnel for localhost, else LAN proxy, else LAN IP rewrite
  const shareUrl = useMemo(() => {
    if (sessionInfo?.tunnelUrl) return sessionInfo.tunnelUrl;
    if (sessionInfo?.lanUrl) return sessionInfo.lanUrl;
    const lanIp = deck.hello?.lanIp;
    if (lanIp && parsedTarget.isLocal) {
      return targetUrl.replace(/\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i, `//${lanIp}`);
    }
    return resolvedFrameUrl || targetUrl;
  }, [sessionInfo, deck.hello?.lanIp, parsedTarget.isLocal, targetUrl, resolvedFrameUrl]);

  // Audit checks computed from live response
  const auditChecks = useMemo(() => {
    if (!inspect || inspect.status === 0) return [];
    const h = inspect.headers;
    const hasViewport = Boolean(inspect.meta.viewport);
    const titleLen = inspect.meta.title.length;
    const descLen = inspect.meta.description.length;
    const hasOg = Boolean(inspect.meta.ogTitle || inspect.meta.ogImage);
    const hasSecHeaders = Boolean(
      h['content-security-policy'] || h['strict-transport-security'] || h['x-content-type-options'],
    );

    return [
      {
        label: 'HTTP Response',
        ok: inspect.status >= 200 && inspect.status < 400,
        warn: false,
        detail: `HTTP ${inspect.status} in ${inspect.elapsedMs}ms (${formatBytes(inspect.sizeBytes)})`,
      },
      {
        label: 'Mobile Viewport Meta',
        ok: hasViewport,
        warn: !hasViewport,
        detail: inspect.meta.viewport || 'Missing <meta name="viewport"> — mobile layout may zoom out',
      },
      {
        label: 'Document <title>',
        ok: titleLen >= 4 && titleLen <= 70,
        warn: titleLen > 70,
        detail: inspect.meta.title ? `"${inspect.meta.title}" (${titleLen} chars)` : 'Missing <title> tag',
      },
      {
        label: 'Meta Description',
        ok: descLen >= 20,
        warn: descLen > 0 && descLen < 20,
        detail: inspect.meta.description
          ? `${descLen} chars`
          : parsedTarget.isLocal
            ? 'Optional in dev — add before production SEO deploy'
            : 'No meta description found',
      },
      {
        label: 'OpenGraph Social Preview',
        ok: hasOg,
        warn: !hasOg,
        detail: hasOg
          ? inspect.meta.ogImage
            ? 'og:title + og:image configured'
            : 'og:title set (no og:image)'
          : 'No og:title / og:image tags',
      },
      {
        label: parsedTarget.isLocal ? 'Localhost HMR Bridge' : 'Security Headers',
        ok: parsedTarget.isLocal ? Boolean(sessionInfo?.ok) : hasSecHeaders,
        warn: !parsedTarget.isLocal && !hasSecHeaders,
        detail: parsedTarget.isLocal
          ? sessionInfo?.mode === 'https-tunnel'
            ? 'Tunneled over HTTPS with Vite/Next.js Host & HMR forwarding'
            : 'Connected via Local LAN Bridge Proxy'
          : hasSecHeaders
            ? 'CSP / HSTS / nosniff active'
            : 'Consider adding HSTS, CSP & X-Content-Type-Options',
      },
    ];
  }, [inspect, parsedTarget.isLocal, sessionInfo]);

  const filteredHeaders = useMemo(() => {
    if (!inspect) return [];
    const q = headerFilter.trim().toLowerCase();
    const entries = Object.entries(inspect.headers);
    if (!q) return entries;
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q));
  }, [inspect, headerFilter]);

  const errorCount = consoleLogs.filter((l) => l.level === 'error').length;

  return (
    <div className="screen-grid layout-tester" data-expanded={expanded ? 'true' : 'false'}>
      {/* LEFT / MAIN: Live Localhost & Web Device Stage */}
      <div className="tile flex min-h-0 flex-col gap-1.5">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#22d3ee] via-[#34d399] to-[#a78bfa]" />

        {/* Omnibar Row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadSite(urlInput);
          }}
          className="flex items-center gap-1.5"
        >
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-[#b3e5df36] bg-[#0a151c] px-2 focus-within:border-[#88f1d1]">
            {parsedTarget.isLocal ? (
              <span
                className="font-mono-tech flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase"
                style={{
                  background:
                    sessionInfo?.reachable
                      ? 'rgba(136,241,209,0.16)'
                      : 'rgba(251,191,36,0.18)',
                  color: sessionInfo?.reachable ? '#88f1d1' : '#fbbf24',
                }}
              >
                <Radio className="h-2.5 w-2.5" />
                {parsedTarget.localPort ? `:${parsedTarget.localPort}` : 'LOCAL'}
              </span>
            ) : (
              <Lock className="h-3 w-3 shrink-0 text-[#88f1d1]" />
            )}

            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              spellCheck={false}
              aria-label="Localhost port or website URL"
              placeholder="localhost:3000, :5173, or https://app.com"
              className="font-mono-tech min-w-0 flex-1 bg-transparent text-[9.5px] text-[#effaf7] outline-none placeholder:text-[#78959e]"
            />
          </div>

          <button
            type="submit"
            disabled={inspecting || bridging}
            className="flex h-7 shrink-0 items-center gap-1 rounded-xl bg-[#88f1d1] px-2.5 text-[9px] font-extrabold text-[#08221c] disabled:opacity-50"
          >
            {inspecting || bridging ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {bridging ? 'TUNNEL…' : 'LOAD'}
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setBugPinMode((v) => {
                if (v) setBugPin(null);
                return !v;
              });
            }}
            aria-label="Point at UI bug and send to Antigravity"
            aria-pressed={bugPinMode}
            title="Point at UI bug and tell Antigravity"
            className="flex h-7 shrink-0 items-center gap-1 rounded-xl border px-2 text-[8.5px] font-extrabold"
            style={{
              background: bugPinMode ? 'rgba(255,93,108,0.22)' : '#bcfff20d',
              borderColor: bugPinMode ? '#ff5d6c' : '#b3e5df36',
              color: bugPinMode ? '#ff5d6c' : '#effaf7',
            }}
          >
            <Sparkles className="h-3 w-3" />
            {bugPinMode ? 'PIN ON' : 'UI BUG'}
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? 'Show DevTools inspector' : 'Expand preview stage'}
            aria-pressed={expanded}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[#effaf7]"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5 text-[#88f1d1]" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open preview in browser"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[#effaf7]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </form>

        {/* Live Detected Dev Ports + Viewport Toolbar */}
        <div className="flex items-center justify-between gap-1.5">
          <div className={styles.portStrip}>
            {/* Active detected localhost ports from Mac/PC */}
            {webDevPorts.map((p) => {
              const active = parsedTarget.isLocal && parsedTarget.localPort === p.port;
              return (
                <button
                  key={p.port}
                  type="button"
                  onClick={() => void loadSite(`http://localhost:${p.port}`)}
                  className="font-mono-tech flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-extrabold"
                  style={{
                    background: active ? 'rgba(52,211,153,0.22)' : 'rgba(52,211,153,0.08)',
                    borderColor: active ? '#34d399' : 'rgba(52,211,153,0.3)',
                    color: '#34d399',
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
                  :{p.port}
                  <span className="text-[7.5px] text-emerald-200/75">{p.process.slice(0, 8)}</span>
                </button>
              );
            })}

            {/* Quick common dev ports when none auto-detected yet */}
            {webDevPorts.length === 0 &&
              [3000, 5173].map((port) => {
                const active = parsedTarget.isLocal && parsedTarget.localPort === port;
                return (
                  <button
                    key={port}
                    type="button"
                    onClick={() => void loadSite(`http://localhost:${port}`)}
                    className="font-mono-tech shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold"
                    style={{
                      background: active ? 'rgba(34,211,238,0.18)' : 'rgba(255,255,255,0.04)',
                      borderColor: active ? '#22d3ee' : 'rgba(255,255,255,0.09)',
                      color: active ? '#22d3ee' : '#94a3b8',
                    }}
                  >
                    :{port}
                  </button>
                );
              })}

            {/* Viewport Device Buttons */}
            {VIEWPORTS.map(({ id, label, Icon }) => {
              const active = vpId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setVpId(id);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase"
                  style={{
                    background: active ? 'rgba(136,241,209,0.18)' : '#bcfff20d',
                    borderColor: active ? '#88f1d1' : '#b3e5df36',
                    color: active ? '#88f1d1' : '#9cb4bb',
                  }}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {!isFluid && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRotated((r) => !r);
              }}
              aria-label="Rotate viewport orientation"
              className="font-mono-tech flex shrink-0 items-center gap-1 rounded-full border border-[#b3e5df36] bg-[#bcfff20d] px-2 py-0.5 text-[8px] font-bold text-[#effaf7]"
            >
              <RotateCw className="h-2.5 w-2.5 text-[#88f1d1]" />
              {vpW}×{vpH}
              <span className="text-[#9cb4bb]">{Math.round(scale * 100)}%</span>
            </button>
          )}
        </div>

        {/* Dynamic Auto-Scaled Responsive Device Stage */}
        <div ref={stageRef} className={styles.deviceStage}>
          {bridging ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#22d3ee]" />
              <div className="text-[11px] font-extrabold text-white">
                Opening Secure HTTPS Bridge to{' '}
                <span className="font-mono-tech text-[#34d399]">
                  {parsedTarget.isLocal ? `localhost:${parsedTarget.localPort}` : 'target'}
                </span>
              </div>
              <div className="max-w-[280px] text-[9px] text-zinc-400">
                Forwarding Vite/Next.js Host headers, stripping X-Frame-Options &amp; enabling live HMR…
              </div>
            </div>
          ) : parsedTarget.isLocal && !isConnected && !resolvedFrameUrl ? (
            <div className="flex max-w-[310px] flex-col items-center gap-2 rounded-2xl border border-[#fbbf24]/30 bg-black/80 p-4 text-center">
              <Wifi className="h-6 w-6 text-[#fbbf24]" />
              <div className="text-[11px] font-extrabold text-white">
                Pair Mac / PC Bridge for Localhost Preview
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-400">
                On iPhone, <code className="font-mono-tech text-[#22d3ee]">localhost</code> refers to the phone itself.
                Pair your computer bridge once and DevDeck automatically tunnels{' '}
                <code className="font-mono-tech text-[#34d399]">npm run dev</code> over HTTPS with live hot-reload.
              </p>
              <button
                type="button"
                onClick={() => void loadSite('https://helper-nu-swart.vercel.app')}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1 text-[8.5px] font-extrabold text-zinc-200"
              >
                Test Public URL Instead
              </button>
            </div>
          ) : waitingForLocalServer ? (
            <div className="flex max-w-[330px] flex-col items-center gap-2 rounded-2xl border border-[#22d3ee]/30 bg-black/85 p-4 text-center">
              <div className="flex items-center gap-1.5 text-[#fbbf24]">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-mono-tech text-[10.5px] font-extrabold">
                  Waiting for localhost:{parsedTarget.localPort}…
                </span>
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-300">
                No server is listening on port <b>{parsedTarget.localPort}</b> yet. Run{' '}
                <code className="font-mono-tech rounded bg-white/10 px-1 text-[#22d3ee]">npm run dev</code> — this
                screen will auto-connect the instant your server starts!
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={startProjectDevServer}
                  className="flex items-center gap-1 rounded-lg bg-[#34d399] px-2.5 py-1 text-[8.5px] font-extrabold text-[#04130c]"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Start npm run dev
                </button>
                {webDevPorts.map((p) => (
                  <button
                    key={p.port}
                    type="button"
                    onClick={() => void loadSite(`http://localhost:${p.port}`)}
                    className="font-mono-tech rounded-lg border border-[#22d3ee]/40 bg-[#22d3ee]/15 px-2.5 py-1 text-[8.5px] font-extrabold text-[#22d3ee]"
                  >
                    Switch to :{p.port} ({p.process})
                  </button>
                ))}
              </div>
            </div>
          ) : resolvedFrameUrl ? (
            <div
              className={`relative flex flex-col overflow-hidden bg-[#0b0e14] ${
                vp.kind === 'mobile' ? styles.bezelMobile : styles.bezelDesktop
              }`}
              style={{
                width: scaledW,
                height: scaledH + chromeHeight,
              }}
            >
              {/* Realistic Device Top Bezel Chrome */}
              {vp.kind === 'mobile' && !rotated && (
                <div className="flex h-[14px] shrink-0 items-center justify-center bg-[#090c12]">
                  <span className="h-[4px] w-10 rounded-full bg-zinc-700/80" />
                </div>
              )}
              {vp.kind === 'desktop' && (
                <div className="flex h-[18px] shrink-0 items-center justify-between border-b border-white/10 bg-[#111622] px-2">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#ff5f56]" />
                    <span className="h-2 w-2 rounded-full bg-[#ffbd2e]" />
                    <span className="h-2 w-2 rounded-full bg-[#27c93f]" />
                  </div>
                  <span className="font-mono-tech max-w-[70%] truncate text-[7.5px] text-zinc-400">
                    {inspect?.meta.title || targetUrl}
                  </span>
                  <span className="text-[7px] text-zinc-500">
                    {sessionInfo?.mode === 'https-tunnel' ? 'TUNNEL' : 'LIVE'}
                  </span>
                </div>
              )}

              <div className="relative flex-1 overflow-hidden bg-white">
                <iframe
                  key={frameKey}
                  title="Web Studio Live Viewport"
                  src={resolvedFrameUrl}
                  allow="local-network; loopback-network; clipboard-read; clipboard-write"
                  style={{
                    width: vpW,
                    height: vpH,
                    transform: isFluid ? undefined : `scale(${scale})`,
                    transformOrigin: 'top left',
                    border: 0,
                  }}
                />
                {bugPinMode && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Tap where the UI bug is"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                      soundEngine.playClick();
                      setBugPin({
                        xPct: Math.round(xPct * 100),
                        yPct: Math.round(yPct * 100),
                        pxX: Math.round(xPct * vpW),
                        pxY: Math.round(yPct * vpH),
                      });
                    }}
                    className="absolute inset-0 z-20 cursor-crosshair bg-[#ff5d6c]/[0.06]"
                  >
                    {bugPin ? (
                      <span
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#ff5d6c] px-1.5 py-0.5 font-mono-tech text-[9px] font-extrabold text-white shadow-lg"
                        style={{ left: `${bugPin.xPct}%`, top: `${bugPin.yPct}%` }}
                      >
                        ⊕ {bugPin.pxX},{bugPin.pxY}
                      </span>
                    ) : (
                      <span className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/85 px-2.5 py-1 font-mono-tech text-[9px] font-bold text-[#ff5d6c]">
                        Tap the broken element on screen
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        {bugPinMode && bugPin && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bugNote.trim() || sendingBug) return;
              setSendingBug(true);
              soundEngine.playClick();
              const prompt = [
                `Fix the UI bug I pointed at on ${targetUrl}`,
                `Viewport: ${vpW}x${vpH} CSS px · Marked point: (${bugPin.pxX}, ${bugPin.pxY}) (${bugPin.xPct}%, ${bugPin.yPct}%) from top-left`,
                `User note: ${bugNote.trim()}`,
              ].join('\n');
              deck.sendEvent({
                type: 'antigravity:prompt',
                payload: { requestId: makeRequestId(), text: prompt, submit: true },
              });
              deck.showToast(true, `Sent UI bug at (${bugPin.pxX}, ${bugPin.pxY}) to Antigravity`);
              setBugNote('');
              setBugPin(null);
              setBugPinMode(false);
              setSendingBug(false);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-[#ff5d6c]/40 bg-[#ff5d6c]/10 px-2 py-1.5"
          >
            <input
              value={bugNote}
              onChange={(e) => setBugNote(e.target.value)}
              placeholder={`Describe bug at (${bugPin.pxX}, ${bugPin.pxY})… e.g. الزرار بيطلع بره الشاشة`}
              className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none placeholder:text-zinc-400"
            />
            <button
              type="submit"
              disabled={!bugNote.trim() || sendingBug}
              className="shrink-0 rounded-lg bg-[#ff5d6c] px-2.5 py-1 text-[9px] font-extrabold text-white disabled:opacity-40"
            >
              Send to Antigravity
            </button>
          </form>
        )}
      </div>

      {/* RIGHT: Pro DevTools Inspector (Hidden when Full-Stage Expanded) */}
      {!expanded && (
        <div className="tile flex min-h-0 flex-col gap-2">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />

          {/* Accessible Single-Row Tablist with Underline Shape Indicator */}
          <div className="flex items-center justify-between gap-1.5">
            <div className={styles.tabRow} role="tablist" aria-label="Web Studio DevTools">
              {(
                [
                  ['audit', 'Audit', ShieldCheck, '#88f1d1'],
                  ['console', errorCount > 0 ? `Console (${errorCount})` : 'Console', Terminal, errorCount > 0 ? '#ff5d6c' : '#fde68a'],
                  ['headers', 'Headers', Globe, '#7dd3fc'],
                  ['share', 'Share QR', QrCode, '#88f1d1'],
                ] as const
              ).map(([id, label, Icon, accent]) => (
                <button
                  key={id}
                  id={`${baseId}-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={rightTab === id}
                  style={{ '--tab-accent': accent } as CSSProperties}
                  onClick={() => {
                    soundEngine.playClick();
                    setRightTab(id);
                  }}
                  className={styles.tabBtn}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {inspect && inspect.status > 0 && (
              <span
                className="font-mono-tech shrink-0 rounded-full px-2 py-0.5 text-[8px] font-extrabold"
                style={{
                  background: inspect.status < 400 ? 'rgba(52,211,153,0.18)' : 'rgba(255,93,108,0.2)',
                  color: inspect.status < 400 ? '#34d399' : '#ff5d6c',
                }}
              >
                {inspect.status} · {inspect.elapsedMs}ms
              </span>
            )}
          </div>

          {/* PANEL 1: Live Audit, Meta & Social Preview */}
          <div
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-audit`}
            hidden={rightTab !== 'audit'}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="deck-scroll flex h-full flex-col gap-2 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#06080e] p-2.5 text-[9.5px]">
              {/* Connection Mode Strip */}
              <div className="flex flex-wrap items-center justify-between gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1">
                <span className="flex items-center gap-1 font-bold text-zinc-200">
                  <Sparkles className="h-3 w-3 text-[#22d3ee]" />
                  {sessionInfo?.mode === 'https-tunnel'
                    ? 'HTTPS Bridge Tunnel (HMR Active)'
                    : sessionInfo?.mode === 'lan-proxy'
                      ? 'LAN Reverse Proxy'
                      : 'Direct Origin'}
                </span>
                <span className="font-mono-tech text-[8px] text-zinc-400">
                  {formatBytes(inspect?.sizeBytes)}
                </span>
              </div>

              {inspect?.error ? (
                <div className="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 p-2 text-[9px] text-[#fde68a]">
                  {inspect.error}
                </div>
              ) : auditChecks.length > 0 ? (
                <>
                  {/* Automated Health Checks */}
                  <div className="space-y-1">
                    {auditChecks.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-start gap-1.5 rounded-lg border border-white/[0.05] bg-black/50 px-2 py-1.5"
                      >
                        {item.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[#34d399]" />
                        ) : (
                          <AlertTriangle
                            className="mt-0.5 h-3 w-3 shrink-0"
                            style={{ color: item.warn ? '#fbbf24' : '#ff5d6c' }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[8.5px] font-extrabold text-zinc-200">{item.label}</div>
                          <div className="break-words text-[8px] text-zinc-400">{item.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* OpenGraph / Social Share Card */}
                  {(inspect?.meta.ogTitle || inspect?.meta.title || inspect?.meta.ogImage) && (
                    <div className="rounded-lg border border-[#a78bfa]/25 bg-black/65 p-2">
                      <div className="mb-1 text-[7.5px] font-extrabold tracking-wider text-[#a78bfa] uppercase">
                        Social / Link Preview
                      </div>
                      {inspect.meta.ogImage && (
                        <img
                          src={inspect.meta.ogImage}
                          alt="OpenGraph preview"
                          className="mb-1.5 max-h-20 w-full rounded object-cover"
                        />
                      )}
                      <div className="truncate text-[9.5px] font-extrabold text-white">
                        {inspect.meta.ogTitle || inspect.meta.title}
                      </div>
                      {(inspect.meta.ogDescription || inspect.meta.description) && (
                        <div className="line-clamp-2 text-[8px] text-zinc-400">
                          {inspect.meta.ogDescription || inspect.meta.description}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid flex-1 place-items-center text-center text-zinc-500">
                  Enter a localhost port (e.g. :3000 or :5173) or public URL and tap LOAD.
                </div>
              )}
            </div>
          </div>

          {/* PANEL 2: Live Mobile JS Console & Errors */}
          <div
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-console`}
            hidden={rightTab !== 'console'}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex h-full flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-[#05070c] p-2">
              <div className="flex items-center justify-between text-[8px] text-zinc-400">
                <span>
                  {sessionInfo
                    ? 'Streaming console.error / warn & uncaught exceptions from preview'
                    : 'Pair bridge & tunnel site to capture live runtime console logs'}
                </span>
                {consoleLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConsoleLogs([])}
                    className="flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-zinc-300 hover:text-white"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Clear
                  </button>
                )}
              </div>

              <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-y-auto text-[8.5px]">
                {consoleLogs.length === 0 ? (
                  <div className="grid h-full place-items-center text-center text-zinc-500">
                    <div className="space-y-1">
                      <CheckCircle2 className="mx-auto h-5 w-5 text-[#34d399]/70" />
                      <div>Zero runtime console errors captured</div>
                    </div>
                  </div>
                ) : (
                  consoleLogs.map((entry) => {
                    const color =
                      entry.level === 'error'
                        ? '#ff5d6c'
                        : entry.level === 'warn'
                          ? '#fbbf24'
                          : '#93c5fd';
                    return (
                      <div
                        key={entry.id}
                        className="rounded border border-white/[0.05] bg-black/70 px-2 py-1 break-words"
                        style={{ borderLeftWidth: 2.5, borderLeftColor: color, color }}
                      >
                        <span className="mr-1.5 text-[7.5px] opacity-65">
                          {new Date(entry.ts).toLocaleTimeString([], { hour12: false })}
                        </span>
                        {entry.text}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* PANEL 3: Filterable HTTP Response Headers */}
          <div
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-headers`}
            hidden={rightTab !== 'headers'}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex h-full flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-[#06080e] p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-zinc-500" />
                <input
                  type="search"
                  value={headerFilter}
                  onChange={(e) => setHeaderFilter(e.target.value)}
                  placeholder="Filter HTTP headers…"
                  aria-label="Filter HTTP headers"
                  className="font-mono-tech h-6 w-full rounded-lg border border-white/10 bg-black pr-2 pl-6 text-[8.5px] text-white outline-none"
                />
              </div>

              <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-y-auto text-[8.5px]">
                {filteredHeaders.length === 0 ? (
                  <div className="grid h-full place-items-center text-zinc-500">
                    {inspect ? 'No matching headers' : 'Load a URL to inspect live HTTP headers'}
                  </div>
                ) : (
                  filteredHeaders.map(([k, v]) => (
                    <div key={k} className="flex gap-2 border-b border-white/[0.05] pb-1">
                      <span className="shrink-0 font-bold text-[#22d3ee]">{k}:</span>
                      <span className="break-all text-zinc-300">{v}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* PANEL 4: Public HTTPS Tunnel & LAN QR Share */}
          <div
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-share`}
            hidden={rightTab !== 'share'}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-[#06080e] p-2.5 text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=0a151c&color=88f1d1&data=${encodeURIComponent(shareUrl)}`}
                alt="QR code to open preview URL on another device"
                width={116}
                height={116}
                className="rounded-xl border border-[#88f1d1]/35 p-1"
              />
              <div className="font-mono-tech max-w-full truncate px-2 text-[8.5px] font-bold text-[#34d399]">
                {shareUrl}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    void navigator.clipboard?.writeText(shareUrl);
                    setCopiedShare(true);
                    window.setTimeout(() => setCopiedShare(false), 1800);
                    deck.showToast(true, 'Preview link copied');
                  }}
                  className="flex items-center gap-1 rounded-lg bg-[#22d3ee]/20 px-2.5 py-1 text-[8.5px] font-extrabold text-[#22d3ee]"
                >
                  {copiedShare ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedShare ? 'Copied!' : 'Copy Share Link'}
                </button>
              </div>
              <p className="max-w-[240px] text-[8px] text-zinc-400">
                {sessionInfo?.tunnelUrl
                  ? 'Public HTTPS tunnel active — scan on any phone (Wi-Fi or 5G) to test your localhost app!'
                  : 'Scan with any device on the same network to open this preview.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
