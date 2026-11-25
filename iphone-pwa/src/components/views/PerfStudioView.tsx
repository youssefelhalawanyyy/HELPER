'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu,
  Flame,
  Gauge,
  Info,
  Layers,
  Leaf,
  MemoryStick,
  Monitor,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { PerfStudioMode } from '@/types/protocol';

interface ModeDescriptor {
  id: PerfStudioMode;
  title: string;
  badge: string;
  color: string;
  icon: typeof Leaf;
  whenToUse: string;
  whatItDoes: string[];
}

const MODES: ModeDescriptor[] = [
  {
    id: 'normal',
    title: 'NORMAL',
    badge: 'STOCK DEFAULT',
    color: '#7dd3fc',
    icon: ShieldCheck,
    whenToUse:
      'Your laptop/PC default balanced mode right now. Use for everyday browsing, music, writing, and light work.',
    whatItDoes: [
      'Restores default desktop blur & smooth animations',
      'Balanced CPU/GPU clocks & automatic cooling curve',
      'Normal background app priorities',
    ],
  },
  {
    id: 'eco',
    title: 'ECO',
    badge: 'BATTERY & COOL',
    color: '#34d399',
    icon: Leaf,
    whenToUse:
      'Use on battery, in class/travel, or when the laptop gets warm. Cuts power draw & keeps CPU/GPU cool and silent.',
    whatItDoes: [
      'Enables Low Power / Eco profile & Quiet cooling',
      'Reduces GPU transparency & motion effects',
      'Throttles background CPU hogs & dims screen to 55%',
    ],
  },
  {
    id: 'super',
    title: 'SUPER',
    badge: 'HIGH-RAM BIG APPS',
    color: '#a78bfa',
    icon: MemoryStick,
    whenToUse:
      'Use when running big apps that need maximum RAM & fast builds (Antigravity, Xcode, Docker, Android Studio, Premiere, 30+ tabs).',
    whatItDoes: [
      'Flushes standby RAM cache & reclaims memory immediately',
      'Disables heavy GPU desktop blur to free unified VRAM/RAM',
      'Throttles idle background apps & boosts active app priority',
    ],
  },
  {
    id: 'turbo',
    title: 'TURBO',
    badge: 'MAX GRAPHICS / 3D',
    color: '#fbbf24',
    icon: Rocket,
    whenToUse:
      'Use for 3D rendering, gaming, video exports, or local AI models where you want 100% peak CPU + GPU performance.',
    whatItDoes: [
      'Max Performance CPU/GPU clocks & Active Max Cooling',
      'Frees RAM, strips all compositor overhead & 100% brightness',
      'Locks Caffeine ON so machine never sleeps mid-task',
    ],
  },
];

