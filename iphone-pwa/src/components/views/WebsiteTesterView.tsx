'use client';

import { useMemo, useState } from 'react';
import {
  ExternalLink,
  FileCode2,
  Globe,
  Laptop,
  Loader2,
  Monitor,
  QrCode,
  RefreshCw,
  RotateCw,
  Smartphone,
  Tablet,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

interface InspectData {
  url: string;
  finalUrl: string;
  status: number;
  elapsedMs: number;
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

const VIEWPORTS = [
  { id: 'mobile', label: 'iPhone', w: 390, h: 844, Icon: Smartphone },
  { id: 'tablet', label: 'iPad', w: 768, h: 1024, Icon: Tablet },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800, Icon: Laptop },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900, Icon: Monitor },
] as const;

export function WebsiteTesterView({ deck }: { deck: DevDeckState }) {
  const [urlInput, setUrlInput] = useState('https://helper-nu-swart.vercel.app');
  const [activeUrl, setActiveUrl] = useState('https://helper-nu-swart.vercel.app');
  const [vpId, setVpId] = useState<(typeof VIEWPORTS)[number]['id']>('mobile');
  const [rotated, setRotated] = useState(false);
  const [rightTab, setRightTab] = useState<'meta' | 'headers' | 'qr'>('meta');
  const [inspecting, setInspecting] = useState(false);
  const [inspect, setInspect] = useState<InspectData | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const vp = VIEWPORTS.find((v) => v.id === vpId) || VIEWPORTS[0];
  const vpW = rotated ? vp.h : vp.w;
  const vpH = rotated ? vp.w : vp.h;

  // Convert localhost/127.0.0.1 to real LAN IP for scannable local dev QR code
  const qrUrl = useMemo(() => {
    const lanIp = deck.hello?.lanIp;
    if (!lanIp) return activeUrl;
    return activeUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `$1${lanIp}`);
  }, [activeUrl, deck.hello?.lanIp]);

  const runInspect = async (targetUrl?: string) => {
    soundEngine.playClick();
    const raw = (targetUrl ?? urlInput).trim();
    if (!raw) return;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setActiveUrl(normalized);
    setFrameKey((k) => k + 1);
    setInspecting(true);

    try {
      if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
        const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/inspect`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${deck.pairing.token}`,
          },
          body: JSON.stringify({ url: normalized }),
        });
        const data = (await res.json()) as InspectData;
        setInspect(data);
      } else {
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
    } catch (err) {
      setInspect({
        url: normalized,
        finalUrl: normalized,
        status: 0,
        elapsedMs: 0,
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
            ? `${err.message} (Pair Mac/PC bridge to inspect cross-origin headers & metadata)`
            : 'Inspection failed',
      });
    } finally {
      setInspecting(false);
    }
  };

  // Fit simulated viewport inside preview box cleanly
  const scale = Math.min(1, 320 / vpW, 210 / vpH);

  return (
    <div className="screen-grid layout-tester">
      {/* LEFT: Live Responsive Viewport Preview */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#22d3ee] to-[#a78bfa]" />

        {/* URL Bar */}
        <div className="flex items-center gap-1.5">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runInspect();
            }}
            spellCheck={false}
            placeholder="https://yoursite.com or http://localhost:3000"
            className="font-mono-tech h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9.5px] text-white outline-none focus:border-[#22d3ee]"
          />
          <button
            type="button"
            disabled={inspecting}
            onClick={() => void runInspect()}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[#22d3ee] px-2.5 text-[9px] font-extrabold text-[#041318]"
          >
            {inspecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            TEST
          </button>
          <a
            href={activeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open website externally"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-zinc-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Viewport Presets + Rotate */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1 overflow-x-auto">
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
                    background: active ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                    borderColor: active ? '#22d3ee' : 'rgba(255,255,255,0.08)',
                    color: active ? '#22d3ee' : '#9ca3af',
                  }}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setRotated((r) => !r);
            }}
            className="font-mono-tech flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[8px] font-bold text-zinc-300"
          >
            <RotateCw className="h-2.5 w-2.5" />
            {vpW}×{vpH}
          </button>
        </div>

        {/* Scaled Viewport Frame */}
        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#06070b] p-2">
          <div
            className="relative overflow-hidden rounded-lg border border-[#22d3ee]/40 bg-white shadow-2xl"
            style={{
              width: Math.round(vpW * scale),
              height: Math.round(vpH * scale),
            }}
          >
            <iframe
              key={frameKey}
              title="Responsive Preview"
              src={activeUrl}
              style={{
                width: vpW,
                height: vpH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                border: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* RIGHT: Page Metadata | HTTP Headers | Local Dev QR Code */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            {(
              [
                ['meta', 'Metadata', FileCode2, '#a78bfa'],
                ['headers', 'HTTP Headers', Globe, '#22d3ee'],
                ['qr', 'Dev QR', QrCode, '#34d399'],
              ] as const
            ).map(([id, label, Icon, color]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRightTab(id);
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: rightTab === id ? '#1f222c' : 'transparent',
                  color: rightTab === id ? color : '#7c8190',
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {inspect && inspect.status > 0 && (
            <span className="font-mono-tech rounded-full bg-[#34d399]/20 px-2 py-0.5 text-[8px] font-extrabold text-[#34d399]">
              HTTP {inspect.status} · {inspect.elapsedMs}ms
            </span>
          )}
        </div>

        {rightTab === 'meta' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[9.5px]">
            {!inspect ? (
              <div className="grid h-full place-items-center text-zinc-500">
                Tap TEST to inspect page title, OpenGraph tags, viewport &amp; headers.
              </div>
            ) : inspect.error ? (
              <div className="text-[#ff5d6c]">{inspect.error}</div>
            ) : (
              (
                [
                  ['Title', inspect.meta.title],
                  ['Description', inspect.meta.description],
                  ['Viewport', inspect.meta.viewport],
                  ['Canonical', inspect.meta.canonical],
                  ['og:title', inspect.meta.ogTitle],
                  ['og:description', inspect.meta.ogDescription],
                  ['og:image', inspect.meta.ogImage],
                  ['Charset', inspect.meta.charset],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="border-b border-white/[0.05] pb-1">
                  <div className="text-[8px] font-extrabold text-[#a78bfa] uppercase">{k}</div>
                  <div className="break-all text-zinc-200">{v || '—'}</div>
                </div>
              ))
            )}
          </div>
        )}

        {rightTab === 'headers' && (
          <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[9px]">
            {!inspect || Object.keys(inspect.headers).length === 0 ? (
              <div className="grid h-full place-items-center text-zinc-500">
                Tap TEST to load live HTTP response headers.
              </div>
            ) : (
              Object.entries(inspect.headers).map(([k, v]) => (
                <div key={k} className="flex gap-2 border-b border-white/[0.05] pb-1">
                  <span className="shrink-0 font-bold text-[#22d3ee]">{k}:</span>
                  <span className="break-all text-zinc-300">{v}</span>
                </div>
              ))
            )}
          </div>
        )}

        {rightTab === 'qr' && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-[#06070b] p-3 text-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=06070b&color=22d3ee&data=${encodeURIComponent(qrUrl)}`}
              alt="Local dev QR code"
              width={136}
              height={136}
              className="rounded-xl border border-[#22d3ee]/35 p-1"
            />
            <div className="font-mono-tech max-w-full truncate text-[9px] font-bold text-[#34d399]">
              {qrUrl}
            </div>
            <div className="text-[8.5px] text-zinc-400">
              Scan with any phone on Wi-Fi to open this dev site (auto-maps localhost → LAN IP)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
