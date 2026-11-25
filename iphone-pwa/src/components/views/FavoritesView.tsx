'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Coffee,
  Cpu,
  FolderOpen,
  Gauge,
  HeartPulse,
  Lock,
  MemoryStick,
  Mic,
  MicOff,
  Monitor,
  Settings2,
  Sliders,
  Sparkles,
  Sun,
  Thermometer,
  Unlock,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { DeckViewId } from '@/components/shell/LeftNavRail';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const STORAGE_PINS = 'devdeck.favorites.pins.v1';

interface FavoriteWidgetDef {
  id: string;
  label: string;
  sub: string;
  accent: string;
}

const ALL_WIDGETS: FavoriteWidgetDef[] = [
  { id: 'caffeine', label: 'Caffeine Lock', sub: 'Keep Mac/PC awake', accent: '#fbbf24' },
  { id: 'cpu_heat', label: 'CPU Heat & Load', sub: 'Live die temp + tap Power', accent: '#34d399' },
  { id: 'volume_mute', label: 'Audio Mute / Vol', sub: 'Instant mute toggle', accent: '#7dd3fc' },
  { id: 'mic_mute', label: 'Mic Mute', sub: 'System-wide mic toggle', accent: '#ff5d6c' },
  { id: 'wake_pc', label: 'Wake Display', sub: 'Wake sleeping screen', accent: '#88f1d1' },
  { id: 'lock_pc', label: 'Lock Screen', sub: 'Lock computer instantly', accent: '#f472b6' },
  { id: 'super_mode', label: 'SUPER Mode', sub: 'Heavy apps & High RAM', accent: '#a78bfa' },
  { id: 'eco_mode', label: 'ECO Mode', sub: 'Save battery & cool down', accent: '#34d399' },
  { id: 'turbo_mode', label: 'TURBO Mode', sub: 'Max GPU & cooling', accent: '#fbbf24' },
  { id: 'flush_ram', label: 'Flush RAM', sub: 'Purge inactive memory', accent: '#a78bfa' },
  { id: 'screen_preview', label: 'Live Screen', sub: 'Open Trackpad & Preview', accent: '#88f1d1' },
  { id: 'airdrop', label: 'Files & AirDrop', sub: 'Send/Get PC files', accent: '#7dd3fc' },
  { id: 'studio_2fa', label: 'Meeting & 2FA', sub: 'Open Studio & Tools', accent: '#fbbf24' },
  { id: 'pc_doctor', label: 'Scan PC Health', sub: 'Run 10-point checkup', accent: '#34d399' },
  { id: 'speed_test', label: 'Wi-Fi Speed', sub: 'Open NetOps Pro', accent: '#22d3ee' },
  { id: 'nour_voice', label: 'Talk to Nour', sub: 'Egyptian Arabic Voice AI', accent: '#f472b6' },
];

const DEFAULT_PINS = [
  'cpu_heat',
  'caffeine',
  'volume_mute',
  'mic_mute',
  'super_mode',
  'wake_pc',
  'screen_preview',
  'airdrop',
];

