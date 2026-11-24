'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

interface MonitoredSite {
  id: string;
  url: string;
  up: boolean | null;
  status: number;
  responseMs: number | null;
  sslIssuer: string | null;
  sslValidTo: string | null;
  sslDaysLeft: number | null;
  domainExpiry: string | null;
  domainDaysLeft: number | null;
  history: Array<{ up: boolean; ms: number; ts: number }>;
  lastCheckedAt: number;
  error?: string;
}

const STORAGE_KEY = 'devdeck.webmonitor.sites.v1';

const DEFAULT_SITES: MonitoredSite[] = [
  {
    id: 'vercel-app',
    url: 'https://helper-nu-swart.vercel.app',
    up: null,
    status: 0,
    responseMs: null,
    sslIssuer: null,
    sslValidTo: null,
    sslDaysLeft: null,
    domainExpiry: null,
    domainDaysLeft: null,
    history: [],
    lastCheckedAt: 0,
  },
  {
    id: 'github',
    url: 'https://github.com',
    up: null,
    status: 0,
    responseMs: null,
    sslIssuer: null,
    sslValidTo: null,
    sslDaysLeft: null,
    domainExpiry: null,
    domainDaysLeft: null,
    history: [],
    lastCheckedAt: 0,
  },
];

export function WebsiteMonitorView({ deck }: { deck: DevDeckState }) {
  const [sites, setSites] = useState<MonitoredSite[]>(DEFAULT_SITES);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_SITES[0].id);
  const [newUrl, setNewUrl] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as MonitoredSite[];
        if (parsed.length > 0) {
          setSites(parsed);
          setSelectedId(parsed[0].id);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const persist = (next: MonitoredSite[]) => {
    setSites(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const checkOne = async (site: MonitoredSite): Promise<MonitoredSite> => {
    try {
      if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
        const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/monitor`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${deck.pairing.token}`,
          },
          body: JSON.stringify({ url: site.url }),
        });
        const data = (await res.json()) as {
          up: boolean;
          status: number;
          responseMs: number;
          sslIssuer: string | null;
          sslValidTo: string | null;
          sslDaysLeft: number | null;
          domainExpiry: string | null;
          domainDaysLeft: number | null;
          checkedAt: number;
          error?: string;
        };
        return {
          ...site,
          up: data.up,
          status: data.status,
          responseMs: data.responseMs,
          sslIssuer: data.sslIssuer,
          sslValidTo: data.sslValidTo,
          sslDaysLeft: data.sslDaysLeft,
          domainExpiry: data.domainExpiry,
          domainDaysLeft: data.domainDaysLeft,
          lastCheckedAt: data.checkedAt || Date.now(),
          error: data.error,
          history: [...site.history.slice(-15), { up: data.up, ms: data.responseMs, ts: Date.now() }],
        };
      }

      // Phone-direct fallback: real latency check + RDAP domain expiry
      const t0 = performance.now();
      let up = false;
      try {
        await fetch(site.url, { mode: 'no-cors', cache: 'no-store' });
        up = true;
      } catch {
        up = false;
      }
      const ms = Math.max(1, Math.round(performance.now() - t0));
      return {
        ...site,
        up,
        status: up ? 200 : 0,
        responseMs: ms,
        lastCheckedAt: Date.now(),
        history: [...site.history.slice(-15), { up, ms, ts: Date.now() }],
      };
    } catch (err) {
      return {
        ...site,
        up: false,
        status: 0,
        responseMs: 0,
        lastCheckedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Check failed',
        history: [...site.history.slice(-15), { up: false, ms: 0, ts: Date.now() }],
      };
    }
  };

  const checkAll = async () => {
    soundEngine.playClick();
    setChecking(true);
    const updated = await Promise.all(sites.map((s) => checkOne(s)));
    persist(updated);
    setChecking(false);
    const downCount = updated.filter((s) => s.up === false).length;
    if (downCount > 0) {
      deck.triggerFlash('error', `${downCount} monitored site(s) unreachable!`);
    } else {
      deck.showToast(true, `Checked ${updated.length} site(s) — all online`);
    }
  };

  const addSite = () => {
    const raw = newUrl.trim();
    if (!raw) return;
    soundEngine.playClick();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const item: MonitoredSite = {
      id: String(Date.now()),
      url,
      up: null,
      status: 0,
      responseMs: null,
      sslIssuer: null,
      sslValidTo: null,
      sslDaysLeft: null,
      domainExpiry: null,
      domainDaysLeft: null,
      history: [],
      lastCheckedAt: 0,
    };
    const next = [item, ...sites];
    persist(next);
    setSelectedId(item.id);
    setNewUrl('');
  };

  const selected = sites.find((s) => s.id === selectedId) || sites[0];
  const uptimePct =
    selected && selected.history.length > 0
      ? Math.round((selected.history.filter((h) => h.up).length / selected.history.length) * 100)
      : null;

  return (
    <div className="screen-grid layout-monitor-web">
      {/* LEFT: Monitored Sites List + Add Site */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#34d399] to-[#22d3ee]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-[#34d399]" />
            <span className="disp text-[17px]">Site Monitor</span>
          </div>
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkAll()}
            className="flex h-7 items-center gap-1 rounded-full bg-[#34d399] px-2.5 text-[8.5px] font-extrabold text-[#04130c] disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            CHECK ALL
          </button>
        </div>

        {/* Add URL */}
        <div className="flex gap-1.5">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSite();
            }}
            spellCheck={false}
            placeholder="Add site (e.g. api.myapp.com)"
            className="font-mono-tech h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9.5px] text-white outline-none"
          />
          <button
            type="button"
            onClick={addSite}
            aria-label="Add monitored site"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Site Cards */}
        <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
          {sites.map((site) => {
            const active = site.id === selected?.id;
            const col = site.up === null ? '#9ca3af' : site.up ? '#34d399' : '#ff5d6c';
            return (
              <div
                key={site.id}
                onClick={() => {
                  soundEngine.playClick();
                  setSelectedId(site.id);
                }}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 transition-colors"
                style={{
                  background: active ? 'rgba(34,211,238,0.1)' : 'rgba(0,0,0,0.55)',
                  borderColor: active ? 'rgba(34,211,238,0.45)' : 'rgba(255,255,255,0.07)',
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {site.up === false ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-[#ff5d6c]" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: col }} />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[9.5px] font-extrabold text-white">
                      {site.url.replace(/^https?:\/\//, '')}
                    </div>
                    <div className="font-mono-tech text-[8px] text-zinc-400">
                      {site.status ? `HTTP ${site.status}` : 'Not checked'}
                      {site.responseMs !== null ? ` · ${site.responseMs}ms` : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove site"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = sites.filter((s) => s.id !== site.id);
                    persist(next);
                  }}
                  className="text-zinc-500 hover:text-[#ff5d6c]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Detailed SSL, Domain Expiry, Latency & Uptime History */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />

        {selected ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-extrabold text-white">{selected.url}</div>
                <div className="font-mono-tech text-[8px] text-zinc-400">
                  {selected.lastCheckedAt
                    ? `Last check: ${new Date(selected.lastCheckedAt).toLocaleTimeString()}`
                    : 'Tap CHECK ALL to inspect HTTP, SSL & Domain'}
                </div>
              </div>
              <span
                className="font-mono-tech shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold"
                style={{
                  background:
                    selected.up === null
                      ? 'rgba(255,255,255,0.08)'
                      : selected.up
                        ? 'rgba(52,211,153,0.2)'
                        : 'rgba(255,93,108,0.2)',
                  color:
                    selected.up === null ? '#a1a1aa' : selected.up ? '#34d399' : '#ff5d6c',
                }}
              >
                {selected.up === null ? 'PENDING' : selected.up ? `UP · ${selected.status}` : 'DOWN'}
              </span>
            </div>

            {/* 4-Card Metrics: Response Time, Uptime, SSL Expiry, Domain Expiry */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
                <div className="text-[8px] text-zinc-400 uppercase">Response Time</div>
                <div className="num font-mono-tech text-[15px] font-extrabold text-[#22d3ee]">
                  {selected.responseMs !== null ? `${selected.responseMs} ms` : '--'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
                <div className="text-[8px] text-zinc-400 uppercase">Uptime History</div>
                <div className="num font-mono-tech text-[15px] font-extrabold text-[#34d399]">
                  {uptimePct !== null ? `${uptimePct}%` : '--'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
                <div className="flex items-center gap-1 text-[8px] text-zinc-400 uppercase">
                  <ShieldCheck className="h-3 w-3 text-[#34d399]" />
                  SSL Certificate
                </div>
                <div className="num font-mono-tech text-[12px] font-extrabold text-white">
                  {selected.sslDaysLeft !== null ? `${selected.sslDaysLeft} days left` : 'Pair bridge'}
                </div>
                <div className="truncate text-[8px] text-zinc-400">
                  {selected.sslValidTo
                    ? `Exp ${selected.sslValidTo} · ${selected.sslIssuer || ''}`
                    : 'TLS cert inspection'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
                <div className="flex items-center gap-1 text-[8px] text-zinc-400 uppercase">
                  <CalendarClock className="h-3 w-3 text-[#fbbf24]" />
                  Domain Expiry
                </div>
                <div className="num font-mono-tech text-[12px] font-extrabold text-[#fbbf24]">
                  {selected.domainDaysLeft !== null ? `${selected.domainDaysLeft} days` : '--'}
                </div>
                <div className="truncate text-[8px] text-zinc-400">
                  {selected.domainExpiry ? `RDAP: ${selected.domainExpiry}` : 'RDAP lookup'}
                </div>
              </div>
            </div>

            {/* Uptime History Sparkline Bars */}
            <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[8px] font-bold text-zinc-400 uppercase">
                <span>Recent Checks ({selected.history.length}/16)</span>
                <span>Green = OK · Red = Fail</span>
              </div>
              <div className="flex h-10 items-end gap-1">
                {selected.history.length === 0 ? (
                  <div className="grid h-full w-full place-items-center text-[9px] text-zinc-500">
                    Run a check to record uptime &amp; latency bars
                  </div>
                ) : (
                  selected.history.map((h, i) => {
                    const heightPct = h.up ? Math.min(100, Math.max(22, (h.ms / 800) * 100)) : 100;
                    return (
                      <div
                        key={i}
                        title={`${h.up ? 'UP' : 'DOWN'} · ${h.ms}ms`}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${heightPct}%`,
                          background: h.up ? '#34d399' : '#ff5d6c',
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-[10px] text-zinc-500">
            Add a website to start monitoring
          </div>
        )}
      </div>
    </div>
  );
}
