'use client';

import { motion } from 'framer-motion';
import {
  AppWindow,
  BatteryCharging,
  Bluetooth,
  ExternalLink,
  FileText,
  Globe,
  Mic,
  MicOff,
  Moon,
  Play,
  RefreshCw,
  Shield,
  Speaker,
  Sun,
  Wifi,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const FAVORITE_DOCK_APPS = [
  { name: 'Antigravity', label: 'Antigravity' },
  { name: 'Google Chrome', label: 'Chrome' },
  { name: 'Safari', label: 'Safari' },
  { name: 'Terminal', label: 'Terminal' },
  { name: 'Spotify', label: 'Spotify' },
  { name: 'Finder', label: 'Finder' },
  { name: 'Notes', label: 'Notes' },
  { name: 'WhatsApp', label: 'WhatsApp' },
];

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export function MacInspectorView({
  deck,
  onNavigateToMonitor,
}: {
  deck: DevDeckState;
  onNavigateToMonitor?: () => void;
}) {
  const isConnected = deck.status === 'connected';
  const t = deck.macTelemetry;

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1.05fr 1.15fr' }}>
      {/* Column 1: Power, Per-Core CPU, Bluetooth/AirPods & Displays */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />
        <div className="flex items-center justify-between">
          <span className="disp text-[22px]">Mac System</span>
          <button
            type="button"
            aria-label="Refresh telemetry"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({ type: 'telemetry:refresh', payload: { requestId: makeRequestId() } });
            }}
            className="text-[#7c8190] hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Deep Battery Card */}
        <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#34d399]">
              <BatteryCharging className="h-3.5 w-3.5" />
              {deck.stats.batteryPct !== null ? `${deck.stats.batteryPct}%` : '--'} ·{' '}
              {t?.batteryTimeRemaining || '--'}
            </span>
            <span className="num sub">{t ? `Up ${formatUptime(t.uptimeSec)}` : '--'}</span>
          </div>
          <div className="num grid grid-cols-3 gap-1 text-center text-[9.5px]">
            <div className="rounded-lg bg-white/[0.04] py-1">
              <div className="sub !text-[8px]">Health</div>
              <div className="font-bold text-white">
                {t?.batteryHealthPct !== null && t?.batteryHealthPct !== undefined
                  ? `${t.batteryHealthPct}%`
                  : '--'}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] py-1">
              <div className="sub !text-[8px]">Cycles</div>
              <div className="font-bold text-white">{t?.batteryCycles ?? '--'}</div>
            </div>
            <div className="rounded-lg bg-white/[0.04] py-1">
              <div className="sub !text-[8px]">Power</div>
              <div className="font-bold text-[#fbbf24]">
                {t?.batteryWattage ? `${t.batteryWattage}W` : 'Batt'}
              </div>
            </div>
          </div>
        </div>

        {/* Per-Core CPU Bar Chart */}
        <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="sub !text-[8.5px]">Per-Core CPU ({t?.cpuCores.length || 0})</span>
            <span className="num text-[9.5px] font-bold text-[#22d3ee]">
              {isConnected ? `${deck.stats.cpuPct}% avg` : '--'}
            </span>
          </div>
          <div className="flex h-9 items-end gap-1">
            {(t?.cpuCores.length ? t.cpuCores : [0, 0, 0, 0, 0, 0, 0, 0]).map((load, i) => (
              <div key={i} className="flex h-full flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t transition-all duration-500"
                  style={{
                    height: `${Math.max(10, Math.min(100, load))}%`,
                    background: load > 75 ? '#ff5d6c' : load > 45 ? '#fbbf24' : '#22d3ee',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Bluetooth & AirPods Battery */}
        <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          <div className="flex items-center gap-1">
            <Bluetooth className="h-3 w-3 text-[#60a5fa]" />
            <span className="sub !text-[8.5px]">Bluetooth &amp; Peripherals</span>
          </div>
          {t?.bluetoothDevices.length ? (
            t.bluetoothDevices.map((dev) => (
              <div
                key={dev.name}
                className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2 py-1 text-[10px]"
              >
                <span className="truncate font-semibold text-zinc-200">{dev.name}</span>
                <span className="num shrink-0 font-bold text-[#34d399]">
                  {dev.batteryPct !== null ? `${dev.batteryPct}%` : 'On'}
                </span>
              </div>
            ))
          ) : (
            <div className="sub text-[9px]">
              {isConnected ? 'No Bluetooth peripherals connected' : 'Connect Mac to inspect'}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Network, Audio/Mic/Dark Mode Toggles & One-Tap Mac App Dock */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="disp text-[22px]">Control &amp; Dock</div>

        {/* Network + Audio Strip */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
            <div className="flex items-center gap-1 font-bold text-[#22d3ee]">
              <Wifi className="h-3 w-3" />
              <span className="truncate">{t?.wifiSsid || 'Wi-Fi'}</span>
            </div>
            <div className="num mt-0.5 text-[9px] text-[#8b90a0]">
              {t?.pingMs !== null && t?.pingMs !== undefined ? `${t.pingMs}ms` : '--'}
              {t?.wifiSignalDbm ? ` · ${t.wifiSignalDbm}dBm` : ''}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
            <div className="flex items-center gap-1 font-bold text-[#a78bfa]">
              <Speaker className="h-3 w-3 shrink-0" />
              <span className="truncate">{t?.audioOutputDevice || 'Speakers'}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[9px]">
              <Shield className="h-2.5 w-2.5" style={{ color: t?.vpnActive ? '#34d399' : '#6b7080' }} />
              <span style={{ color: t?.vpnActive ? '#34d399' : '#8b90a0' }}>
                {t?.vpnActive ? 'VPN Active' : 'No VPN'}
              </span>
            </div>
          </div>
        </div>

        {/* Live System Toggles: Mic Mute + Dark/Light Mode */}
        <div className="grid grid-cols-2 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({ type: 'system:toggleMic', payload: { requestId: makeRequestId() } });
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-[10px] font-extrabold"
            style={{
              background: t?.micMuted ? 'rgba(255,93,108,.16)' : 'rgba(52,211,153,.14)',
              borderColor: t?.micMuted ? 'rgba(255,93,108,.4)' : 'rgba(52,211,153,.35)',
              color: t?.micMuted ? '#ff5d6c' : '#34d399',
            }}
          >
            {t?.micMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {t?.micMuted ? 'MIC MUTED' : `MIC ${t?.micInputPct ?? 80}%`}
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'system:toggleDarkMode',
                payload: { requestId: makeRequestId() },
              });
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] py-2 text-[10px] font-extrabold text-[#fbbf24]"
          >
            {t?.darkMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {t?.darkMode ? 'DARK MODE' : 'LIGHT MODE'}
          </motion.button>
        </div>

        {/* One-Tap Mac App Dock / Switcher */}
        <div className="flex min-h-0 flex-1 flex-col">
          <span className="sub mb-1 !text-[8.5px]">One-Tap Mac App Dock</span>
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            {FAVORITE_DOCK_APPS.map((app) => {
              const running = t?.runningApps.some(
                (r) => r.toLowerCase() === app.name.toLowerCase(),
              );
              return (
                <motion.button
                  key={app.name}
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'app:focus',
                      payload: { requestId: makeRequestId(), appName: app.name },
                    });
                  }}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-bold text-zinc-200 hover:border-[#22d3ee]/45"
                >
                  <span className="truncate">{app.label}</span>
                  <i
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: running ? '#34d399' : '#3a3e4b' }}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Column 3: Active Browser Tab ("Open on iPhone"), package.json Scripts & Recent Files */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />
        <div className="disp text-[22px]">Live Context</div>

        {/* Active Window + Browser Tab -> Open on iPhone */}
        <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-white">
            <AppWindow className="h-3 w-3 shrink-0 text-[#a78bfa]" />
            <span className="truncate">
              {t?.activeWindowTitle || deck.activeApp.appName || 'macOS'}
            </span>
          </div>
          {t?.activeBrowserUrl ? (
            <div className="mt-1.5 flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1">
              <div className="flex min-w-0 items-center gap-1">
                <Globe className="h-3 w-3 shrink-0 text-[#22d3ee]" />
                <span className="truncate text-[9.5px] text-zinc-300">
                  {t.activeBrowserTitle || t.activeBrowserUrl}
                </span>
              </div>
              <a
                href={t.activeBrowserUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-full bg-[#22d3ee] px-2 py-0.5 text-[8.5px] font-extrabold text-[#041317]"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Open
              </a>
            </div>
          ) : (
            <div className="sub mt-1 !text-[8.5px]">No active browser tab detected</div>
          )}
        </div>

        {/* Auto-Detected package.json Scripts */}
        <div>
          <span className="sub mb-1 block !text-[8.5px]">
            Auto-Detected package.json Scripts
          </span>
          <div className="flex flex-wrap gap-1">
            {(t?.projectScripts || []).slice(0, 6).map((sc) => (
              <button
                key={sc.name}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'script:run',
                    payload: { requestId: makeRequestId(), scriptName: sc.name },
                  });
                  onNavigateToMonitor?.();
                }}
                className="flex items-center gap-1 rounded-full border border-[#34d399]/30 bg-[#34d399]/10 px-2 py-0.5 text-[9.5px] font-bold text-[#34d399] hover:bg-[#34d399]/20"
              >
                <Play className="h-2.5 w-2.5 fill-current" />
                {sc.name}
              </button>
            ))}
            {!t?.projectScripts.length && (
              <span className="sub !text-[8.5px]">No scripts loaded</span>
            )}
          </div>
        </div>

        {/* Recent ~/Downloads & ~/Desktop Files */}
        <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          <span className="sub !text-[8.5px]">Recent Downloads &amp; Desktop</span>
          {(t?.recentFiles || []).map((f) => (
            <div
              key={`${f.folder}-${f.name}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-[9.5px]"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <FileText className="h-3 w-3 shrink-0 text-[#fbbf24]" />
                <span className="truncate font-medium text-zinc-200">{f.name}</span>
              </div>
              <span className="num sub shrink-0 !text-[8px]">
                {f.folder === 'Downloads' ? 'DL' : 'DT'} · {f.sizeKb}KB
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
