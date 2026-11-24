'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Container,
  Flame,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BrushedDial, GlowRing } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatSpeed, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type MonitorTab = 'logs' | 'hogs' | 'docker';

export function LiveMonitorView({ deck }: { deck: DevDeckState }) {
  const [tab, setTab] = useState<MonitorTab>('logs');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [dialVal, setDialVal] = useState(deck.mediaState.volume);
  const logPanelRef = useRef<HTMLDivElement | null>(null);
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
    const panel = logPanelRef.current;
    if (tab === 'logs' && panel) panel.scrollTop = panel.scrollHeight;
  }, [filteredLogs, tab]);

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
    <div className="screen-grid layout-monitor">
      {/* Column 1: Real Mac Telemetry Rings */}
      <div className="tile flex flex-col justify-between p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="disp text-[26px]">Telemetry</div>
        <div className="telemetry-gauges flex items-center justify-around">
          <GlowRing value={isConnected ? deck.stats.cpuPct : 0} color="#22d3ee" label="CPU %" />
          <GlowRing value={isConnected ? deck.stats.ramPct : 0} color="#f472b6" label="RAM %" />
        </div>
        <div className="telemetry-readings text-console-caption">
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

      {/* Column 2: Tabbed Live Logs / CPU Hogs / Docker Control */}
      <div className="tile flex min-h-0 flex-col p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        {/* Tab Bar */}
        <div className="mb-2 flex items-center justify-between gap-1.5">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            {(
              [
                ['logs', 'Logs', Terminal],
                ['hogs', 'CPU Hogs', Flame],
                ['docker', 'Docker', Container],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setTab(id);
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-console-caption font-extrabold uppercase"
                style={{
                  background: tab === id ? '#1f222c' : 'transparent',
                  color:
                    tab === id
                      ? id === 'hogs'
                        ? '#ff5d6c'
                        : id === 'docker'
                          ? '#22d3ee'
                          : '#34d399'
                      : '#7c8190',
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {tab !== 'logs' && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({
                  type: tab === 'hogs' ? 'processes:refresh' : 'docker:refresh',
                  payload: { requestId: makeRequestId() },
                });
              }}
              aria-label="Refresh list"
              className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.06] text-[#7c8190] hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* TAB 1: Live Terminal Logs */}
        {tab === 'logs' && (
          <>
            <div className="mb-1.5 flex items-center gap-1.5">
              <select
                value={activePresetId}
                onChange={(e) => setSelectedPreset(e.target.value)}
                disabled={!isConnected}
                className="font-mono-tech min-w-0 flex-1 rounded-full border border-white/10 bg-black px-2.5 py-1 text-console-caption text-white outline-none"
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
                className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-console-caption font-extrabold"
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

            <div ref={logPanelRef} className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/80 p-2 text-console-caption leading-relaxed">
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
            </div>

            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-[#7c8190]" />
                <input
                  type="search"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  placeholder="Filter logs…"
                  className="font-mono-tech w-full rounded-full border border-white/10 bg-black py-1 pr-2 pl-6 text-console-caption text-white outline-none"
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
          </>
        )}

        {/* TAB 2: Heavy CPU / RAM Process Hog Killer */}
        {tab === 'hogs' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {deck.processes.map((proc) => (
              <div
                key={proc.pid}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-console-body font-bold text-white">{proc.name}</div>
                  <div className="num text-console-caption text-[#8b90a0]">
                    PID {proc.pid} · <span className="text-[#fbbf24]">CPU {proc.cpuPct}%</span> · RAM{' '}
                    {proc.memPct}%
                  </div>
                </div>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    soundEngine.playErrorThud();
                    deck.sendEvent({
                      type: 'process:kill',
                      payload: { requestId: makeRequestId(), pid: proc.pid },
                    });
                  }}
                  className="rounded-full px-2.5 py-1 text-console-caption font-extrabold text-white"
                  style={{ background: '#e5484d', boxShadow: '0 2px 0 #7a1d20' }}
                >
                  KILL
                </motion.button>
              </div>
            ))}
            {deck.processes.length === 0 && (
              <div className="sub grid h-full place-items-center text-center">
                {isConnected ? 'Scanning heavy Mac processes…' : 'Connect Mac to view CPU hogs'}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Docker Container Control */}
        {tab === 'docker' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {deck.docker.containers.map((c) => {
              const running = c.state.toLowerCase() === 'running';
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <i
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: running ? '#34d399' : '#6b7080' }}
                      />
                      <span className="truncate text-console-body font-bold text-white">{c.name}</span>
                    </div>
                    <div className="truncate text-console-caption text-[#8b90a0]">{c.status}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: c.id,
                            action: running ? 'stop' : 'start',
                          },
                        });
                      }}
                      className="rounded-full px-2 py-1 text-console-caption font-extrabold"
                      style={{
                        background: running ? '#e5484d' : '#34d399',
                        color: running ? '#fff' : '#04130c',
                      }}
                    >
                      {running ? 'STOP' : 'START'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Restart ${c.name}`}
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: { requestId: makeRequestId(), id: c.id, action: 'restart' },
                        });
                      }}
                      className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.08] text-[#22d3ee]"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {deck.docker.containers.length === 0 && (
              <div className="sub grid h-full place-items-center text-center">
                {!isConnected
                  ? 'Connect Mac to manage Docker'
                  : deck.docker.available
                    ? 'No Docker containers found'
                    : 'Docker daemon not running on Mac'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Column 3: Real Mac Volume Dial */}
      <div className="volume-panel tile flex flex-col items-center justify-between p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#fbbf24]" />
        <div className="text-center text-console-body leading-tight font-extrabold">
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
          className="flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-console-caption font-bold"
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
