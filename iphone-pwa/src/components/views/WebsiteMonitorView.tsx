'use client';

import { bridgeRequest } from '@/lib/bridgeRequest';
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
  failureStage?:string;
  error?: string;
}

const STORAGE_KEY = 'devdeck.webmonitor.sites.v1';

type SiteEdit = { id: string; action: 'add' | 'remove'; url: string };
const queueKey = STORAGE_KEY + '.edits';
function pendingEdits(): SiteEdit[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey) || '[]');
  } catch {
    return [];
  }
}
function queueEdit(action: SiteEdit['action'], url: string) {
  localStorage.setItem(
    queueKey,
    JSON.stringify([...pendingEdits(), { id: String(Date.now()) + Math.random(), action, url }]),
  );
}
function cacheSites(rows: MonitoredSite[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {}
}

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

type WatchList = {
  initialized: boolean;
  sites: {
    url: string;
    result?: Partial<MonitoredSite> & { checkedAt: number };
    history: MonitoredSite['history'];
  }[];
};
function watchRows(list: WatchList) {
  return list.sites.map((s) => ({
    ...DEFAULT_SITES[0],
    up: null,
    ...s.result,
    id: s.url,
    url: s.url,
    history: s.history,
    lastCheckedAt: s.result?.checkedAt || 0,
  }));
}
export function WebsiteMonitorView({ deck }: { deck: DevDeckState }) {
  const [sites, setSites] = useState<MonitoredSite[]>(DEFAULT_SITES);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_SITES[0].id);
  const [newUrl, setNewUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    url: string;
    failedStage: string | null;
    phoneUp: boolean | null;
    stages: Record<'dns' | 'tcp' | 'tls' | 'http', { ok: boolean; ms: number; detail: string }>;
  } | null>(null);

  const diagnoseOutage = async (targetUrl: string) => {
    if (!targetUrl || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    soundEngine.playClick();
    setDiagBusy(true);
    try {
      const [bridgeRes, phoneUp] = await Promise.all([
        fetch(`${deck.bridgeBaseUrl}/api/monitor/diagnose`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${deck.pairing.token}`,
          },
          body: JSON.stringify({ url: targetUrl }),
        }).then((r) => r.json()),
        fetch(targetUrl, { mode: 'no-cors', cache: 'no-store' })
          .then(() => true)
          .catch(() => false),
      ]);
      if (bridgeRes?.ok && bridgeRes.stages) {
        setDiagResult({
          url: targetUrl,
          failedStage: bridgeRes.failedStage,
          phoneUp,
          stages: bridgeRes.stages,
        });
      }
    } catch {
      deck.showToast(false, 'Could not run 4-stage outage diagnostic');
    } finally {
      setDiagBusy(false);
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as MonitoredSite[];
        if (Array.isArray(parsed)) {
          setSites(parsed);
          setSelectedId(parsed[0]?.id || '');
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const [notifications, setNotifications] = useState(false);
  const { bridgeBaseUrl, pairing } = deck;
  const connected = deck.status === 'connected';
  useEffect(() => {
    if (!connected) return;
    let live = true;
    const bridge = { bridgeBaseUrl, pairing };
    const refresh = async () => {
      let list = await bridgeRequest<WatchList>(bridge, 'watch');
      if (!live) return;
      if (!list.initialized) {
        const saved = localStorage.getItem(STORAGE_KEY);
        const rows: MonitoredSite[] = saved ? JSON.parse(saved) : DEFAULT_SITES;
        list = await bridgeRequest<WatchList>(bridge, 'watch', {
          action: 'initialize',
          urls: rows.map((s) => s.url),
        });
      }
      for (const edit of pendingEdits()) {
        if (!live) return;
        list = await bridgeRequest<WatchList>(bridge, 'watch', { action: edit.action, urls: [edit.url] });
        localStorage.setItem(queueKey, JSON.stringify(pendingEdits().filter((item) => item.id !== edit.id)));
      }
      if (live) {
        const rows = watchRows(list);
        setSites(rows);
        cacheSites(rows);
      }
    };
    void refresh().catch((err) => {
      if (live) deck.showToast(false, err.message);
    });
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => reg?.pushManager?.getSubscription())
      .then((s) => {
        if (live) setNotifications(!!s);
      })
      .catch(() => {});
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bridgeBaseUrl, pairing, connected]);
  const editWatch = async (action: string, urls?: string[]) => {
    const list = await bridgeRequest<WatchList>(deck, 'watch', { action, urls });
    const rows = watchRows(list);
    setSites(rows);
    cacheSites(rows);
    return list;
  };
  const toggleNotifications = async () => {
    try {
      if (!('PushManager' in window) || !('Notification' in window))
        throw Error('Open DevDeck from your Home Screen to enable notifications');
      if (!notifications && (await Notification.requestPermission()) !== 'granted')
        throw Error('Notifications need permission in Settings');
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (notifications && subscription) {
        await bridgeRequest(deck, 'push-subscription', { subscription, remove: true });
        await subscription.unsubscribe();
        setNotifications(false);
        return;
      }
      const { key } = await bridgeRequest<{ key: string }>(deck, 'push-key');
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      subscription ||= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await bridgeRequest(deck, 'push-subscription', { subscription });
      setNotifications(true);
    } catch (e) {
      deck.showToast(false, (e as Error).message);
    }
  };
  const persist = (next: MonitoredSite[]) => {
    setSites(next);
    cacheSites(next);
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
          failureStage?:string;
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
          failureStage:data.failureStage,
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
        status: 0,
        failureStage:undefined,
        error:up?undefined:"Phone could not reach this site",
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
    if (connected) {
      try {
        await editWatch('check');
      } catch (e) {
        deck.showToast(false, (e as Error).message);
      } finally {
        setChecking(false);
      }
      return;
    }
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
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error();
    } catch {
      deck.showToast(false, 'Enter a valid website address');
      return;
    }
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
    if (connected) {
      void editWatch('add', [url])
        .then(() => {
          setSelectedId(new URL(url).href);
          setNewUrl('');
        })
        .catch((err) => deck.showToast(false, err.message));
      return;
    }
    queueEdit('add', url);
    const next = [item, ...sites.filter((site) => site.url !== url)];
    persist(next);
    setSelectedId(item.id);
    setNewUrl('');
  };

  const [comparison,setComparison]=useState<Record<string,string>>({});
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

        <div className="flex items-center justify-between text-console-caption">
          <span>{connected ? 'Bridge checks every 60s' : 'Phone checks on demand'}</span>
          <button disabled={!connected} onClick={toggleNotifications}>
            Phone alerts · {notifications ? 'On' : 'Off'}
          </button>
        </div>
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
                    if (connected) {
                      void editWatch('remove', [site.url]).catch((err) => deck.showToast(false, err.message));
                      return;
                    }
                    queueEdit('remove', site.url);
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
                  color: selected.up === null ? '#a1a1aa' : selected.up ? '#34d399' : '#ff5d6c',
                }}
              >
                {selected.up === null ? 'PENDING' : selected.up ? (selected.status?'UP · '+selected.status:'Reachable') : 'DOWN'}
              </span>
            </div>

            <section className="work-card">
              <div className="flex items-center justify-between gap-2">
                <strong>
                  {selected.failureStage ? 'First failure · ' + selected.failureStage : 'Outage & connection trace'}
                </strong>
                <button
                  type="button"
                  disabled={diagBusy}
                  onClick={() => void diagnoseOutage(selected.url)}
                  className="font-mono-tech rounded-full border border-[#22d3ee]/40 bg-[#22d3ee]/15 px-2 py-0.5 text-[8.5px] font-extrabold text-[#22d3ee] hover:bg-[#22d3ee]/25"
                >
                  {diagBusy ? 'TRACING…' : 'EXPLAIN'}
                </button>
              </div>
              <small>{selected.error || (selected.status ? 'Computer received HTTP ' + selected.status : 'Tap EXPLAIN to trace DNS → TCP → TLS → HTTP.')}</small>
              {diagResult && diagResult.url === selected.url && (
                <div className="mt-1.5 space-y-1">
                  <div className="grid grid-cols-4 gap-1">
                    {(['dns', 'tcp', 'tls', 'http'] as const).map((stage) => {
                      const s = diagResult.stages[stage];
                      const ok = s?.ok;
                      return (
                        <div
                          key={stage}
                          className="rounded-lg border px-1.5 py-1 text-center"
                          style={{
                            borderColor: ok ? 'rgba(52,211,153,0.35)' : 'rgba(255,93,108,0.45)',
                            background: ok ? 'rgba(52,211,153,0.1)' : 'rgba(255,93,108,0.14)',
                          }}
                        >
                          <div className="font-mono-tech text-[8px] font-extrabold uppercase text-white">
                            {stage}
                          </div>
                          <div
                            className="font-mono-tech text-[7.5px]"
                            style={{ color: ok ? '#34d399' : '#ff5d6c' }}
                          >
                            {ok ? `${s.ms}ms` : 'FAIL'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="font-mono-tech text-[8.5px] text-zinc-300">
                    {diagResult.failedStage
                      ? `Failed at ${diagResult.failedStage.toUpperCase()}: ${diagResult.stages[diagResult.failedStage as 'dns' | 'tcp' | 'tls' | 'http']?.detail || 'Check failed'}`
                      : 'All 4 checks (DNS, TCP, TLS, HTTP) passed on Computer'}
                    {diagResult.phoneUp !== null && (
                      <>
                        {' · '}
                        <span className={diagResult.phoneUp ? 'text-[#34d399]' : 'text-[#ff5d6c]'}>
                          Phone: {diagResult.phoneUp ? 'Reachable' : 'Unreachable'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              <button disabled={comparison[selected.url]==='Checking…'} onClick={async()=>{const url=selected.url;const show=(message:string)=>setComparison(prev=>({...prev,[url]:message}));show('Checking…');try{
                const res=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(6000)});show('This device · HTTP '+res.status);await res.body?.cancel();
              }catch{try{await fetch(url,{mode:'no-cors',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(6000)});show('This device reached the site. Browser privacy hides its HTTP status.');}catch{show('This device could not reach the site. Browser policy or connectivity may be responsible.');}}}}>Compare from this device</button><output>{comparison[selected.url]}</output>
            </section>
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
