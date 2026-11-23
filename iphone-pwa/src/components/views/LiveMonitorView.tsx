'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Search, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { BrushedDial, GlowRing } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatSpeed, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export function LiveMonitorView({ deck }: { deck: DevDeckState }) {
  const [selectedPreset, setSelectedPreset] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [dialVal, setDialVal] = useState(deck.mediaState.volume);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const lastSendRef = useRef(0);

  const isConnected = deck.status === 'connected';
  const presets = deck.config?.logPresets ?? [];
  const activePresetId = selectedPreset || presets[0]?.id || '';

  useEffect(() => {
    setDialVal(deck.mediaState.volume);
  }, [deck.mediaState.volume]);

  const filteredLogs = useMemo(() => {
    const q = logFilter.trim().toLowerCase();
    if (!q) return deck.logs;
    return deck.logs.filter((l) => l.text.toLowerCase().includes(q));
  }, [deck.logs, logFilter]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredLogs.length]);

  const handleToggleStream = () => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Connect your Mac bridge first');
      return;
    }
    if (deck.logStatus.running) {
      deck.sendEvent({ type: 'logs:stop', payload: { requestId: makeRequestId() } });
    } else if (activePresetId) {
      deck.sendEvent({
        type: 'logs:start',
        payload: { requestId: makeRequestId(), presetId: activePresetId },
      });
    }
  };

  const handleDialChange = (nextVal: number, delta: number) => {
    setDialVal(nextVal);
    if (isConnected && Date.now() - lastSendRef.current > 85) {
      lastSendRef.current = Date.now();
      deck.sendEvent({
        type: 'hardware:dial',
        payload: { mode: 'volume', delta, value: Math.round(nextVal) },
      });
    }
  };

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1.35fr 150px' }}>
      {/* Column 1: Real Mac Telemetry Rings */}
      <div className="tile flex flex-col justify-between p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="disp text-[26px]">Telemetry</div>
        <div className="flex items-center justify-around">
          <GlowRing value={isConnected ? deck.stats.cpuPct : 0} color="#22d3ee" label="CPU %" />
          <GlowRing value={isConnected ? deck.stats.ramPct : 0} color="#f472b6" label="RAM %" />
        </div>
        <div className="space-y-0.5 text-[10px]">
          <div className="num flex justify-between text-zinc-300">
            <span className="sub">Disk</span>
            <span>
              {isConnected
                ? `${deck.stats.diskUsedGb}/${deck.stats.diskTotalGb}G (${deck.stats.diskPct}%)`
                : '--'}
            </span>
          </div>
          <div className="num flex justify-between text-zinc-300">
            <span className="sub">Net</span>
            <span>
              {isConnected
                ? `↓${formatSpeed(deck.stats.netRxKBs)} ↑${formatSpeed(deck.stats.netTxKBs)}`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* Column 2: Real Live Terminal Log Streamer */}
      <div className="tile flex min-h-0 flex-col p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />
        <div className="mb-2 flex items-center justify-between gap-1.5">
          <select
            value={activePresetId}
            onChange={(e) => setSelectedPreset(e.target.value)}
            disabled={!isConnected}
            className="font-mono-tech min-w-0 flex-1 rounded-full border border-white/10 bg-black px-2.5 py-1 text-[10px] text-white outline-none"
          >
            {presets.length === 0 ? (
              <option value="">Connect Mac for presets</option>
            ) : (
              presets.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.label}
                </option>
              ))
            )}
          </select>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={handleToggleStream}
            className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold"
            style={{
              background: deck.logStatus.running ? '#e5484d' : '#34d399',
              color: deck.logStatus.running ? '#ffffff' : '#04130c',
              boxShadow: deck.logStatus.running ? '0 2px 0 #7a1d20' : '0 2px 0 #14664a',
            }}
          >
            {deck.logStatus.running ? (
              <>
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-2.5 w-2.5 fill-current" />
                Stream
              </>
            )}
          </motion.button>
        </div>

        <div className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/80 p-2 text-[9.5px] leading-relaxed">
          {filteredLogs.length === 0 ? (
            <div className="sub grid h-full place-items-center text-center">
              {isConnected ? 'Tap Stream to run real stdout/stderr' : 'Connect Mac to stream logs'}
            </div>
          ) : (
            filteredLogs.map((line) => (
              <div
                key={line.id}
                className={`break-all whitespace-pre-wrap ${
                  line.level === 'error'
                    ? 'text-[#ff5d6c]'
                    : line.level === 'success'
                      ? 'text-[#34d399]'
                      : line.level === 'warn'
                        ? 'text-[#fbbf24]'
                        : 'text-zinc-300'
                }`}
              >
                {line.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-[#7c8190]" />
            <input
              type="search"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              placeholder="Filter logs…"
              className="font-mono-tech w-full rounded-full border border-white/10 bg-black py-1 pr-2 pl-6 text-[10px] text-white outline-none"
            />
          </div>
          <button
            type="button"
            onClick={deck.clearLogs}
            aria-label="Clear logs"
            className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.06] text-[#7c8190] hover:text-white"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Column 3: Real Mac Volume Dial */}
      <div className="tile flex flex-col items-center justify-between p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#fbbf24]" />
        <div className="text-center text-[11px] leading-tight font-extrabold">
          Mac volume
          <div className="sub mt-0.5">{deck.mediaState.muted ? 'Muted' : 'Live output'}</div>
        </div>
        <BrushedDial
          value={isConnected ? dialVal : 0}
          onChange={handleDialChange}
          label="Mac volume dial"
        />
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            deck.sendEvent({
              type: 'hardware:mute',
              payload: { requestId: makeRequestId(), muted: !deck.mediaState.muted },
            });
          }}
          className="flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[9.5px] font-bold"
          style={{ color: deck.mediaState.muted ? '#ff5d6c' : '#fbbf24' }}
        >
          {deck.mediaState.muted ? (
            <VolumeX className="h-3 w-3" />
          ) : (
            <Volume2 className="h-3 w-3" />
          )}
          {deck.mediaState.muted ? 'UNMUTE' : 'MUTE'}
        </button>
      </div>
    </div>
  );
}
