'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BatteryCharging,
  CloudSun,
  Cpu,
  ExternalLink,
  Globe,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimer, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

function extractUrl(text: string): string | null {
  const match = text.trim().match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}

function formatWorldClock(date: Date, timeZone: string): string {
  try {
    return date.toLocaleTimeString([], {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--';
  }
}

export function PreviewAmbientView({ deck }: { deck: DevDeckState }) {
  const [mode, setMode] = useState<'ambient' | 'preview'>('ambient');
  const [urlInput, setUrlInput] = useState(deck.previewUrl);
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<{ tempC: number; label: string } | null>(null);
  const [breakSec, setBreakSec] = useState<number>(0);

  useEffect(() => setUrlInput(deck.previewUrl), [deck.previewUrl]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Quick 5m / 10m / 15m break countdown with Web Audio chime
  useEffect(() => {
    if (breakSec <= 0) return;
    const t = window.setInterval(() => {
      setBreakSec((prev) => {
        if (prev <= 1) {
          soundEngine.playSuccessChime();
          deck.triggerFlash('success', 'Break timer complete!');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [breakSec, deck]);

  // Free keyless live local weather via Open-Meteo
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async (lat: number, lon: number) => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`,
        );
        const data = (await res.json()) as {
          current?: { temperature_2m?: number; weather_code?: number };
        };
        if (cancelled || data.current?.temperature_2m === undefined) return;
        const code = data.current.weather_code ?? 0;
        const label =
          code === 0 ? 'Clear' : code <= 3 ? 'Cloudy' : code < 70 ? 'Rain' : 'Storm';
        setWeather({ tempC: Math.round(data.current.temperature_2m), label });
      } catch {
        // Ignore offline weather fetch
      }
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => void fetchWeather(30.0444, 31.2357), // Fallback Cairo
        { timeout: 3000 },
      );
    } else {
      void fetchWeather(30.0444, 31.2357);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedUrl = useMemo(() => {
    const raw = deck.previewUrl || 'http://localhost:3000';
    if (!deck.hello?.lanIp) return raw;
    return raw.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `//${deck.hello.lanIp}`);
  }, [deck.previewUrl, deck.hello?.lanIp]);

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const secStr = String(now.getSeconds()).padStart(2, '0');
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const isConnected = deck.status === 'connected';

  if (mode === 'preview') {
    return (
      <div className="tile preview-browser flex min-h-0 flex-1 flex-col p-2.5">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('ambient')}
            className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-console-caption font-bold"
          >
            <Moon className="h-3 w-3 text-[#22d3ee]" />
            Desk Clock
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              deck.sendEvent({
                type: 'preview:set',
                payload: { requestId: makeRequestId(), url: urlInput.trim() },
              });
            }}
            className="flex flex-1 gap-1.5"
          >
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="font-mono-tech flex-1 rounded-full border border-white/10 bg-black px-3 py-1 text-console-caption text-white outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-[#34d399] px-3 py-1 text-console-caption font-extrabold text-[#04130c]"
            >
              Sync
            </button>
          </form>
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.08] text-[#22d3ee]"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <iframe
          src={resolvedUrl}
          title="Localhost Preview"
          className="min-h-0 flex-1 rounded-xl border border-white/10 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="screen-grid layout-clock">
      {/* Left: OLED Desk Clock + Weather + World Clocks + Quick Break Timers + Mac Stats */}
      <div className="tile flex flex-col justify-between p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#60a5fa]" />

        {/* Header: Date + Live Weather + Preview Switch */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="sub">{dateStr}</span>
            {weather && (
              <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-console-caption font-bold text-[#fbbf24]">
                <CloudSun className="h-3 w-3" />
                {weather.tempC}°C · {weather.label}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setMode('preview');
            }}
            className="flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-0.5 text-console-caption font-bold text-[#34d399]"
          >
            <Globe className="h-3 w-3" />
            PREVIEW
          </button>
        </div>

        {/* Giant OLED Clock + 3 World Clocks */}
        <div className="flex items-center justify-between gap-2">
          <div className="num flex items-baseline gap-1">
            <span className="disp text-[58px] tracking-tight">{timeStr}</span>
            <span className="text-[18px] font-extrabold text-[#60a5fa]">:{secStr}</span>
          </div>

          <div className="num space-y-1 text-right text-console-caption">
            {[
              ['CAI', 'Africa/Cairo'],
              ['LON', 'Europe/London'],
              ['NYC', 'America/New_York'],
            ].map(([code, tz]) => (
              <div key={code} className="flex items-center justify-end gap-1.5">
                <span className="sub !text-console-micro">{code}</span>
                <span className="font-bold text-zinc-200">{formatWorldClock(now, tz)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick 5m / 10m / 15m Break Timers + Live Mac Health Strip */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Timer className="h-3.5 w-3.5 text-[#fbbf24]" />
            {breakSec > 0 ? (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setBreakSec(0);
                }}
                className="num rounded-full bg-[#fbbf24] px-2.5 py-0.5 text-console-caption font-extrabold text-black"
              >
                {formatTimer(breakSec)} · STOP
              </button>
            ) : (
              [5, 10, 15].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setBreakSec(m * 60);
                  }}
                  className="rounded-full bg-white/[0.07] px-2 py-0.5 text-console-caption font-bold text-zinc-200 hover:bg-[#fbbf24]/20 hover:text-[#fbbf24]"
                >
                  {m}m
                </button>
              ))
            )}
          </div>

          <div className="num flex items-center gap-2 text-console-caption font-bold text-zinc-300">
            <span className="flex items-center gap-0.5 text-[#22d3ee]">
              <Cpu className="h-3 w-3" />
              {isConnected ? `${deck.stats.cpuPct}%` : '--'}
            </span>
            <span className="flex items-center gap-0.5 text-[#34d399]">
              <BatteryCharging className="h-3 w-3" />
              {isConnected && deck.stats.batteryPct !== null ? `${deck.stats.batteryPct}%` : '--'}
            </span>
          </div>
        </div>

        {/* Mac Media Controls */}
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-black/60 p-2">
          <div className="min-w-0">
            <div className="truncate text-console-body font-bold">{deck.mediaState.track}</div>
            <div className="sub truncate !text-console-micro">{deck.mediaState.artist}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(['prev', 'playpause', 'next'] as const).map((action) => (
              <motion.button
                key={action}
                type="button"
                whileTap={{ scale: 0.88 }}
                transition={DECK_SPRING}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'media:control',
                    payload: { requestId: makeRequestId(), action },
                  });
                }}
                aria-label={action}
                className="grid h-7 w-7 place-items-center rounded-full"
                style={{
                  background: action === 'playpause' ? '#34d399' : 'rgba(255,255,255,.08)',
                  color: action === 'playpause' ? '#04130c' : '#f2f3f7',
                }}
              >
                {action === 'prev' ? (
                  <SkipBack className="h-3 w-3" />
                ) : action === 'next' ? (
                  <SkipForward className="h-3 w-3" />
                ) : deck.mediaState.playing ? (
                  <Pause className="h-3 w-3 fill-current" />
                ) : (
                  <Play className="h-3 w-3 fill-current" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Mac Clipboard History + Automatic "Open on iPhone" URL Detection */}
      <div className="tile flex min-h-0 flex-col p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />
        <div className="mb-2 flex items-center justify-between">
          <div className="disp text-[24px]">Clipboard</div>
          <span className="sub">{deck.clipboard.history.length} items</span>
        </div>

        <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {deck.clipboard.history.map((item) => {
            const detectedUrl = extractUrl(item.text);
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'clipboard:copy',
                      payload: { requestId: makeRequestId(), text: item.text },
                    });
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-mono-tech line-clamp-2 text-console-caption text-zinc-200">
                    {item.text}
                  </p>
                </button>

                {detectedUrl && (
                  <a
                    href={detectedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex shrink-0 items-center gap-1 rounded-full bg-[#22d3ee] px-2 py-1 text-console-caption font-extrabold text-[#041317]"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Open
                  </a>
                )}
              </div>
            );
          })}

          {deck.clipboard.history.length === 0 && (
            <div className="sub grid h-full place-items-center text-center">
              Copy any text or link on your Mac — links get a 1-tap Open on iPhone button
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
