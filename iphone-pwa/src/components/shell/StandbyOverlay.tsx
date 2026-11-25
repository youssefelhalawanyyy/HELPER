'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Battery,
  BatteryCharging,
  CloudSun,
  Coffee,
  Cpu,
  Flame,
  MemoryStick,
  Moon,
  Music,
  Thermometer,
  Wifi,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimer } from '@/lib/formatters';

interface WeatherSnap {
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  wind: number | null;
  sky: string;
}

function skyText(code?: number | null): string {
  if (code == null) return 'Clear';
  if (code < 4) return ['Clear sky', 'Mostly clear', 'Partly cloudy', 'Overcast'][code];
  if (code < 50) return 'Fog';
  if (code < 60) return 'Drizzle';
  if (code < 70) return 'Rain';
  if (code < 80 || code === 85 || code === 86) return 'Snow';
  if (code < 90) return 'Showers';
  return 'Storms';
}

function OledRingGauge({
  label,
  valueText,
  pct,
  color,
  icon,
}: {
  label: string;
  valueText: string;
  pct: number;
  color: string;
  icon: React.ReactNode;
}) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dashOffset = circ * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative grid h-[76px] w-[76px] place-items-center">
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 76 76" aria-hidden="true">
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="4.5"
          />
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="flex flex-col items-center justify-center text-center">
          <span className="mb-0.5 opacity-75" style={{ color }}>
            {icon}
          </span>
          <span className="font-mono-tech text-[13px] font-bold tracking-tight text-white/90">
            {valueText}
          </span>
        </div>
      </div>
      <span className="font-mono-tech text-[9px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
        {label}
      </span>
    </div>
  );
}

