'use client';

import { useState } from 'react';
import {
  AppWindow,
  Flame,
  Link2,
  Sun,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { ConnectionState } from '@/hooks/useDevDeckSocket';
import { formatTimer } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { FocusState, SystemStats } from '@/types/protocol';

interface TopStatusBarProps {
  status: ConnectionState;
  hostname: string;
  stats: SystemStats;
  activeAppName: string;
  focusState: FocusState;
  wakeLockActive: boolean;
  onOpenPairing: () => void;
}

export function TopStatusBar({
  status,
  hostname,
  stats,
  activeAppName,
  focusState,
  wakeLockActive,
  onOpenPairing,
}: TopStatusBarProps) {
  const [audioMuted, setAudioMuted] = useState(false);

  const toggleSound = () => {
    const next = !audioMuted;
    setAudioMuted(next);
    soundEngine.setMuted(next);
    if (!next) soundEngine.playClick();
  };

  const isConnected = status === 'connected';
  const isReconnecting = status === 'reconnecting' || status === 'connecting';

  return (
    <header className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#060608] px-3">
      {/* Left: Connection pill + Mac hostname */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenPairing}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
            isConnected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : isReconnecting
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                : 'border-red-500/35 bg-red-500/10 text-red-300'
          }`}
        >
          {isConnected ? (
            <Wifi className="h-3 w-3 text-emerald-400" />
          ) : (
            <WifiOff className="h-3 w-3 text-amber-400" />
          )}
          <span className="font-mono-tech">
            {isConnected ? hostname || 'Mac Linked' : isReconnecting ? 'Reconnecting…' : 'Unpaired'}
          </span>
        </button>

        {/* Active macOS App Badge */}
        <div className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#111115] px-2 py-0.5 text-[11px] text-zinc-300">
          <AppWindow className="h-3 w-3 text-cyan-400" />
          <span className="max-w-[130px] truncate font-medium">{activeAppName}</span>
        </div>
      </div>

      {/* Center: CPU / RAM Mini Bars */}
      <div className="hidden items-center gap-3 sm:flex">
        <div className="flex items-center gap-1.5">
          <span className="font-mono-tech text-[10px] text-zinc-500">CPU</span>
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                stats.cpuPct > 80 ? 'bg-red-500' : stats.cpuPct > 55 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(100, stats.cpuPct)}%` }}
            />
          </div>
          <span className="font-mono-tech w-7 text-right text-[10px] text-zinc-300">
            {stats.cpuPct}%
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono-tech text-[10px] text-zinc-500">RAM</span>
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                stats.ramPct > 85 ? 'bg-red-500' : stats.ramPct > 65 ? 'bg-amber-400' : 'bg-cyan-400'
              }`}
              style={{ width: `${Math.min(100, stats.ramPct)}%` }}
            />
          </div>
          <span className="font-mono-tech w-7 text-right text-[10px] text-zinc-300">
            {stats.ramPct}%
          </span>
        </div>
      </div>

      {/* Right: Focus Badge + WakeLock + Audio */}
      <div className="flex items-center gap-2">
        {focusState.active && (
          <div className="font-mono-tech flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            <Flame className="h-3 w-3 text-amber-400" />
            <span>{formatTimer(focusState.remainingSec)}</span>
          </div>
        )}

        <div
          title={wakeLockActive ? 'Screen Wake Lock Active' : 'Wake Lock Standby'}
          className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
            wakeLockActive
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
              : 'border-white/[0.08] bg-white/[0.03] text-zinc-500'
          }`}
        >
          <Sun className="h-3 w-3" />
        </div>

        <button
          type="button"
          onClick={toggleSound}
          aria-label={audioMuted ? 'Unmute tactile sounds' : 'Mute tactile sounds'}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/10"
        >
          {audioMuted ? <VolumeX className="h-3.5 w-3.5 text-zinc-500" /> : <Volume2 className="h-3.5 w-3.5 text-cyan-400" />}
        </button>

        <button
          type="button"
          onClick={onOpenPairing}
          aria-label="Connection settings"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-zinc-400 hover:text-zinc-200"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
