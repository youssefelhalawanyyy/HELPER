'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Flame, RefreshCw, Wind, X } from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

interface ReplaySample {
  ts: number;
  cpuPct: number;
  cpuTempC: number | null;
  fanRpm: number | null;
  topApp: string;
  topAppCpu: number;
}

interface ReplayEvent {
  id: string;
  ts: number;
  kind: string;
  title: string;
  detail: string;
}

export function IncidentReplaySheet({
  deck,
  onClose,
}: {
  deck: DevDeckState;
  onClose: () => void;
}) {
  const [samples, setSamples] = useState<ReplaySample[]>([]);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [heatAlerts, setHeatAlerts] = useState<ReplayEvent[]>([]);
  const [selectedTs, setSelectedTs] = useState<number | undefined>(undefined);
  const [cursorIdx, setCursorIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const loadReplay = async (ts?: number) => {
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    setLoading(true);
    try {
      const q = ts ? `?ts=${ts}` : '';
      const res = await fetch(`${deck.bridgeBaseUrl}/api/timeline/incident${q}`, {
        headers: { authorization: `Bearer ${deck.pairing.token}` },
      });
      const d = (await res.json()) as {
        ok?: boolean;
        samples?: ReplaySample[];
        events?: ReplayEvent[];
        heatAlerts?: ReplayEvent[];
      };
      if (d.ok) {
        const list = d.samples || [];
        setSamples(list);
        setEvents(d.events || []);
        setHeatAlerts(d.heatAlerts || []);
        setCursorIdx(Math.max(0, Math.floor(list.length / 2)));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReplay(selectedTs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTs]);

  if (!mounted) return null;

  const active = samples[cursorIdx] || samples[samples.length - 1] || null;
  const tempPts = samples
    .map((s, i) => {
      const x = (i / Math.max(1, samples.length - 1)) * 100;
      const y = 38 - Math.min(1, Math.max(0, (s.cpuTempC ?? 0) / 105)) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const cpuPts = samples
    .map((s, i) => {
      const x = (i / Math.max(1, samples.length - 1)) * 100;
      const y = 38 - Math.min(1, Math.max(0, s.cpuPct / 100)) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return createPortal(
    <div
      data-no-swipe="true"
      onClick={onClose}
      className="fixed inset-0 z-[9991] flex items-center justify-center bg-black/80 p-3"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-[540px] flex-col gap-2.5 overflow-hidden rounded-3xl border border-[#fbbf24]/35 bg-[#09141b] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-[#fbbf24]" />
            <div>
              <div className="text-sm font-extrabold text-white">Incident Replay (±60s Timeline)</div>
              <div className="text-[9.5px] text-[#9cb4bb]">
                Aligned Temperature °C, CPU Load %, Fan RPM, Busiest App &amp; Action Markers
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                void loadReplay(selectedTs);
              }}
              className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.08] text-zinc-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.08] text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Heat Alert Selector */}
        {heatAlerts.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {heatAlerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedTs(a.ts)}
                className="shrink-0 rounded-full border border-[#ff5d6c]/40 bg-[#ff5d6c]/15 px-2.5 py-0.5 text-[9px] font-extrabold text-[#ff5d6c]"
              >
                {a.title} · {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </button>
            ))}
          </div>
        )}

        {/* Dual-Line Aligned Graph + Scrubber */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#040a0f] p-3">
          <div className="mb-1 flex items-center justify-between text-[9px] font-bold">
            <span className="text-[#ff5d6c]">━ Temp °C</span>
            <span className="text-[#7dd3fc]">━ CPU %</span>
            <span className="font-mono-tech text-zinc-400">
              {active ? new Date(active.ts).toLocaleTimeString() : '--:--:--'}
            </span>
          </div>
          {samples.length >= 2 ? (
            <>
              <svg viewBox="0 0 100 40" className="h-24 w-full overflow-visible">
                <polyline fill="none" stroke="#7dd3fc" strokeWidth="1.5" points={cpuPts} />
                <polyline fill="none" stroke="#ff5d6c" strokeWidth="2" points={tempPts} />
                <line
                  x1={(cursorIdx / Math.max(1, samples.length - 1)) * 100}
                  x2={(cursorIdx / Math.max(1, samples.length - 1)) * 100}
                  y1="0"
                  y2="40"
                  stroke="#fbbf24"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              </svg>
              <input
                type="range"
                min={0}
                max={Math.max(0, samples.length - 1)}
                value={cursorIdx}
                onChange={(e) => setCursorIdx(Number(e.target.value))}
                className="mt-1 w-full accent-[#fbbf24]"
              />
            </>
          ) : (
            <div className="grid h-20 place-items-center text-[10px] text-zinc-500">
              Recording telemetry samples every 2 seconds…
            </div>
          )}
        </div>

        {/* Selected Moment Readout */}
        {active && (
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[8px] text-zinc-400 uppercase">Temp</div>
              <div className="font-mono-tech text-xs font-extrabold text-[#ff5d6c]">
                {active.cpuTempC !== null ? `${active.cpuTempC.toFixed(1)}°C` : '--'}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[8px] text-zinc-400 uppercase">CPU</div>
              <div className="font-mono-tech text-xs font-extrabold text-[#7dd3fc]">
                {Math.round(active.cpuPct)}%
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="flex items-center justify-center gap-0.5 text-[8px] text-zinc-400 uppercase">
                <Wind className="h-2.5 w-2.5" /> Fan
              </div>
              <div className="font-mono-tech text-xs font-extrabold text-[#88f1d1]">
                {active.fanRpm ? `${active.fanRpm}` : 'Auto'}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="flex items-center justify-center gap-0.5 text-[8px] text-zinc-400 uppercase">
                <Activity className="h-2.5 w-2.5" /> Top App
              </div>
              <div className="truncate text-[10px] font-extrabold text-white">
                {active.topApp || 'Idle'}
              </div>
            </div>
          </div>
        )}

        {/* Action & Intervention Markers */}
        {events.length > 0 && (
          <div className="deck-scroll max-h-24 space-y-1 overflow-y-auto">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[9.5px]"
              >
                <span className="font-bold text-[#fbbf24]">{ev.title}</span>
                <span className="truncate px-2 text-zinc-300">{ev.detail}</span>
                <span className="font-mono-tech shrink-0 text-[8.5px] text-zinc-500">
                  {new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