export function PerfStudioView({ deck }: { deck: DevDeckState }) {
  const isConnected = deck.status === 'connected';
  const perf = deck.perfState;
  const stats = deck.stats;
  const power = deck.powerState;

  const recommendation = useMemo(() => {
    if (!isConnected) {
      return {
        mode: 'normal' as PerfStudioMode,
        color: '#9cb4bb',
        text: 'Connect your computer bridge to see live RAM, CPU Heat, and GPU mode recommendations.',
      };
    }
    if (stats.ramPct >= 80) {
      return {
        mode: 'super' as PerfStudioMode,
        color: '#a78bfa',
        text: `RAM is at ${stats.ramPct}% (${stats.ramUsedGb}/${stats.ramTotalGb} GB) — switch to SUPER mode to flush cache & dedicate RAM/VRAM to your big app.`,
      };
    }
    if (
      (power.cpuTempC !== null && power.cpuTempC >= 80) ||
      (!power.isCharging && power.hasBattery && power.batteryPct <= 30)
    ) {
      return {
        mode: 'eco' as PerfStudioMode,
        color: '#34d399',
        text:
          power.cpuTempC !== null && power.cpuTempC >= 80
            ? `CPU is warm (${power.cpuTempC}°C) — switch to ECO mode to cool silicon & throttle background hogs.`
            : `Battery is at ${power.batteryPct}% unplugged — switch to ECO mode to extend battery life.`,
      };
    }
    if (stats.cpuPct >= 75 && power.acConnected) {
      return {
        mode: 'turbo' as PerfStudioMode,
        color: '#fbbf24',
        text: `Heavy workload detected (${stats.cpuPct}% CPU on AC power) — use TURBO or SUPER mode for peak throughput.`,
      };
    }
    return {
      mode: 'normal' as PerfStudioMode,
      color: '#7dd3fc',
      text: `System is balanced (${stats.cpuPct}% CPU · ${stats.ramPct}% RAM) — NORMAL stock mode is ideal right now.`,
    };
  }, [isConnected, stats.ramPct, stats.ramUsedGb, stats.ramTotalGb, stats.cpuPct, power]);

  const [customRules, setCustomRules] = useState<Record<string, PerfStudioMode>>({});
  const [ruleAppInput, setRuleAppInput] = useState('');
  const [ruleModeInput, setRuleModeInput] = useState<PerfStudioMode>('super');

  useEffect(() => {
    if (!isConnected || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    void fetch(`${deck.bridgeBaseUrl}/api/perf/rules`, {
      headers: { authorization: `Bearer ${deck.pairing.token}` },
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; rules?: Record<string, PerfStudioMode> }) => {
        if (d.ok && d.rules) setCustomRules(d.rules);
      })
      .catch(() => {});
  }, [isConnected, deck.bridgeBaseUrl, deck.pairing?.token]);

  const saveAppRule = async (appName: string, mode: PerfStudioMode | null) => {
    if (!isConnected || !deck.bridgeBaseUrl || !deck.pairing?.token || !appName.trim()) return;
    soundEngine.playClick();
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/perf/rules`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deck.pairing.token}`,
        },
        body: JSON.stringify({ appName: appName.trim(), mode }),
      });
      const d = (await res.json()) as { ok?: boolean; rules?: Record<string, PerfStudioMode> };
      if (d.ok && d.rules) {
        setCustomRules(d.rules);
        if (mode) setRuleAppInput('');
        deck.showToast(
          true,
          mode ? `Rule saved: ${appName.trim()} → ${mode.toUpperCase()}` : `Removed rule for ${appName}`,
        );
      }
    } catch {
      deck.showToast(false, 'Could not save app rule');
    }
  };

  const selectMode = (mode: PerfStudioMode) => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Connect your computer bridge first');
      return;
    }
    deck.sendEvent({
      type: 'perf:setMode',
      payload: { requestId: makeRequestId(), mode },
    });
  };

  const triggerToggle = (
    setting: 'reduceTransparency' | 'reduceMotion' | 'freeRam' | 'throttleBg' | 'autoSwitchByApp',
    enabled?: boolean,
  ) => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Connect your computer bridge first');
      return;
    }
    deck.sendEvent({
      type: 'perf:toggle',
      payload: { requestId: makeRequestId(), setting, enabled },
    });
  };

  return (
    <div className="screen-grid grid-cols-1 gap-2 lg:grid-cols-12">
      {/* LEFT (7 cols): 4 Tuned Performance & Graphics Modes with "When to Use" Guidance Notes */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3 lg:col-span-7">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#34d399] via-[#a78bfa] to-[#fbbf24]" />

        {/* Header + Smart Recommendation Pill */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-[#88f1d1]" />
            <span className="disp text-[18px] text-white">Graphics &amp; Performance Modes</span>
          </div>
          <span
            className="font-mono-tech rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase"
            style={{
              background: 'rgba(136,241,209,0.14)',
              color: '#88f1d1',
              border: '1px solid rgba(136,241,209,0.35)',
            }}
          >
            ACTIVE: {perf.mode.toUpperCase()}
          </span>
        </div>

        {/* Live Smart Recommendation Note */}
        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-[10px]"
          style={{
            borderColor: `${recommendation.color}44`,
            background: `${recommendation.color}12`,
            color: '#effaf7',
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: recommendation.color }}
            />
            <span className="leading-snug">{recommendation.text}</span>
          </div>
          {isConnected && perf.mode !== recommendation.mode && (
            <button
              type="button"
              onClick={() => selectMode(recommendation.mode)}
              className="shrink-0 rounded-lg px-2 py-1 text-[8.5px] font-extrabold text-[#061814] uppercase"
              style={{ background: recommendation.color }}
            >
              APPLY {recommendation.mode}
            </button>
          )}
        </div>

        {/* 2x2 Mode Cards Grid with Clear "When to Use" Notes */}
        <div className="deck-scroll grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = perf.mode === m.id;
            return (
              <motion.button
                key={m.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                transition={DECK_SPRING}
                onClick={() => selectMode(m.id)}
                className="flex flex-col justify-between gap-1.5 rounded-2xl border p-3 text-left transition-colors"
                style={{
                  background: active
                    ? `linear-gradient(145deg, ${m.color}22, rgba(7,16,22,0.92))`
                    : 'rgba(8,18,24,0.78)',
                  borderColor: active ? m.color : 'rgba(152,200,206,0.18)',
                  boxShadow: active ? `0 0 18px -6px ${m.color}66` : 'none',
                }}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                      style={{ background: `${m.color}22`, color: m.color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black tracking-wide text-white">
                          {m.title}
                        </span>
                        <span
                          className="font-mono-tech rounded px-1.5 py-0.5 text-[7.5px] font-extrabold"
                          style={{ background: `${m.color}24`, color: m.color }}
                        >
                          {m.badge}
                        </span>
                      </div>
                    </div>
                  </div>
                  {active && (
                    <span
                      className="font-mono-tech rounded-full px-2 py-0.5 text-[8px] font-extrabold text-[#061814]"
                      style={{ background: m.color }}
                    >
                      ON
                    </span>
                  )}
                </div>

                {/* Plain-English "When to Use" Note */}
                <div className="rounded-lg border border-white/[0.06] bg-black/45 px-2 py-1.5 text-[9.5px] leading-snug text-[#d4ebe5]">
                  <span className="mr-1 font-extrabold" style={{ color: m.color }}>
                    When to use:
                  </span>
                  {m.whenToUse}
                </div>

                {/* Bullet Summary of Changes */}
                <ul className="space-y-0.5 text-[9px] text-[#9cb4bb]">
                  {m.whatItDoes.map((line) => (
                    <li key={line} className="truncate">
                      • {line}
                    </li>
                  ))}
                </ul>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* RIGHT (5 cols): Live GPU / RAM / Display Hardware Spec & Direct Graphics Toggles */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3 lg:col-span-5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Monitor className="h-4 w-4 text-[#22d3ee]" />
            <span className="disp text-[17px] text-white">GPU, RAM &amp; Visual Controls</span>
          </div>
          <button
            type="button"
            aria-label="Refresh GPU and display info"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({ type: 'perf:refresh', payload: { requestId: makeRequestId() } });
            }}
            className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        {/* Detected GPU / Display / RAM Hardware Readout */}
        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.08] bg-black/55 p-2.5">
          <div className="col-span-2 flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5">
            <div className="min-w-0">
              <div className="text-[8px] font-bold text-zinc-400 uppercase">
                Graphics Processor (GPU)
              </div>
              <div className="truncate text-xs font-extrabold text-[#88f1d1]">
                {isConnected ? perf.gpuName : 'Offline'}
              </div>
            </div>
            <span className="font-mono-tech shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold text-[#7dd3fc]">
              {perf.vramMb ? `${Math.round(perf.vramMb / 1024)} GB VRAM` : 'Unified GPU'}
            </span>
          </div>

          <div>
            <div className="text-[8px] font-bold text-zinc-400 uppercase">Display Output</div>
            <div className="font-mono-tech truncate text-[10px] font-bold text-white">
              {isConnected ? perf.displayInfo : '--'}
            </div>
          </div>

          <div>
            <div className="text-[8px] font-bold text-zinc-400 uppercase">RAM / Heat</div>
            <div className="font-mono-tech truncate text-[10px] font-bold text-[#fbbf24]">
              {isConnected
                ? `${stats.ramUsedGb}/${stats.ramTotalGb}G (${stats.ramPct}%) · ${
                    power.cpuTempC !== null ? `${power.cpuTempC}°C` : '--'
                  }`
                : '--'}
            </div>
          </div>
        </div>

        {/* Direct Individual Graphics & Memory Toggles */}
        <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {/* Auto-Switch Profiles by Active App */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#88f1d1]/35 bg-[#88f1d1]/10 px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-white">
                <Sparkles className="h-3.5 w-3.5 text-[#88f1d1]" />
                Auto-Switch Mode by Active App
              </div>
              <div className="text-[8.5px] text-[#b8d0d6]">
                SUPER for Xcode/Docker/Premiere/Antigravity · TURBO for 3D/Games · NORMAL otherwise
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerToggle('autoSwitchByApp', !perf.autoSwitchByApp)}
              className="shrink-0 rounded-full px-2.5 py-1 text-[8.5px] font-extrabold uppercase"
              style={{
                background: perf.autoSwitchByApp ? '#88f1d133' : 'rgba(255,255,255,0.08)',
                color: perf.autoSwitchByApp ? '#88f1d1' : '#9ca3af',
              }}
            >
              {perf.autoSwitchByApp ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Custom Per-App Auto-Switch Rules Editor */}
          <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-black/55 px-2.5 py-2">
            <div className="text-[9px] font-extrabold tracking-wider text-[#7dd3fc] uppercase">
              Custom App Rules ({Object.keys(customRules).length})
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={ruleAppInput}
                onChange={(e) => setRuleAppInput(e.target.value)}
                placeholder="App name (e.g. Chrome, Figma)…"
                className="h-6 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#071117] px-2 text-[9.5px] text-white outline-none"
              />
              <select
                value={ruleModeInput}
                onChange={(e) => setRuleModeInput(e.target.value as PerfStudioMode)}
                className="h-6 rounded-lg border border-white/10 bg-[#071117] px-1.5 text-[9px] font-bold text-[#88f1d1] outline-none"
              >
                <option value="eco">ECO</option>
                <option value="normal">NORMAL</option>
                <option value="super">SUPER</option>
                <option value="turbo">TURBO</option>
              </select>
              <button
                type="button"
                disabled={!ruleAppInput.trim()}
                onClick={() => void saveAppRule(ruleAppInput, ruleModeInput)}
                className="h-6 rounded-lg bg-[#88f1d1] px-2 text-[9px] font-extrabold text-[#061c17] disabled:opacity-40"
              >
                ADD
              </button>
            </div>
            {Object.keys(customRules).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(customRules).map(([app, mode]) => (
                  <span
                    key={app}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[8.5px] font-bold text-white"
                  >
                    {app} → <b className="text-[#88f1d1] uppercase">{mode}</b>
                    <button
                      type="button"
                      onClick={() => void saveAppRule(app, null)}
                      className="ml-0.5 text-zinc-400 hover:text-[#ff5d6c]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 1-Tap Free RAM / Purge Cache */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-white">
                <MemoryStick className="h-3.5 w-3.5 text-[#a78bfa]" />
                Free RAM for Big Apps
              </div>
              <div className="text-[8.5px] text-[#c4b5fd]">
                {perf.lastFreedRamMb !== null
                  ? `Last flush reclaimed ${perf.lastFreedRamMb} MB standby memory`
                  : 'Flushes standby RAM cache & trims idle background memory'}
              </div>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={() => triggerToggle('freeRam')}
              className="shrink-0 rounded-lg bg-[#a78bfa] px-2.5 py-1.5 text-[9px] font-extrabold text-[#120b24]"
            >
              FLUSH RAM
            </motion.button>
          </div>

          {/* Reduce Transparency / Glass Blur */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/50 px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-white">
                <Layers className="h-3.5 w-3.5 text-[#22d3ee]" />
                Reduce GPU Glass Blur
              </div>
              <div className="text-[8.5px] text-zinc-400">
                Saves GPU shader cycles &amp; unified VRAM when running heavy apps
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerToggle('reduceTransparency', !perf.reduceTransparency)}
              className="shrink-0 rounded-full px-2.5 py-1 text-[8.5px] font-extrabold uppercase"
              style={{
                background: perf.reduceTransparency ? '#34d39933' : 'rgba(255,255,255,0.08)',
                color: perf.reduceTransparency ? '#34d399' : '#9ca3af',
              }}
            >
              {perf.reduceTransparency ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Reduce Motion / Instant Window Animations */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/50 px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-white">
                <Gauge className="h-3.5 w-3.5 text-[#34d399]" />
                Fast UI (Reduce Motion)
              </div>
              <div className="text-[8.5px] text-zinc-400">
                Removes window zoom/fade animations for snappier responsiveness
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerToggle('reduceMotion', !perf.reduceMotion)}
              className="shrink-0 rounded-full px-2.5 py-1 text-[8.5px] font-extrabold uppercase"
              style={{
                background: perf.reduceMotion ? '#34d39933' : 'rgba(255,255,255,0.08)',
                color: perf.reduceMotion ? '#34d399' : '#9ca3af',
              }}
            >
              {perf.reduceMotion ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Background CPU Hog Throttling */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/50 px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-white">
                <Flame className="h-3.5 w-3.5 text-[#fbbf24]" />
                Throttle Background Apps
              </div>
              <div className="text-[8.5px] text-zinc-400">
                Lowers idle process CPU priority so your foreground app stays fast
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerToggle('throttleBg', !perf.backgroundThrottled)}
              className="shrink-0 rounded-full px-2.5 py-1 text-[8.5px] font-extrabold uppercase"
              style={{
                background: perf.backgroundThrottled ? '#fbbf2433' : 'rgba(255,255,255,0.08)',
                color: perf.backgroundThrottled ? '#fbbf24' : '#9ca3af',
              }}
            >
              {perf.backgroundThrottled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Footer Live Status & 1-Tap Reset to Normal */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#08131a] px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-[#b8d0d6]">
            <Info className="h-3 w-3 shrink-0 text-[#88f1d1]" />
            <span className="truncate">{perf.lastActionNote}</span>
          </div>
          <button
            type="button"
            onClick={() => selectMode('normal')}
            className="shrink-0 rounded-lg border border-[#7dd3fc]/35 bg-[#7dd3fc]/14 px-2 py-0.5 text-[8.5px] font-extrabold text-[#7dd3fc]"
          >
            RESET NORMAL
          </button>
        </div>
      </div>
    </div>
  );
}
