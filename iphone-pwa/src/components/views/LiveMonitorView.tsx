'use client';

import { InstrumentGauge, heatBand, processorHeatScale } from '@/components/shell/InstrumentGauge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Container,
  Copy,
  FileText,
  Flame,
  Mic,
  MicOff,
  Minus,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { BrushedDial } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatSpeed, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type MonitorTab = 'logs' | 'hogs' | 'docker';
type PotChannel = 'volume' | 'brightness' | 'mic';
type LogLevelFilter = 'all' | 'error' | 'warn' | 'info';
type HogSort = 'cpu' | 'mem';

const BUILTIN_LOG_STREAMS: Array<{ id: string; label: string; cmd: string }> = [
  {
    id: '__sys_top__',
    label: '⚡ Live Top CPU Processes Stream',
    cmd: 'top -l 5 -n 12 -stats pid,command,cpu,mem,th,state -s 2',
  },
  {
    id: '__git_graph__',
    label: '🌿 Git Commit Graph & Status',
    cmd: 'git status -sb && echo "" && git log --oneline --graph --decorate -n 20',
  },
  {
    id: '__net_ports__',
    label: '🔌 Active Listening TCP Ports',
    cmd: 'lsof -iTCP -sTCP:LISTEN -n -P | head -n 30',
  },
  {
    id: '__docker_ps__',
    label: '🐳 Docker Containers & Resource Snapshot',
    cmd: 'docker ps -a && echo "" && docker stats --no-stream',
  },
];