export function FavoritesView({
  deck,
  onNavigate,
}: {
  deck: DevDeckState;
  onNavigate: (view: DeckViewId) => void;
}) {
  const [pins, setPins] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_PINS;
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_PINS) || 'null');
      return Array.isArray(saved) && saved.length > 0 ? saved.slice(0, 8) : DEFAULT_PINS;
    } catch {
      return DEFAULT_PINS;
    }
  });
  const [editing, setEditing] = useState(false);

  const togglePin = (id: string) => {
    soundEngine.playClick();
    setPins((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 8);
      try {
        window.localStorage.setItem(STORAGE_PINS, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const runWidget = (id: string) => {
    soundEngine.playClick();
    const requestId = makeRequestId();
    switch (id) {
      case 'caffeine':
        deck.sendEvent({ type: 'hardware:caffeine', payload: { requestId, active: !deck.caffeineActive } });
        break;
      case 'cpu_heat':
        onNavigate('power');
        break;
      case 'volume_mute':
        deck.sendEvent({ type: 'hardware:mute', payload: { requestId, muted: !deck.mediaState.muted } });
        break;
      case 'mic_mute':
        deck.sendEvent({ type: 'system:toggleMic', payload: { requestId } });
        break;
      case 'wake_pc':
        deck.sendEvent({ type: 'hardware:wake', payload: { requestId } });
        break;
      case 'lock_pc':
        deck.sendEvent({ type: 'hardware:lock', payload: { requestId } });
        break;
      case 'super_mode':
        deck.sendEvent({ type: 'perf:setMode', payload: { requestId, mode: 'super' } });
        break;
      case 'eco_mode':
        deck.sendEvent({ type: 'perf:setMode', payload: { requestId, mode: 'eco' } });
        break;
      case 'turbo_mode':
        deck.sendEvent({ type: 'perf:setMode', payload: { requestId, mode: 'turbo' } });
        break;
      case 'flush_ram':
        deck.sendEvent({ type: 'perf:toggle', payload: { requestId, setting: 'freeRam' } });
        break;
      case 'screen_preview':
        onNavigate('hardware');
        break;
      case 'airdrop':
        onNavigate('files');
        break;
      case 'studio_2fa':
        onNavigate('studio');
        break;
      case 'pc_doctor':
        onNavigate('doctor');
        deck.sendEvent({ type: 'doctor:scan', payload: { requestId } });
        break;
      case 'speed_test':
        onNavigate('network');
        break;
      case 'nour_voice':
        onNavigate('nour');
        break;
    }
  };

  const renderIcon = (id: string, color: string) => {
    const cls = 'h-5 w-5';
    switch (id) {
      case 'caffeine': return <Coffee className={cls} style={{ color }} />;
      case 'cpu_heat': return <Thermometer className={cls} style={{ color }} />;
      case 'volume_mute': return deck.mediaState.muted ? <VolumeX className={cls} style={{ color: '#ff5d6c' }} /> : <Volume2 className={cls} style={{ color }} />;
      case 'mic_mute': return deck.macTelemetry?.micMuted ? <MicOff className={cls} style={{ color: '#ff5d6c' }} /> : <Mic className={cls} style={{ color }} />;
      case 'wake_pc': return <Unlock className={cls} style={{ color }} />;
      case 'lock_pc': return <Lock className={cls} style={{ color }} />;
      case 'super_mode': return <Zap className={cls} style={{ color }} />;
      case 'eco_mode': return <Sun className={cls} style={{ color }} />;
      case 'turbo_mode': return <Sliders className={cls} style={{ color }} />;
      case 'flush_ram': return <MemoryStick className={cls} style={{ color }} />;
      case 'screen_preview': return <Monitor className={cls} style={{ color }} />;
      case 'airdrop': return <FolderOpen className={cls} style={{ color }} />;
      case 'studio_2fa': return <Sparkles className={cls} style={{ color }} />;
      case 'pc_doctor': return <HeartPulse className={cls} style={{ color }} />;
      case 'speed_test': return <Gauge className={cls} style={{ color }} />;
      case 'nour_voice': return <Activity className={cls} style={{ color }} />;
      default: return <Cpu className={cls} style={{ color }} />;
    }
  };

  const getLiveValue = (id: string): string => {
    if (id === 'cpu_heat') {
      const t = deck.powerState.cpuTempC !== null ? `${deck.powerState.cpuTempC.toFixed(1)}°C` : '--°C';
      return `${t} · ${Math.round(deck.stats.cpuPct)}% CPU`;
    }
    if (id === 'caffeine') return deck.caffeineActive ? 'ACTIVE (AWAKE)' : 'OFF';
    if (id === 'volume_mute') return deck.mediaState.muted ? 'MUTED' : `VOL ${deck.mediaState.volume}%`;
    if (id === 'mic_mute') return deck.macTelemetry?.micMuted ? 'MIC MUTED' : 'MIC LIVE';
    if (id === 'super_mode' || id === 'eco_mode' || id === 'turbo_mode') {
      return `Current: ${deck.perfState.mode.toUpperCase()}`;
    }
    return ALL_WIDGETS.find((w) => w.id === id)?.sub || '';
  };

  return (
    <div className="tile flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#88f1d1] via-[#fbbf24] to-[#a78bfa]" />

      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="disp text-[19px]">My Favorites Dashboard</div>
          <div className="text-[10px] text-[#9cb4bb]">
            Your top {pins.length}/8 pinned controls &amp; live gauges on one custom screen
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            setEditing((e) => !e);
          }}
          className="flex h-7 items-center gap-1 rounded-full border px-3 text-[10px] font-extrabold uppercase"
          style={{
            borderColor: editing ? '#88f1d1' : 'rgba(255,255,255,0.14)',
            background: editing ? 'rgba(136,241,209,0.2)' : 'rgba(255,255,255,0.06)',
            color: editing ? '#88f1d1' : '#effaf7',
          }}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {editing ? 'Done' : 'Customize (8)'}
        </button>
      </div>

      {editing ? (
        <div className="deck-scroll grid min-h-0 flex-1 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-4">
          {ALL_WIDGETS.map((w) => {
            const active = pins.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => togglePin(w.id)}
                className="flex flex-col justify-between rounded-xl border p-2.5 text-left transition-colors"
                style={{
                  borderColor: active ? w.accent : 'rgba(255,255,255,0.08)',
                  background: active ? `${w.accent}1c` : 'rgba(0,0,0,0.45)',
                }}
              >
                <div className="flex items-center justify-between">
                  {renderIcon(w.id, w.accent)}
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[8px] font-extrabold uppercase"
                    style={{
                      background: active ? w.accent : 'rgba(255,255,255,0.08)',
                      color: active ? '#041410' : '#9cb4bb',
                    }}
                  >
                    {active ? 'PINNED' : '+ PIN'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-[11px] font-extrabold text-white">{w.label}</div>
                  <div className="text-[9px] text-[#9cb4bb]">{w.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {pins.map((id) => {
            const w = ALL_WIDGETS.find((item) => item.id === id);
            if (!w) return null;
            const isHighlighted =
              (id === 'caffeine' && deck.caffeineActive) ||
              (id === 'super_mode' && deck.perfState.mode === 'super') ||
              (id === 'eco_mode' && deck.perfState.mode === 'eco') ||
              (id === 'turbo_mode' && deck.perfState.mode === 'turbo');
            return (
              <motion.button
                key={id}
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => runWidget(id)}
                className="flex flex-col justify-between rounded-2xl border p-3 text-left transition-colors"
                style={{
                  borderColor: isHighlighted ? w.accent : 'rgba(152,200,206,0.2)',
                  background: isHighlighted
                    ? `linear-gradient(145deg, ${w.accent}24, rgba(8,21,28,0.92))`
                    : 'rgba(8,21,28,0.78)',
                }}
              >
                <div className="flex items-center justify-between">
                  {renderIcon(id, w.accent)}
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: isHighlighted ? w.accent : 'rgba(255,255,255,0.14)' }}
                  />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-white">{w.label}</div>
                  <div className="font-mono-tech mt-0.5 text-[9.5px] font-bold" style={{ color: w.accent }}>
                    {getLiveValue(id)}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
