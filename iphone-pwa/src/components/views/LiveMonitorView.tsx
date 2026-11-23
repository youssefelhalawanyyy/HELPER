'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  Play,
  RefreshCw,
  Search,
  Skull,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatSpeed, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

function MiniGauge({
  label,
  pct,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  pct: number;
  sub: string;
  color: string;
  icon: typeof Cpu;
}) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;

  return (
    <div className="hw-panel flex items-center gap-2.5 rounded-xl px-2.5 py-2">
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
        <svg className="h-11 w-11 -rotate-90" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle
            cx="23"
            cy="23"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        <span className="font-mono-tech absolute text-[10px] font-bold text-white">{pct}%</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
          <Icon className="h-3 w-3 text-zinc-400" />
          <span>{label}</span>
        </div>
        <div className="font-mono-tech truncate text-[10px] text-zinc-500">{sub}</div>
      </div>
    </div>
  );
}

export function LiveMonitorView({ deck }: { deck: DevDeckState }) {
  const [logFilter, setLogFilter] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const presets = deck.config?.logPresets ?? [];
  const activePresetId = selectedPreset || presets[0]?.id || '';

  const filteredLogs = useMemo(() => {
    const q = logFilter.trim().toLowerCase();
    if (!q) return deck.logs;
    return deck.logs.filter((l) => l.text.toLowerCase().includes(q));
  }, [deck.logs, logFilter]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredLogs.length]);

  const { stats } = deck;

  return (
    <div className="grid h-full grid-cols-12 gap-2.5 p-3">
      {/* Left Column: Gauges + Port Killer */}
      <div className="col-span-5 flex min-h-0 flex-col gap-2.5">
        {/* 2x2 Hardware Telemetry */}
        <div className="grid grid-cols-2 gap-2">
          <MiniGauge
            label="CPU"
            pct={stats.cpuPct}
            sub={stats.cpuPct > 80 ? 'High Load' : 'Nominal'}
            color={stats.cpuPct > 80 ? '#EF4444' : '#10B981'}
            icon={Cpu}
          />
          <MiniGauge
            label="RAM"
            pct={stats.ramPct}
            sub={`${stats.ramUsedGb}/${stats.ramTotalGb}G`}
            color={stats.ramPct > 85 ? '#EF4444' : '#06B6D4'}
            icon={MemoryStick}
          />
          <MiniGauge
            label="Disk"
            pct={stats.diskPct}
            sub={`${stats.diskUsedGb}/${stats.diskTotalGb}G`}
            color={stats.diskPct > 90 ? '#EF4444' : '#F59E0B'}
            icon={HardDrive}
          />
          <div className="hw-panel flex flex-col justify-center rounded-xl px-3 py-2">
            <div className="font-mono-tech text-[10px] uppercase tracking-wider text-zinc-500">
              Network I/O
            </div>
            <div className="font-mono-tech mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400">
              <ArrowDown className="h-3 w-3" />
              <span>{formatSpeed(stats.netRxKBs)}</span>
            </div>
            <div className="font-mono-tech flex items-center gap-1.5 text-[11px] text-cyan-400">
              <ArrowUp className="h-3 w-3" />
              <span>{formatSpeed(stats.netTxKBs)}</span>
            </div>
          </div>
        </div>

        {/* One-Tap Port Killer */}
        <div className="hw-panel flex min-h-0 flex-1 flex-col rounded-xl p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Active Dev Ports ({deck.ports.length})
            </span>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'ports:refresh', payload: { requestId: makeRequestId() } });
              }}
              aria-label="Refresh ports"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>

          <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {deck.ports.map((p) => (
              <div
                key={`${p.port}-${p.pid}`}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#141419] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-tech text-xs font-bold text-emerald-400">:{p.port}</span>
                    <span className="truncate text-[11px] font-medium text-zinc-200">{p.process}</span>
                  </div>
                  <div className="font-mono-tech text-[9px] text-zinc-500">PID {p.pid}</div>
                </div>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    soundEngine.playErrorThud();
                    deck.sendEvent({
                      type: 'port:kill',
                      payload: { requestId: makeRequestId(), pid: p.pid, port: p.port },
                    });
                  }}
                  className="flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/30"
                >
                  <Skull className="h-3 w-3" />
                  Kill
                </motion.button>
              </div>
            ))}

            {deck.ports.length === 0 && (
              <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">
                No dev ports listening
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Live Terminal Log Streamer */}
      <div className="hw-panel col-span-7 flex min-h-0 flex-col rounded-xl p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-emerald-400" />
            <select
              value={activePresetId}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="font-mono-tech rounded-md border border-white/10 bg-black px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-cyan-400"
            >
              {presets.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.label}
                </option>
              ))}
            </select>

            {deck.logStatus.running ? (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playErrorThud();
                  deck.sendEvent({ type: 'logs:stop', payload: { requestId: makeRequestId() } });
                }}
                className="flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/20 px-2.5 py-1 text-[11px] font-semibold text-red-200"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={!activePresetId}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'logs:start',
                    payload: { requestId: makeRequestId(), presetId: activePresetId },
                  });
                }}
                className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-40"
              >
                <Play className="h-3 w-3 fill-current" />
                Stream
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-zinc-500" />
              <input
                type="search"
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Filter logs…"
                className="font-mono-tech w-28 rounded-md border border-white/10 bg-black py-1 pr-2 pl-6 text-[10px] text-zinc-200 outline-none focus:border-cyan-400"
              />
            </div>
            <button
              type="button"
              onClick={deck.clearLogs}
              aria-label="Clear logs"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Terminal Stream Body */}
        <div className="deck-scroll font-mono-tech flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-black p-2.5 text-[10.5px] leading-relaxed">
          {filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-600">
              Tap Stream to watch live stdout/stderr (error/success lines trigger edge glow)
            </div>
          ) : (
            filteredLogs.map((line) => (
              <div
                key={line.id}
                className={`break-all whitespace-pre-wrap ${
                  line.level === 'error'
                    ? 'text-red-400'
                    : line.level === 'success'
                      ? 'text-emerald-400'
                      : line.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-zinc-300'
                }`}
              >
                {line.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