function formatUptime(sec: number): string {
  if (!sec || sec <= 0) return '--';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatLogTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function MiniSparkline({
  values,
  color,
  maxOverride,
}: {
  values: number[];
  color: string;
  maxOverride?: number;
}) {
  if (values.length < 2) return null;
  const max = maxOverride ?? Math.max(10, ...values);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 100;
      const y = 20 - Math.min(1, Math.max(0, v / max)) * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 22" className="h-4 w-full overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

export function LiveMonitorView({ deck }: { deck: DevDeckState }) {
  const [tab, setTab] = useState<MonitorTab>('logs');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all');
  const [autoFollow, setAutoFollow] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const [hogSort, setHogSort] = useState<HogSort>('cpu');
  const [hogQuery, setHogQuery] = useState('');
  const [dockerQuery, setDockerQuery] = useState('');

  // 60-second rolling telemetry history for sparklines (30 samples at 2s)
  const [history, setHistory] = useState<{
    cpu: number[];
    heat: number[];
    ram: number[];
    net: number[];
  }>({ cpu: [], heat: [], ram: [], net: [] });

  useEffect(() => {
    if (deck.status !== 'connected' || !deck.stats.ts) return;
    setHistory((prev) => ({
      cpu: [...prev.cpu.slice(-29), deck.stats.cpuPct],
      heat: [...prev.heat.slice(-29), deck.powerState.cpuTempC ?? 0],
      ram: [...prev.ram.slice(-29), deck.stats.ramPct],
      net: [...prev.net.slice(-29), deck.stats.netRxKBs + deck.stats.netTxKBs],
    }));
  }, [
    deck.status,
    deck.stats.ts,
    deck.stats.cpuPct,
    deck.stats.ramPct,
    deck.stats.netRxKBs,
    deck.stats.netTxKBs,
    deck.powerState.cpuTempC,
  ]);

  // 3-Channel Hardware Potentiometer State (Volume / Brightness / Mic Gain)
  const mt = deck.macTelemetry;
  const [potChannel, setPotChannel] = useState<PotChannel>('volume');
  const [audioOutputs, setAudioOutputs] = useState<string[]>([]);
  const [currentAudioOut, setCurrentAudioOut] = useState('');
  const [resourceAlertsOn, setResourceAlertsOn] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('devdeck.resAlerts.v1') === '1' : false,
  );
  const lastAlertTsRef = useRef(0);

  useEffect(() => {
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    void fetch(`${deck.bridgeBaseUrl}/api/audio/outputs`, {
      headers: { authorization: `Bearer ${deck.pairing.token}` },
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; current?: string; devices?: string[] }) => {
        if (d.ok && Array.isArray(d.devices)) {
          setAudioOutputs(d.devices);
          if (d.current) setCurrentAudioOut(d.current);
        }
      })
      .catch(() => {});
  }, [deck.status, deck.bridgeBaseUrl, deck.pairing?.token]);

  useEffect(() => {
    if (!resourceAlertsOn || deck.status !== 'connected') return;
    const now = Date.now();
    if (now - lastAlertTsRef.current < 30_000) return;
    const diskFree = Math.max(0, deck.stats.diskTotalGb - deck.stats.diskUsedGb);
    if (deck.stats.ramPct >= 90) {
      lastAlertTsRef.current = now;
      deck.triggerFlash('warning', `High RAM Alert: ${Math.round(deck.stats.ramPct)}% used!`);
    } else if (deck.stats.diskTotalGb > 0 && diskFree < 10) {
      lastAlertTsRef.current = now;
      deck.triggerFlash('error', `Low Disk Alert: only ${diskFree.toFixed(1)} GB free!`);
    }
  }, [resourceAlertsOn, deck]);

  const switchAudioOutput = async (device: string) => {
    if (!deck.bridgeBaseUrl || !deck.pairing?.token) return;
    soundEngine.playClick();
    setCurrentAudioOut(device);
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/audio/output`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deck.pairing.token}`,
        },
        body: JSON.stringify({ device }),
      });
      const d = (await res.json()) as { ok?: boolean; message?: string };
      deck.showToast(Boolean(d.ok), d.message || `Switched to ${device}`);
    } catch {
      deck.showToast(false, 'Could not switch audio output');
    }
  };
  const [volVal, setVolVal] = useState(deck.mediaState.volume);
  const [brightVal, setBrightVal] = useState(deck.mediaState.brightness || 75);
  const [micVal, setMicVal] = useState(mt?.micInputPct || 50);

  const logPanelRef = useRef<HTMLDivElement | null>(null);
  const lastSendRef = useRef(0);

  const isConnected = deck.status === 'connected';
  const presets = deck.config?.logPresets ?? [];
  const activePresetId = selectedPreset || presets[0]?.id || BUILTIN_LOG_STREAMS[0].id;

  useEffect(() => {
    setVolVal(deck.mediaState.volume);
  }, [deck.mediaState.volume]);

  useEffect(() => {
    if (typeof deck.mediaState.brightness === 'number' && deck.mediaState.brightness > 0) {
      setBrightVal(deck.mediaState.brightness);
    }
  }, [deck.mediaState.brightness]);

  useEffect(() => {
    if (typeof mt?.micInputPct === 'number') {
      setMicVal(mt.micInputPct);
    }
  }, [mt?.micInputPct]);

  useEffect(() => {
    if (isConnected && deck.powerState.cpuTempC === null) {
      deck.sendEvent({ type: 'power:refresh', payload: { requestId: makeRequestId() } });
    }
  }, [isConnected, deck.powerState.cpuTempC, deck]);

  const errorCount = useMemo(
    () => deck.logs.filter((l) => l.level === 'error').length,
    [deck.logs],
  );
  const warnCount = useMemo(
    () => deck.logs.filter((l) => l.level === 'warn').length,
    [deck.logs],
  );

  const filteredLogs = useMemo(() => {
    const q = logFilter.trim().toLowerCase();
    return deck.logs.filter((l) => {
      if (levelFilter === 'error' && l.level !== 'error') return false;
      if (levelFilter === 'warn' && l.level !== 'warn') return false;
      if (levelFilter === 'info' && l.level !== 'info' && l.level !== 'success') return false;
      if (q && !l.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deck.logs, logFilter, levelFilter]);

  useEffect(() => {
    const panel = logPanelRef.current;
    if (tab === 'logs' && autoFollow && panel) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [filteredLogs, tab, autoFollow]);

  const sortedHogs = useMemo(() => {
    const q = hogQuery.trim().toLowerCase();
    return [...deck.processes]
      .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
      .sort((a, b) => (hogSort === 'cpu' ? b.cpuPct - a.cpuPct : b.memPct - a.memPct));
  }, [deck.processes, hogQuery, hogSort]);

  const filteredContainers = useMemo(() => {
    const q = dockerQuery.trim().toLowerCase();
    if (!q) return deck.docker.containers;
    return deck.docker.containers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q) ||
        (c.image || '').toLowerCase().includes(q) ||
        (c.ports || '').toLowerCase().includes(q),
    );
  }, [deck.docker.containers, dockerQuery]);

  const runningContainersCount = useMemo(
    () => deck.docker.containers.filter((c) => c.state.toLowerCase() === 'running').length,
    [deck.docker.containers],
  );

  const handleToggleStream = () => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Connect your computer bridge first');
      return;
    }
    if (deck.logStatus.running) {
      deck.sendEvent({ type: 'logs:stop', payload: { requestId: makeRequestId() } });
      return;
    }
    const builtin = BUILTIN_LOG_STREAMS.find((b) => b.id === activePresetId);
    if (builtin) {
      deck.sendEvent({
        type: 'logs:custom',
        payload: { requestId: makeRequestId(), command: builtin.cmd, label: builtin.label },
      });
    } else if (activePresetId) {
      deck.sendEvent({
        type: 'logs:start',
        payload: { requestId: makeRequestId(), presetId: activePresetId },
      });
    }
  };

  const handleRunCustomLogCmd = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = customCmd.trim();
    if (!cmd) return;
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Connect your computer bridge first');
      return;
    }
    deck.sendEvent({
      type: 'logs:custom',
      payload: { requestId: makeRequestId(), command: cmd, label: cmd },
    });
  };

  const handleCopyLogs = async () => {
    soundEngine.playClick();
    const text = filteredLogs
      .map((l) => `[${formatLogTime(l.ts)}] [${l.stream.toUpperCase()}] ${l.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || 'No logs');
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 1800);
    } catch {
      deck.showToast(false, 'Could not copy logs');
    }
  };

  const commitPotValue = (channel: PotChannel, nextVal: number, delta: number, force = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
    if (channel === 'volume') setVolVal(clamped);
    else if (channel === 'brightness') setBrightVal(clamped);
    else setMicVal(clamped);

    if (isConnected && (force || Date.now() - lastSendRef.current > 65)) {
      lastSendRef.current = Date.now();
      deck.sendEvent({
        type: 'hardware:dial',
        payload: { mode: channel, delta: Math.round(delta), value: clamped },
      });
    }
  };

  const activePotValue =
    potChannel === 'volume' ? volVal : potChannel === 'brightness' ? brightVal : micVal;
  const activePotColor =
    potChannel === 'volume' ? '#fbbf24' : potChannel === 'brightness' ? '#22d3ee' : '#a78bfa';
  const activePotMuted =
    potChannel === 'volume'
      ? deck.mediaState.muted
      : potChannel === 'mic'
        ? Boolean(mt?.micMuted)
        : false;

  const cpuHeatBand = heatBand(
    deck.powerState.cpuTempC,
    processorHeatScale(deck.powerState.overheatTempC),
  );

  return (
    <div className="screen-grid layout-monitor">
      {/* COLUMN 1: Live Automotive Telemetry & Core Matrix */}
      <div className="tile flex min-h-0 flex-col justify-between gap-1.5 p-2.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="flex items-center justify-between gap-1.5">
          <div className="disp text-[clamp(15px,2cqw,21px)]">Telemetry</div>
          <div className="flex items-center gap-1">
            {isConnected && deck.powerState.cpuTempC !== null && (
              <span
                className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: `${cpuHeatBand.color}22`,
                  color: cpuHeatBand.color,
                }}
              >
                {deck.powerState.cpuTempC.toFixed(1)}°C · {deck.powerState.thermalPressure}
              </span>
            )}
          </div>
        </div>

        {/* 3-Gauge Automotive Cluster: CPU Load, CPU Heat °C, RAM */}
        <div className="telemetry-gauges grid grid-cols-3 place-items-center gap-1">
          <InstrumentGauge
            mode="tach"
            label="CPU Load"
            value={isConnected && deck.stats.ts ? deck.stats.cpuPct : null}
            accent="#22d3ee"
          />
          <InstrumentGauge
            label="CPU Heat"
            unit="°C"
            max={120}
            value={isConnected ? deck.powerState.cpuTempC : null}
            heat={processorHeatScale(deck.powerState.overheatTempC)}
          />
          <InstrumentGauge
            mode="tach"
            label="RAM"
            value={isConnected && deck.stats.ts ? deck.stats.ramPct : null}
            accent="#b4adf0"
          />
        </div>

        {/* Live Per-Core CPU Silicon Activity Strip */}
        {isConnected && (mt?.cpuCores?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-white/[0.06] bg-black/50 px-2 py-1">
            <div className="mb-0.5 flex items-center justify-between text-[7.5px] font-bold text-zinc-400 uppercase">
              <span>{mt?.cpuCores.length}-Core Silicon Load</span>
              <span className="font-mono-tech text-[#88f1d1]">
                UP {formatUptime(mt?.uptimeSec ?? 0)}
              </span>
            </div>
            <div className="grid grid-flow-col auto-cols-fr items-end gap-0.5 h-3">
              {(mt?.cpuCores ?? []).slice(0, 16).map((pct, i) => (
                <div key={i} className="h-full w-full rounded-xs bg-white/[0.07] flex items-end overflow-hidden">
                  <div
                    className="w-full rounded-xs transition-all duration-300"
                    style={{
                      height: `${Math.max(12, Math.min(100, pct))}%`,
                      background: pct >= 85 ? '#ff5d6c' : pct >= 55 ? '#fbbf24' : '#34d399',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 60-Second Rolling Sparkline Charts (CPU, Heat, RAM, Net) */}
        {isConnected && history.cpu.length >= 2 && (
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-white/[0.06] bg-black/50 px-1.5 py-1">
            {(
              [
                ['CPU', history.cpu, '#22d3ee', 100],
                ['HEAT', history.heat, cpuHeatBand.color, 110],
                ['RAM', history.ram, '#b4adf0', 100],
                ['NET', history.net, '#88f1d1', undefined],
              ] as const
            ).map(([lbl, arr, col, maxVal]) => (
              <div key={lbl} className="min-w-0">
                <div className="font-mono-tech text-[7px] font-extrabold text-zinc-400">{lbl}</div>
                <MiniSparkline values={arr} color={col} maxOverride={maxVal} />
              </div>
            ))}
          </div>
        )}

        {/* Complete Hardware Telemetry Readings */}
        <div className="telemetry-readings space-y-0.5 text-[10.5px]">
          <div className="num flex items-center justify-between text-zinc-300">
            <span className="sub">CPU / GPU / Batt</span>
            <span className="font-mono-tech font-extrabold" style={{ color: cpuHeatBand.color }}>
              {isConnected && deck.powerState.cpuTempC !== null
                ? `${deck.powerState.cpuTempC.toFixed(1)}° / ${
                    deck.powerState.gpuTempC !== null ? `${deck.powerState.gpuTempC.toFixed(1)}°` : '--'
                  } / ${
                    deck.powerState.batteryTempC !== null ? `${deck.powerState.batteryTempC.toFixed(1)}°C` : '--'
                  }`
                : '--'}
            </span>
          </div>
          <div className="num flex justify-between text-zinc-300">
            <span className="sub">Power · Memory</span>
            <span className="font-mono-tech">
              {isConnected
                ? `${deck.powerState.powerDrawW !== null ? `${deck.powerState.powerDrawW}W · ` : ''}${deck.stats.ramUsedGb}/${deck.stats.ramTotalGb}G`
                : '--'}
            </span>
          </div>
          <div className="num flex justify-between text-zinc-300">
            <span className="sub">Disk · Storage</span>
            <span className="font-mono-tech">
              {isConnected
                ? `${deck.stats.diskUsedGb}/${deck.stats.diskTotalGb}G (${deck.stats.diskPct}%)`
                : '--'}
            </span>
          </div>
          <div className="num flex justify-between text-zinc-300">
            <span className="sub">Net I/O · Ping</span>
            <span className="font-mono-tech">
              {isConnected
                ? `↓${formatSpeed(deck.stats.netRxKBs)} ↑${formatSpeed(deck.stats.netTxKBs)}${
                    mt?.pingMs ? ` · ${mt.pingMs}ms` : ''
                  }`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* COLUMN 2: Advanced Logs Workbench / CPU & Port Hogs / Docker Engine Studio */}
      <div className="tile flex min-h-0 flex-col p-2.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        {/* Top Tab Bar + Live Counters */}
        <div className="mb-1.5 flex items-center justify-between gap-1.5">
          <div className="flex gap-1 rounded-full bg-black/75 p-0.5">
            {(
              [
                ['logs', 'Logs', Terminal, '#34d399', deck.logs.length],
                ['hogs', 'CPU & Ports', Flame, '#ff5d6c', deck.processes.length],
                ['docker', 'Docker', Container, '#22d3ee', deck.docker.containers.length],
              ] as const
            ).map(([id, label, Icon, color, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setTab(id);
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase transition-colors"
                style={{
                  background: tab === id ? '#182b34' : 'transparent',
                  color: tab === id ? color : '#7c8190',
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
                {count > 0 && (
                  <span
                    className="font-mono-tech rounded-full px-1.5 text-[8.5px]"
                    style={{
                      background: tab === id ? `${color}26` : 'rgba(255,255,255,0.06)',
                      color: tab === id ? color : '#9cb4bb',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {tab === 'logs' ? (
              <>
                <button
                  type="button"
                  onClick={() => setAutoFollow((f) => !f)}
                  title={autoFollow ? 'Auto-scroll enabled' : 'Auto-scroll paused'}
                  className="font-mono-tech flex h-6 items-center gap-1 rounded-full border px-2 text-[8.5px] font-extrabold uppercase"
                  style={{
                    borderColor: autoFollow ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)',
                    background: autoFollow ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.04)',
                    color: autoFollow ? '#34d399' : '#9cb4bb',
                  }}
                >
                  {autoFollow ? 'FOLLOW' : 'PAUSED'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  aria-label="Copy visible logs"
                  className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.06] text-[#9cb4bb] hover:text-white"
                >
                  {copiedLogs ? <Check className="h-3 w-3 text-[#34d399]" /> : <Copy className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={deck.clearLogs}
                  aria-label="Clear logs"
                  className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.06] text-[#9cb4bb] hover:text-[#ff5d6c]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: tab === 'hogs' ? 'processes:refresh' : 'docker:refresh',
                    payload: { requestId: makeRequestId() },
                  });
                  if (tab === 'hogs') {
                    deck.sendEvent({
                      type: 'ports:refresh',
                      payload: { requestId: makeRequestId() },
                    });
                  }
                }}
                aria-label="Refresh list"
                className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.06] text-[#9cb4bb] hover:text-white"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* TAB 1: ADVANCED LIVE TERMINAL LOGS */}
        {tab === 'logs' && (
          <>
            {/* Preset + Built-In Diagnostic Stream Picker */}
            <div className="mb-1.5 flex items-center gap-1.5">
              <select
                value={activePresetId}
                onChange={(e) => setSelectedPreset(e.target.value)}
                disabled={!isConnected}
                className="font-mono-tech min-w-0 flex-1 rounded-full border border-white/10 bg-[#081217] px-2.5 py-1 text-[10.5px] text-white outline-none"
              >
                {presets.length > 0 && (
                  <optgroup label="Project Log Presets">
                    {presets.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.label} ({pr.command} {pr.args.join(' ')})
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Built-In Live System Streams">
                  {BUILTIN_LOG_STREAMS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </optgroup>
              </select>

              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={handleToggleStream}
                className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase"
                style={{
                  background: deck.logStatus.running ? '#ff5d6c' : '#34d399',
                  color: deck.logStatus.running ? '#ffffff' : '#04130c',
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

            {/* Level Filter Pills + Search Filter */}
            <div className="mb-1.5 flex items-center gap-1">
              <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/65 p-0.5">
                {(
                  [
                    ['all', `ALL (${deck.logs.length})`, '#88f1d1'],
                    ['error', `ERR (${errorCount})`, '#ff5d6c'],
                    ['warn', `WARN (${warnCount})`, '#fbbf24'],
                    ['info', 'INFO', '#22d3ee'],
                  ] as const
                ).map(([lvl, label, col]) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold"
                    style={{
                      background: levelFilter === lvl ? `${col}26` : 'transparent',
                      color: levelFilter === lvl ? col : '#7c8190',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-[#7c8190]" />
                <input
                  type="search"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  placeholder="Grep logs…"
                  className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-0.5 pr-2 pl-6 text-[10px] text-white outline-none"
                />
              </div>
            </div>

            {/* Timestamped Colored Terminal Output */}
            <div
              ref={logPanelRef}
              className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#050c10] p-2 text-[10.5px] leading-relaxed"
            >
              {filteredLogs.length === 0 ? (
                <div className="sub flex h-full flex-col items-center justify-center gap-1.5 text-center">
                  <span>
                    {isConnected
                      ? 'Tap Stream or run any command below to tail real stdout/stderr'
                      : 'Connect computer bridge to stream live logs'}
                  </span>
                </div>
              ) : (
                filteredLogs.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-white/[0.03]"
                  >
                    <span className="shrink-0 text-[9px] text-zinc-500">
                      {formatLogTime(line.ts)}
                    </span>
                    <span
                      className="shrink-0 rounded px-1 text-[8px] font-extrabold uppercase"
                      style={{
                        background:
                          line.level === 'error'
                            ? 'rgba(255,93,108,0.18)'
                            : line.level === 'warn'
                              ? 'rgba(251,191,36,0.18)'
                              : line.level === 'success'
                                ? 'rgba(52,211,153,0.18)'
                                : 'rgba(34,211,238,0.12)',
                        color:
                          line.level === 'error'
                            ? '#ff5d6c'
                            : line.level === 'warn'
                              ? '#fbbf24'
                              : line.level === 'success'
                                ? '#34d399'
                                : '#7dd3fc',
                      }}
                    >
                      {line.stream === 'stderr' ? 'ERR' : 'OUT'}
                    </span>
                    <span
                      className={`min-w-0 flex-1 break-all whitespace-pre-wrap ${
                        line.level === 'error'
                          ? 'text-[#ff7b86]'
                          : line.level === 'success'
                            ? 'text-[#88f1d1]'
                            : line.level === 'warn'
                              ? 'text-[#fde68a]'
                              : 'text-zinc-200'
                      }`}
                    >
                      {line.text}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Ad-Hoc Custom Shell Stream Runner */}
            <form onSubmit={handleRunCustomLogCmd} className="mt-1.5 flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Terminal className="pointer-events-none absolute top-1.5 left-2.5 h-3 w-3 text-[#88f1d1]" />
                <input
                  type="text"
                  value={customCmd}
                  onChange={(e) => setCustomCmd(e.target.value)}
                  placeholder="Stream any shell command (e.g. npm run dev, docker compose logs -f)…"
                  className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-1 pr-2.5 pl-7 text-[10px] text-white outline-none focus:border-[#88f1d1]/50"
                />
              </div>
              <button
                type="submit"
                disabled={!isConnected || !customCmd.trim()}
                className="rounded-full bg-[#88f1d1]/20 px-2.5 py-1 text-[9.5px] font-extrabold text-[#88f1d1] disabled:opacity-40"
              >
                RUN
              </button>
            </form>
          </>
        )}

        {/* TAB 2: HEAVY CPU / RAM HOGS & ACTIVE DEV PORTS */}
        {tab === 'hogs' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            {/* Sort & Search Bar */}
            <div className="flex items-center gap-1.5">
              <div className="flex shrink-0 rounded-full bg-black/70 p-0.5">
                {(
                  [
                    ['cpu', 'Sort CPU %', '#ff5d6c'],
                    ['mem', 'Sort RAM %', '#a78bfa'],
                  ] as const
                ).map(([sId, sLabel, col]) => (
                  <button
                    key={sId}
                    type="button"
                    onClick={() => setHogSort(sId)}
                    className="rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase"
                    style={{
                      background: hogSort === sId ? `${col}26` : 'transparent',
                      color: hogSort === sId ? col : '#7c8190',
                    }}
                  >
                    {sLabel}
                  </button>
                ))}
              </div>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1.5 left-2 h-3 w-3 text-[#7c8190]" />
                <input
                  type="search"
                  value={hogQuery}
                  onChange={(e) => setHogQuery(e.target.value)}
                  placeholder="Filter process or PID…"
                  className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-0.5 pr-2 pl-6 text-[10px] text-white outline-none"
                />
              </div>
            </div>

            <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {/* Active Dev Ports Quick Section */}
              {deck.ports.length > 0 && (
                <div className="rounded-xl border border-[#22d3ee]/25 bg-[#08151d] p-2">
                  <div className="mb-1 flex items-center justify-between text-[8.5px] font-extrabold text-[#22d3ee] uppercase">
                    <span>Active Listening Dev Ports ({deck.ports.length})</span>
                    <span className="font-mono-tech text-zinc-400">1-Tap Free Port</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {deck.ports.map((pt) => (
                      <div
                        key={`${pt.port}-${pt.pid}`}
                        className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/50 px-2 py-1 text-[9.5px]"
                      >
                        <span className="font-mono-tech font-extrabold text-[#88f1d1]">
                          :{pt.port}
                        </span>
                        <span className="max-w-[78px] truncate text-zinc-400">{pt.process}</span>
                        <button
                          type="button"
                          onClick={() => {
                            soundEngine.playErrorThud();
                            deck.sendEvent({
                              type: 'port:kill',
                              payload: { requestId: makeRequestId(), pid: pt.pid, port: pt.port },
                            });
                          }}
                          className="rounded bg-[#ff5d6c]/25 px-1.5 py-0.5 text-[8px] font-extrabold text-[#ff5d6c] hover:bg-[#ff5d6c] hover:text-white"
                        >
                          STOP
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Heavy Processes List */}
              {sortedHogs.map((proc) => {
                const cpuBar = Math.min(100, proc.cpuPct);
                return (
                  <div
                    key={proc.pid}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11.5px] font-bold text-white">
                          {proc.name}
                        </span>
                        <span className="font-mono-tech rounded bg-white/[0.06] px-1.5 py-0.5 text-[8.5px] text-zinc-400">
                          PID {proc.pid}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(4, cpuBar)}%`,
                              background:
                                proc.cpuPct >= 60
                                  ? '#ff5d6c'
                                  : proc.cpuPct >= 25
                                    ? '#fbbf24'
                                    : '#34d399',
                            }}
                          />
                        </div>
                        <span className="font-mono-tech shrink-0 text-[9.5px] font-extrabold text-[#fbbf24]">
                          CPU {proc.cpuPct}%
                        </span>
                        <span className="font-mono-tech shrink-0 text-[9.5px] text-[#c4b5fd]">
                          RAM {proc.memPct}%
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={() => {
                          soundEngine.playClick();
                          deck.sendEvent({
                            type: 'process:kill',
                            payload: {
                              requestId: makeRequestId(),
                              pid: proc.pid,
                              expectedName: proc.name,
                              force: false,
                            },
                          });
                        }}
                        className="rounded-lg border border-[#fbbf24]/35 bg-[#fbbf24]/15 px-2 py-1 text-[8.5px] font-extrabold text-[#fbbf24]"
                      >
                        QUIT
                      </motion.button>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={() => {
                          soundEngine.playErrorThud();
                          deck.sendEvent({
                            type: 'process:kill',
                            payload: {
                              requestId: makeRequestId(),
                              pid: proc.pid,
                              expectedName: proc.name,
                              force: true,
                            },
                          });
                        }}
                        className="rounded-lg bg-[#e5484d] px-2 py-1 text-[8.5px] font-extrabold text-white"
                      >
                        KILL -9
                      </motion.button>
                    </div>
                  </div>
                );
              })}

              {sortedHogs.length === 0 && (
                <div className="sub grid h-32 place-items-center text-center">
                  {isConnected ? 'No matching heavy processes' : 'Connect computer to view CPU hogs'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: PROFESSIONAL DOCKER CONTAINER STUDIO */}
        {tab === 'docker' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            {/* Docker Batch Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-white/[0.07] bg-black/55 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: !isConnected
                      ? '#6b7080'
                      : deck.docker.available
                        ? '#34d399'
                        : '#fbbf24',
                  }}
                />
                <span className="font-mono-tech text-[9.5px] font-extrabold text-white">
                  {!isConnected
                    ? 'OFFLINE'
                    : deck.docker.available
                      ? `ENGINE READY · ${runningContainersCount}/${deck.docker.containers.length} UP`
                      : 'ENGINE STOPPED'}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {!deck.docker.available ? (
                  <button
                    type="button"
                    disabled={!isConnected}
                    onClick={() => {
                      soundEngine.playClick();
                      deck.sendEvent({
                        type: 'docker:action',
                        payload: {
                          requestId: makeRequestId(),
                          id: '__daemon__',
                          action: 'launch_daemon',
                        },
                      });
                    }}
                    className="flex items-center gap-1 rounded-lg bg-[#22d3ee] px-2.5 py-1 text-[8.5px] font-extrabold text-[#041317] disabled:opacity-40"
                  >
                    <Power className="h-2.5 w-2.5" />
                    START DOCKER ENGINE
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: '__compose__',
                            action: 'compose_up',
                          },
                        });
                        setTab('logs');
                      }}
                      className="rounded-lg border border-[#22d3ee]/35 bg-[#22d3ee]/15 px-2 py-0.5 text-[8.5px] font-extrabold text-[#22d3ee]"
                    >
                      COMPOSE UP
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: '__compose__',
                            action: 'compose_down',
                          },
                        });
                        setTab('logs');
                      }}
                      className="rounded-lg border border-white/15 bg-white/[0.07] px-2 py-0.5 text-[8.5px] font-extrabold text-zinc-300"
                    >
                      DOWN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: '__all__',
                            action: 'start_all',
                          },
                        });
                      }}
                      className="rounded-lg border border-[#34d399]/35 bg-[#34d399]/15 px-2 py-0.5 text-[8.5px] font-extrabold text-[#34d399]"
                    >
                      START ALL
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: '__all__',
                            action: 'stop_all',
                          },
                        });
                      }}
                      className="rounded-lg border border-[#fbbf24]/35 bg-[#fbbf24]/15 px-2 py-0.5 text-[8.5px] font-extrabold text-[#fbbf24]"
                    >
                      STOP ALL
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'docker:action',
                          payload: {
                            requestId: makeRequestId(),
                            id: '__prune__',
                            action: 'prune',
                          },
                        });
                      }}
                      className="rounded-lg border border-[#ff5d6c]/35 bg-[#ff5d6c]/15 px-2 py-0.5 text-[8.5px] font-extrabold text-[#ff5d6c]"
                    >
                      PRUNE
                    </button>
                  </>
                )}
              </div>
            </div>

            {deck.docker.containers.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1.5 left-2.5 h-3 w-3 text-[#7c8190]" />
                <input
                  type="search"
                  value={dockerQuery}
                  onChange={(e) => setDockerQuery(e.target.value)}
                  placeholder="Filter container, image, or port…"
                  className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-0.5 pr-2.5 pl-7 text-[10px] text-white outline-none"
                />
              </div>
            )}

            <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {filteredContainers.map((c) => {
                const running = c.state.toLowerCase() === 'running';
                return (
                  <div
                    key={c.id}
                    className="flex flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <i
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: running ? '#34d399' : '#6b7080' }}
                          />
                          <span className="truncate text-[11.5px] font-extrabold text-white">
                            {c.name}
                          </span>
                          {c.image && (
                            <span className="font-mono-tech max-w-[130px] truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[8.5px] text-[#7dd3fc]">
                              {c.image}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[9.5px] text-[#9cb4bb]">
                          <span>{c.status}</span>
                          {c.ports && (
                            <span className="font-mono-tech truncate text-[#88f1d1]">
                              {c.ports}
                            </span>
                          )}
                          {running && (c.cpuPct || c.memUsage) && (
                            <span className="font-mono-tech text-[#fbbf24]">
                              {c.cpuPct ? `CPU ${c.cpuPct}` : ''}
                              {c.memUsage ? ` · MEM ${c.memUsage}` : ''}
                            </span>
                          )}
                        </div>
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
                                action: 'logs',
                              },
                            });
                            setTab('logs');
                          }}
                          title={`Stream logs for ${c.name}`}
                          className="flex h-6 items-center gap-1 rounded-lg border border-[#88f1d1]/35 bg-[#88f1d1]/14 px-2 text-[8.5px] font-extrabold text-[#88f1d1]"
                        >
                          <FileText className="h-2.5 w-2.5" />
                          LOGS
                        </button>
                        {running && (
                          <button
                            type="button"
                            onClick={() => {
                              const cmd = window.prompt(`Run command inside ${c.name}:`, 'ls -la');
                              if (!cmd) return;
                              soundEngine.playClick();
                              deck.sendEvent({
                                type: 'docker:action',
                                payload: {
                                  requestId: makeRequestId(),
                                  id: c.id,
                                  action: 'exec',
                                  command: cmd,
                                },
                              });
                              setTab('logs');
                            }}
                            title={`Exec shell command in ${c.name}`}
                            className="flex h-6 items-center gap-1 rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/15 px-2 text-[8.5px] font-extrabold text-[#c4b5fd]"
                          >
                            EXEC
                          </button>
                        )}
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
                          className="h-6 rounded-lg px-2 text-[8.5px] font-extrabold"
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
                          className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.08] text-[#22d3ee]"
                        >
                          <RotateCw className="h-3 w-3" />
                        </button>
                        {!running && (
                          <button
                            type="button"
                            aria-label={`Remove ${c.name}`}
                            onClick={() => {
                              soundEngine.playErrorThud();
                              deck.sendEvent({
                                type: 'docker:action',
                                payload: { requestId: makeRequestId(), id: c.id, action: 'remove' },
                              });
                            }}
                            className="grid h-6 w-6 place-items-center rounded-lg bg-[#ff5d6c]/15 text-[#ff5d6c]"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredContainers.length === 0 && (
                <div className="sub flex h-full flex-col items-center justify-center gap-2 text-center">
                  {!isConnected ? (
                    <span>Connect computer bridge to manage Docker containers</span>
                  ) : deck.docker.available ? (
                    <>
                      <span>No Docker containers found on host</span>
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.playClick();
                          deck.sendEvent({
                            type: 'logs:custom',
                            payload: {
                              requestId: makeRequestId(),
                              command: 'docker images && echo "" && docker info --format "Server Version: {{.ServerVersion}} | Containers: {{.Containers}} | Images: {{.Images}}"',
                              label: 'Docker Images & Engine Info',
                            },
                          });
                          setTab('logs');
                        }}
                        className="rounded-full border border-[#22d3ee]/40 bg-[#22d3ee]/15 px-3 py-1 text-[9.5px] font-extrabold text-[#22d3ee]"
                      >
                        Inspect Local Docker Images in Logs
                      </button>
                    </>
                  ) : (
                    <span>
                      Docker Engine is not running — tap <b>START DOCKER ENGINE</b> above to launch Docker Desktop / OrbStack
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* COLUMN 3: 3-CHANNEL STUDIO HARDWARE POTENTIOMETER (VOLUME / BRIGHTNESS / MIC GAIN) */}
      <div className="tile flex flex-col items-center justify-between gap-1.5 p-2.5">
        <div
          className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full transition-colors"
          style={{ background: activePotColor }}
        />

        {/* Channel Switcher Pills (VOL / BRI / MIC) */}
        <div className="flex w-full items-center justify-between gap-1">
          <div className="grid flex-1 grid-cols-3 gap-1 rounded-full bg-black/75 p-0.5">
            {(
              [
                ['volume', 'VOL', Volume2, '#fbbf24'],
                ['brightness', 'BRI', Sun, '#22d3ee'],
                ['mic', 'MIC', Mic, '#a78bfa'],
              ] as const
            ).map(([ch, label, Icon, col]) => {
              const active = potChannel === ch;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setPotChannel(ch);
                  }}
                  className="flex items-center justify-center gap-1 rounded-full py-1 text-[9px] font-extrabold uppercase transition-colors"
                  style={{
                    background: active ? `${col}26` : 'transparent',
                    color: active ? col : '#7c8190',
                  }}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rotary Potentiometer + Fine Step Buttons (-10% / +10%) */}
        <div className="flex w-full items-center justify-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            aria-label={`Decrease ${potChannel} by 10%`}
            onClick={() => {
              soundEngine.playDetent();
              commitPotValue(potChannel, activePotValue - 10, -10, true);
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 hover:text-white"
          >
            <Minus className="h-3.5 w-3.5" />
          </motion.button>

          <BrushedDial
            value={isConnected ? activePotValue : 0}
            onChange={(next, delta) => commitPotValue(potChannel, next, delta)}
            accent={activePotColor}
            size={110}
            muted={activePotMuted}
            sublabel={
              potChannel === 'volume'
                ? 'VOLUME'
                : potChannel === 'brightness'
                  ? 'BRIGHT'
                  : 'MIC GAIN'
            }
            label={`Mac ${potChannel} potentiometer`}
          />

          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            aria-label={`Increase ${potChannel} by 10%`}
            onClick={() => {
              soundEngine.playDetent();
              commitPotValue(potChannel, activePotValue + 10, 10, true);
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </motion.button>
        </div>

        {/* 4 Quick Detent Presets (25% / 50% / 75% / 100%) + Mute / Action Button */}
        <div className="w-full space-y-1">
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((presetPct) => {
              const isNear = Math.abs(activePotValue - presetPct) <= 4;
              return (
                <button
                  key={presetPct}
                  type="button"
                  onClick={() => {
                    soundEngine.playDetent();
                    commitPotValue(potChannel, presetPct, presetPct - activePotValue, true);
                  }}
                  className="font-mono-tech h-5 rounded-md border text-[8.5px] font-extrabold transition-colors"
                  style={{
                    background: isNear ? `${activePotColor}24` : 'rgba(255,255,255,0.04)',
                    borderColor: isNear ? activePotColor : 'rgba(255,255,255,0.08)',
                    color: isNear ? activePotColor : '#9cb4bb',
                  }}
                >
                  {presetPct}%
                </button>
              );
            })}
          </div>

          {/* Audio Output Switcher + Custom Resource Alerts Toggle */}
          {potChannel === 'volume' && audioOutputs.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {audioOutputs.slice(0, 4).map((dev) => {
                const active = dev === currentAudioOut || dev === mt?.audioOutputDevice;
                return (
                  <button
                    key={dev}
                    type="button"
                    onClick={() => void switchAudioOutput(dev)}
                    className="shrink-0 truncate rounded-md border px-1.5 py-0.5 text-[8px] font-bold"
                    style={{
                      maxWidth: 96,
                      borderColor: active ? '#fbbf24' : 'rgba(255,255,255,0.08)',
                      background: active ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#fbbf24' : '#9cb4bb',
                    }}
                  >
                    {dev}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                const next = !resourceAlertsOn;
                setResourceAlertsOn(next);
                try {
                  window.localStorage.setItem('devdeck.resAlerts.v1', next ? '1' : '0');
                } catch {}
                deck.showToast(true, next ? 'Resource Alerts ON (RAM >90% / Disk <10GB)' : 'Resource Alerts OFF');
              }}
              className="truncate rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase"
              style={{
                borderColor: resourceAlertsOn ? '#34d399' : 'rgba(255,255,255,0.1)',
                background: resourceAlertsOn ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.04)',
                color: resourceAlertsOn ? '#34d399' : '#9cb4bb',
              }}
            >
              {resourceAlertsOn ? 'ALERTS ON' : 'ALERTS OFF'}
            </button>

            {potChannel === 'volume' && (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'hardware:mute',
                    payload: { requestId: makeRequestId(), muted: !deck.mediaState.muted },
                  });
                }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[9px] font-extrabold"
                style={{ color: deck.mediaState.muted ? '#ff5d6c' : '#fbbf24' }}
              >
                {deck.mediaState.muted ? (
                  <VolumeX className="h-3 w-3" />
                ) : (
                  <Volume2 className="h-3 w-3" />
                )}
                {deck.mediaState.muted ? 'UNMUTE' : 'MUTE'}
              </button>
            )}

            {potChannel === 'brightness' && (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  const next = brightVal > 50 ? 20 : 100;
                  commitPotValue('brightness', next, next - brightVal, true);
                }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-[#22d3ee]/15 px-2.5 py-0.5 text-[9px] font-extrabold text-[#22d3ee]"
              >
                <Sun className="h-3 w-3" />
                {brightVal > 50 ? 'DIM 20%' : 'MAX 100%'}
              </button>
            )}

            {potChannel === 'mic' && (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'system:toggleMic',
                    payload: { requestId: makeRequestId() },
                  });
                }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[9px] font-extrabold"
                style={{ color: mt?.micMuted ? '#ff5d6c' : '#a78bfa' }}
              >
                {mt?.micMuted ? (
                  <MicOff className="h-3 w-3" />
                ) : (
                  <Mic className="h-3 w-3" />
                )}
                {mt?.micMuted ? 'UNMUTE' : 'MUTE MIC'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