export function StandbyOverlay({
  deck,
  onWake,
}: {
  deck: DevDeckState;
  onWake: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  const [weather, setWeather] = useState<WeatherSnap | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const clockId = window.setInterval(() => setNow(new Date()), 1000);
    // Subtle OLED burn-in drift every 3 minutes
    const driftSteps = [
      { x: 0, y: 0 },
      { x: 4, y: -3 },
      { x: -3, y: 4 },
      { x: 3, y: 3 },
      { x: -4, y: -2 },
    ];
    let idx = 0;
    const driftId = window.setInterval(() => {
      idx = (idx + 1) % driftSteps.length;
      setDrift(driftSteps[idx]);
    }, 180_000);

    // Fetch lightweight weather once (Cairo default, 15m TTL)
    const params = new URLSearchParams({
      latitude: '30.0444',
      longitude: '31.2357',
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      timezone: 'auto',
    });
    void fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      .then((r) => r.json())
      .then((d: { current?: Record<string, number | null> }) => {
        if (d?.current?.temperature_2m != null) {
          setWeather({
            temp: Math.round(d.current.temperature_2m),
            feels: d.current.apparent_temperature != null ? Math.round(d.current.apparent_temperature) : null,
            humidity: d.current.relative_humidity_2m != null ? Math.round(d.current.relative_humidity_2m) : null,
            wind: d.current.wind_speed_10m != null ? Math.round(d.current.wind_speed_10m) : null,
            sky: skyText(d.current.weather_code),
          });
        }
      })
      .catch(() => {});

    return () => {
      window.clearInterval(clockId);
      window.clearInterval(driftId);
    };
  }, []);

  if (!mounted) return null;

  const hours24 = now.getHours();
  const isOvernight = hours24 >= 23 || hours24 < 6;
  const h12 = hours24 % 12 || 12;
  const mins = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const isConnected = deck.status === 'connected';
  const cpuPct = Math.round(deck.stats.cpuPct || 0);
  const cpuTemp = deck.powerState.cpuTempC;
  const heatColor =
    cpuTemp === null
      ? '#64748b'
      : cpuTemp >= deck.powerState.overheatTempC
        ? '#f87171'
        : cpuTemp >= Math.max(58, deck.powerState.overheatTempC - 13)
          ? '#fbbf24'
          : '#5eead4';
  const battPct = deck.stats.batteryPct ?? deck.powerState.batteryPct ?? null;
  const charging = Boolean(deck.stats.batteryCharging || deck.powerState.isCharging);
  const battColor =
    battPct === null ? '#64748b' : charging ? '#4ade80' : battPct <= 20 ? '#f87171' : '#7dd3fc';

  const handleWake = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onWake();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      data-no-swipe="true"
      onPointerDown={handleWake}
      onTouchStart={handleWake}
      className="fixed inset-0 z-[9998] flex h-[100dvh] w-[100vw] cursor-pointer select-none items-center justify-center overflow-hidden bg-black px-6 py-5"
    >
      {/* Dim OLED Container (extra-low brightness overnight to save battery) */}
      <div
        className="grid w-full max-w-[820px] grid-cols-1 items-center gap-6 sm:grid-cols-12"
        style={{
          opacity: isOvernight ? 0.58 : 0.78,
          transform: `translate3d(${drift.x}px, ${drift.y}px, 0)`,
          transition: 'transform 2s ease, opacity 0.6s ease',
        }}
      >
        {/* LEFT: Minimal Luxury Time, Date & Weather */}
        <div className="flex flex-col items-start justify-center sm:col-span-6">
          <div className="mb-1 flex items-center gap-2 font-mono-tech text-[10px] font-semibold tracking-[0.22em] text-[#5eead4]/75 uppercase">
            <Moon className="h-3 w-3" />
            <span>{isOvernight ? 'OLED Night StandBy' : 'OLED Dim StandBy'}</span>
          </div>

          <div className="flex items-baseline gap-2 leading-none">
            <span
              className="font-mono-tech font-light tracking-[-0.04em] text-white/95"
              style={{ fontSize: 'clamp(58px, 11.5vw, 102px)' }}
            >
              {h12}
              <span className="mx-0.5 opacity-45">:</span>
              {mins}
            </span>
            <span className="font-mono-tech text-lg font-medium tracking-widest text-[#5eead4]/70">
              {ampm}
            </span>
          </div>

          <div className="mt-1.5 text-sm font-medium tracking-wide text-zinc-400">{dateStr}</div>

          {/* Live Weather Strip */}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2">
            <div className="flex items-center gap-2">
              <CloudSun className="h-5 w-5 text-[#fbbf24]/80" />
              <span className="font-mono-tech text-lg font-bold text-white/90">
                {weather?.temp != null ? `${weather.temp}°` : '--°'}
              </span>
            </div>
            <div className="h-5 w-px bg-white/10" />
            <div className="text-[11px] leading-tight text-zinc-400">
              <div className="font-semibold text-zinc-200">{weather?.sky || 'Cairo'}</div>
              <div className="font-mono-tech text-[9.5px] text-zinc-500">
                {weather?.feels != null ? `Feels ${weather.feels}°` : 'Live weather'}
                {weather?.humidity != null ? ` · ${weather.humidity}% RH` : ''}
                {weather?.wind != null ? ` · ${weather.wind} km/h` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Summary OLED Gauges & System Details */}
        <div className="flex flex-col gap-4 rounded-3xl border border-white/[0.06] bg-white/[0.015] p-4 sm:col-span-6">
          {/* 3 Summary Ring Gauges */}
          <div className="flex items-center justify-around gap-2">
            <OledRingGauge
              label="CPU"
              valueText={isConnected ? `${cpuPct}%` : '--'}
              pct={isConnected ? cpuPct : 0}
              color={cpuPct > 80 ? '#f87171' : cpuPct > 55 ? '#fbbf24' : '#5eead4'}
              icon={<Cpu className="h-3.5 w-3.5" />}
            />
            <OledRingGauge
              label="Heat"
              valueText={isConnected && cpuTemp !== null ? `${Math.round(cpuTemp)}°` : '--'}
              pct={isConnected && cpuTemp !== null ? Math.min(100, (cpuTemp / 100) * 100) : 0}
              color={heatColor}
              icon={<Thermometer className="h-3.5 w-3.5" />}
            />
            <OledRingGauge
              label={charging ? 'Charging' : 'Battery'}
              valueText={isConnected && battPct !== null ? `${battPct}%` : '--'}
              pct={isConnected && battPct !== null ? battPct : 0}
              color={battColor}
              icon={
                charging ? (
                  <BatteryCharging className="h-3.5 w-3.5" />
                ) : (
                  <Battery className="h-3.5 w-3.5" />
                )
              }
            />
          </div>

          {/* Clean System Summary Details */}
          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3 text-[10.5px]">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Wifi className="h-3.5 w-3.5 shrink-0" style={{ color: isConnected ? '#4ade80' : '#f87171' }} />
              <span className="truncate font-semibold text-zinc-200">
                {isConnected ? deck.hello?.hostname || 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center justify-end gap-1.5 font-mono-tech text-zinc-400">
              <MemoryStick className="h-3.5 w-3.5 shrink-0 text-[#a78bfa]/80" />
              <span>
                {isConnected
                  ? `${deck.stats.ramUsedGb.toFixed(1)}/${deck.stats.ramTotalGb.toFixed(0)}G RAM`
                  : 'RAM --'}
              </span>
            </div>

            {deck.caffeineActive && (
              <div className="flex items-center gap-1.5 text-[#fbbf24]/85">
                <Coffee className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">Caffeine Awake</span>
              </div>
            )}

            {deck.focusState.active && (
              <div className="flex items-center gap-1.5 font-mono-tech text-[#fbbf24]">
                <Flame className="h-3.5 w-3.5 shrink-0" />
                <span>Focus {formatTimer(deck.focusState.remainingSec)}</span>
              </div>
            )}

            {deck.mediaState.playing && deck.mediaState.track && (
              <div className="col-span-2 flex items-center gap-1.5 truncate text-zinc-400">
                <Music className="h-3.5 w-3.5 shrink-0 text-[#5eead4]/75" />
                <span className="truncate">{deck.mediaState.track}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subtle Bottom Wake Hint */}
      <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 font-mono-tech text-[9px] tracking-[0.2em] text-zinc-600 uppercase">
        Touch anywhere to wake DevDeck
      </div>
    </motion.div>,
    document.body,
  );
}
