'use client';

import { InstrumentGauge, batteryHeatScale, heatBand, processorHeatScale } from '@/components/shell/InstrumentGauge';

import { HealthInsights } from './HealthInsights';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BatteryCharging,
  Bell,
  Coffee,
  Fan,
  Gauge,
  Lock,
  MonitorOff,
  Moon,
  Power,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Sun,
  Zap,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { FanMode, PowerAction, PowerProfile } from '@/types/protocol';

function pressureColor(p: string): string {
  if (p === 'Critical') return '#ff5d6c';
  if (p === 'Heavy') return '#fb923c';
  if (p === 'Moderate') return '#fbbf24';
  return '#34d399';
}

function formatMins(min: number | null): string {
  if (min === null || min <= 0) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PowerThermalView({ deck }: { deck: DevDeckState }) {
  const [rightTab, setRightTab] = useState<'cooling' | 'guards' | 'power'>('cooling');
  const [confirmDanger, setConfirmDanger] = useState<'restart' | 'shutdown' | null>(null);
  const p = deck.powerState;
  const isConnected = deck.status === 'connected';
  const pColor = pressureColor(p.thermalPressure);

  useEffect(() => {
    if (!confirmDanger) return;
    const t = window.setTimeout(() => setConfirmDanger(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDanger]);

  useEffect(() => {
    if (isConnected && p.cpuTempC === null) {
      deck.sendEvent({ type: 'power:refresh', payload: { requestId: makeRequestId() } });
    }
  }, [isConnected, p.cpuTempC, deck]);

  const sendPowerAction = (action: PowerAction) => {
    soundEngine.playClick();
    if (action === 'restart' || action === 'shutdown') {
      if (confirmDanger !== action) {
        setConfirmDanger(action);
        deck.showToast(false, `Tap ${action.toUpperCase()} again within 4s to confirm`);
        return;
      }
      setConfirmDanger(null);
    }
    if (action === 'wake') {
      deck.sendEvent({ type: 'hardware:wake', payload: { requestId: makeRequestId() } });
    }
    deck.sendEvent({ type: 'power:action', payload: { requestId: makeRequestId(), action } });
  };

  const setProfile = (profile: PowerProfile) => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'power:profile', payload: { requestId: makeRequestId(), profile } });
  };

  const setFanMode = (mode: FanMode) => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'power:fanMode', payload: { requestId: makeRequestId(), mode } });
  };

  const updateGuard = (patch: {
    autoPilot?: boolean;
    chargeGuardEnabled?: boolean;
    chargeGuardPct?: number;
    overheatGuardEnabled?: boolean;
    overheatTempC?: number;
    lowBatteryGuardEnabled?: boolean;
  }) => {
    soundEngine.playClick();
    deck.sendEvent({
      type: 'power:guardConfig',
      payload: { requestId: makeRequestId(), ...patch },
    });
  };

  const battColor =
    p.batteryPct <= 20 ? '#ff5d6c' : p.isCharging ? '#34d399' : p.batteryPct >= 80 ? '#22d3ee' : '#fbbf24';
  const hasSample = isConnected && (p.updatedAt > 0 || p.cpuTempC !== null);
  const processorScale = processorHeatScale(p.overheatTempC);
  const cpuTemp = isConnected ? p.cpuTempC : null;
  const gpuTemp = isConnected ? p.gpuTempC : null;
  const batteryTemp = isConnected ? p.batteryTempC : null;

  return (
    <div className="screen-grid layout-power">
      {/* LEFT: Battery Health Ring, Temps, Power Draw, Profile & Quick Controls */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2">
        <div
          className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full"
          style={{ background: `linear-gradient(90deg, ${battColor}, ${pColor})` }}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <BatteryCharging className="h-4 w-4 shrink-0 text-[#34d399]" />
            <span className="disp truncate text-[18px]">Power Guard</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span
              className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{ background: `${pColor}22`, color: pColor }}
            >
              {p.thermalPressure}
            </span>
            <button
              type="button"
              aria-label="Refresh sensors"
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'power:refresh', payload: { requestId: makeRequestId() } });
              }}
              className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-300"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Battery Car Gauge + Core Telemetry Grid */}
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/65 p-2">
          <InstrumentGauge
            className="instrument-summary"
            mode="battery"
            label="Battery"
            value={hasSample && p.hasBattery ? p.batteryPct : null}
            accent={battColor}
            status={
              hasSample
                ? p.isCharging
                  ? 'Charging'
                  : p.acConnected || !p.hasBattery
                    ? 'AC Power'
                    : formatMins(p.timeRemainingMin)
                : undefined
            }
          />

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">HEALTH · CYC</div>
              <div className="num font-mono-tech truncate text-[10px] font-extrabold text-[#34d399]">
                {p.healthPct !== null ? `${p.healthPct}%` : '--'}
                <span className="ml-1 text-[8.5px] font-semibold text-zinc-400">
                  {p.cycleCount !== null ? `${p.cycleCount}c` : ''}
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">POWER DRAW</div>
              <div className="num font-mono-tech truncate text-[10px] font-extrabold text-[#fbbf24]">
                {p.powerDrawW !== null ? `${p.powerDrawW}W` : '--'}
                <span className="ml-1 text-[8.5px] font-semibold text-zinc-400">
                  {p.voltageV !== null ? `${p.voltageV}V` : ''}
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">CPU TEMP</div>
              <div
                className="num font-mono-tech flex items-center gap-1 text-[10px] font-extrabold"
                style={{ color: heatBand(cpuTemp, processorScale).color }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: heatBand(cpuTemp, processorScale).color }}
                />
                {cpuTemp !== null ? `${cpuTemp}°C` : '--'}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">GPU / BATT</div>
              <div className="num font-mono-tech truncate text-[10px] font-extrabold text-[#22d3ee]">
                <span style={{ color: heatBand(gpuTemp, processorScale).color }}>
                  {gpuTemp !== null ? `${gpuTemp}°` : '--'}
                </span>
                <span className="text-zinc-500"> / </span>
                <span style={{ color: heatBand(batteryTemp, batteryHeatScale).color }}>
                  {batteryTemp !== null ? `${batteryTemp}°` : '--'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Power Profile Selector (Eco / Balanced / Performance) */}
        <div className="space-y-1 rounded-xl border border-white/[0.07] bg-black/55 p-2">
          <div className="flex items-center justify-between text-[8px] font-bold text-zinc-400 uppercase">
            <span>Power Profile</span>
            <span className="font-mono-tech truncate text-zinc-500">
              {p.hardwareModel || (isConnected ? p.platform.toUpperCase() : 'OFFLINE')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ['eco', 'ECO / LOW', '#34d399'],
                ['balanced', 'BALANCED', '#22d3ee'],
                ['performance', 'TURBO', '#fbbf24'],
              ] as const
            ).map(([id, label, color]) => {
              const active = p.powerProfile === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProfile(id)}
                  className="h-7 rounded-lg border text-[8.5px] font-extrabold whitespace-nowrap transition-colors"
                  style={{
                    background: active ? `${color}26` : 'rgba(255,255,255,0.03)',
                    borderColor: active ? color : 'rgba(255,255,255,0.08)',
                    color: active ? color : '#9ca3af',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom 1-Tap Quick Controls (h-8 aligned with right panel) */}
        <div className="grid grid-cols-5 gap-1">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => sendPowerAction('wake')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#88f1d1]/45 bg-[#88f1d1]/16 text-[8.5px] font-extrabold whitespace-nowrap text-[#88f1d1]"
          >
            <Sun aria-hidden="true" className="h-3 w-3 shrink-0" />
            WAKE UP
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => sendPowerAction('low_power_toggle')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border text-[8.5px] font-extrabold whitespace-nowrap"
            style={{
              background: p.lowPowerMode ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.05)',
              borderColor: p.lowPowerMode ? '#34d399' : 'rgba(255,255,255,0.1)',
              color: p.lowPowerMode ? '#34d399' : '#e4e4e7',
            }}
          >
            <Zap aria-hidden="true" className="h-3 w-3 shrink-0" />
            LOW PWR
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'hardware:caffeine',
                payload: { requestId: makeRequestId(), active: !deck.caffeineActive },
              });
            }}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border text-[8.5px] font-extrabold whitespace-nowrap"
            style={{
              background: deck.caffeineActive ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)',
              borderColor: deck.caffeineActive ? '#fbbf24' : 'rgba(255,255,255,0.1)',
              color: deck.caffeineActive ? '#fbbf24' : '#e4e4e7',
            }}
          >
            <Coffee aria-hidden="true" className="h-3 w-3 shrink-0" />
            AWAKE
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => sendPowerAction('display_sleep')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/10 text-[8.5px] font-extrabold whitespace-nowrap text-[#22d3ee]"
          >
            <MonitorOff aria-hidden="true" className="h-3 w-3 shrink-0" />
            SLEEP
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            onClick={() => sendPowerAction('lock')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/15 text-[8.5px] font-extrabold whitespace-nowrap text-[#c4b5fd]"
          >
            <Lock aria-hidden="true" className="h-3 w-3 shrink-0" />
            LOCK
          </motion.button>
        </div>
      </div>

      {/* RIGHT: Fan & Cooling | Smart Alert Guards | System Power Actions */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#34d399] via-[#fbbf24] to-[#ff5d6c]" />

        {/* 3-Tab Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-full bg-black/75 p-0.5">
            {(
              [
                ['cooling', 'Fan & Thermal', Fan, '#22d3ee'],
                ['guards', 'Smart Guards', Bell, '#fbbf24'],
                ['power', 'Power Actions', Power, '#ff5d6c'],
              ] as const
            ).map(([id, label, Icon, color]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRightTab(id);
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: rightTab === id ? '#1f222c' : 'transparent',
                  color: rightTab === id ? color : '#7c8190',
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          <span className="font-mono-tech hidden text-[8px] text-zinc-400 sm:inline">
            {p.chargeGuardEnabled ? `GUARD ${p.chargeGuardPct}%` : 'GUARD OFF'}
          </span>
        </div>

        {/* TAB 1: FAN & THERMAL */}
        {rightTab === 'cooling' && (
          <div className="deck-scroll flex min-h-0 flex-1 flex-col justify-between gap-2 overflow-y-auto pr-0.5">
            {/* Live Fan RPM / Cooling Status */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/65 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Fan
                  className={`h-5 w-5 shrink-0 text-[#22d3ee] ${!p.fanless && (p.fanRpm.length > 0 || p.fanMode === 'max') ? 'animate-spin' : ''}`}
                  style={{ animationDuration: p.fanMode === 'max' ? '0.6s' : '2.2s' }}
                />
                <div className="min-w-0">
                  <div className="text-[10px] font-extrabold text-white">
                    {p.fanless
                      ? 'Passive Cooling (Fanless)'
                      : p.fanRpm.length > 0
                        ? `Fan Speed: ${p.fanRpm.map((r) => `${r} RPM`).join(' · ')}`
                        : `Cooling Mode: ${p.fanMode.toUpperCase()}`}
                  </div>
                  <div className="truncate text-[8.5px] text-zinc-400">{p.fanNote}</div>
                </div>
              </div>
              <span className="font-mono-tech shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-extrabold text-[#22d3ee] uppercase">
                {p.fanMode}
              </span>
            </div>

            {/* Fan Control Mode Buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ['auto', 'AUTO', '#22d3ee'],
                  ['quiet', 'QUIET', '#34d399'],
                  ['balanced', 'BALANCED', '#a78bfa'],
                  ['max', 'MAX COOL', '#ff5d6c'],
                ] as const
              ).map(([mode, label, color]) => {
                const active = p.fanMode === mode;
                return (
                  <motion.button
                    key={mode}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setFanMode(mode)}
                    className="flex h-8 items-center justify-center gap-1 rounded-xl border text-[8.5px] font-extrabold whitespace-nowrap"
                    style={{
                      background: active ? `${color}26` : 'rgba(255,255,255,0.04)',
                      borderColor: active ? color : 'rgba(255,255,255,0.09)',
                      color: active ? color : '#a1a1aa',
                    }}
                  >
                    <Gauge className="h-3 w-3 shrink-0" />
                    {label}
                  </motion.button>
                );
              })}
            </div>

            <div className="thermal-gauge-cluster grid grid-cols-3 place-items-center gap-1.5 rounded-xl border border-white/[0.06] bg-black/55 px-1.5 py-1.5">
              <InstrumentGauge label="CPU Temp" value={cpuTemp} max={120} unit="°C" heat={processorScale} />
              <InstrumentGauge label="GPU / SoC" value={gpuTemp} max={120} unit="°C" heat={processorScale} />
              <InstrumentGauge label="Batt Temp" value={batteryTemp} max={60} unit="°C" heat={batteryHeatScale} />
            </div>
          </div>
        )}

        {/* TAB 2: SMART GUARDS (80% Charge Chime + Overheat Alert) */}
        {rightTab === 'guards' && (
          <div className="deck-scroll flex min-h-0 flex-1 flex-col justify-between gap-2 overflow-y-auto pr-0.5">
            <button
              className="rounded-xl border border-white/10 p-3 text-left"
              aria-pressed={!!p.autoPilot}
              onClick={() => updateGuard({ autoPilot: !p.autoPilot })}
            >
              <strong>Auto-pilot · {p.autoPilot ? 'On' : 'Off'}</strong>
              <small className="block">Alert on swap spikes and enable Eco below 25% on battery.</small>
            </button>
            <HealthInsights deck={deck} />
            {/* Charge Guard */}
            <div className="rounded-xl border border-[#34d399]/25 bg-black/65 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <BatteryCharging className="h-3.5 w-3.5 text-[#34d399]" />
                  <span className="text-[9.5px] font-extrabold text-white">
                    Charge Guard Chime (Unplug Alert)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => updateGuard({ chargeGuardEnabled: !p.chargeGuardEnabled })}
                  className="rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase"
                  style={{
                    background: p.chargeGuardEnabled ? '#34d39933' : 'rgba(255,255,255,0.08)',
                    color: p.chargeGuardEnabled ? '#34d399' : '#71717a',
                  }}
                >
                  {p.chargeGuardEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[75, 80, 85, 90].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => updateGuard({ chargeGuardEnabled: true, chargeGuardPct: pct })}
                    className="h-6 rounded-lg border text-[9px] font-extrabold"
                    style={{
                      background:
                        p.chargeGuardPct === pct ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.04)',
                      borderColor: p.chargeGuardPct === pct ? '#34d399' : 'rgba(255,255,255,0.08)',
                      color: p.chargeGuardPct === pct ? '#34d399' : '#a1a1aa',
                    }}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* Overheat Guard */}
            <div className="rounded-xl border border-[#ff5d6c]/25 bg-black/65 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#ff5d6c]" />
                  <span className="text-[9.5px] font-extrabold text-white">Overheat Guard Chime</span>
                </div>
                <button
                  type="button"
                  onClick={() => updateGuard({ overheatGuardEnabled: !p.overheatGuardEnabled })}
                  className="rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase"
                  style={{
                    background: p.overheatGuardEnabled ? '#ff5d6c33' : 'rgba(255,255,255,0.08)',
                    color: p.overheatGuardEnabled ? '#ff5d6c' : '#71717a',
                  }}
                >
                  {p.overheatGuardEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[75, 80, 85, 95].map((temp) => (
                  <button
                    key={temp}
                    type="button"
                    onClick={() => updateGuard({ overheatGuardEnabled: true, overheatTempC: temp })}
                    className="h-6 rounded-lg border text-[9px] font-extrabold"
                    style={{
                      background:
                        p.overheatTempC === temp ? 'rgba(255,93,108,0.22)' : 'rgba(255,255,255,0.04)',
                      borderColor: p.overheatTempC === temp ? '#ff5d6c' : 'rgba(255,255,255,0.08)',
                      color: p.overheatTempC === temp ? '#ff5d6c' : '#a1a1aa',
                    }}
                  >
                    {temp}°C
                  </button>
                ))}
              </div>
            </div>

            {/* Low Battery + Test Chime Row */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/65 px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => updateGuard({ lowBatteryGuardEnabled: !p.lowBatteryGuardEnabled })}
                className="text-[9px] font-extrabold text-zinc-200"
              >
                Low Battery 20% Alert:{' '}
                <span className={p.lowBatteryGuardEnabled ? 'text-[#fbbf24]' : 'text-zinc-500'}>
                  {p.lowBatteryGuardEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  deck.triggerFlash(
                    'warning',
                    `🔔 Alert Chime Active (Charge ${p.chargeGuardPct}% · Heat ${p.overheatTempC}°C)`,
                  );
                }}
                className="flex items-center gap-1 rounded-lg bg-[#fbbf24]/20 px-2 py-1 text-[8.5px] font-extrabold text-[#fbbf24]"
              >
                <Bell className="h-3 w-3" />
                Test Chime
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: 1-TAP POWER ACTIONS (Wake Up + Sleep + Safe 2-tap confirm on Restart/Shutdown) */}
        {rightTab === 'power' && (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => sendPowerAction('wake')}
              className="col-span-2 flex items-center justify-center gap-2.5 rounded-xl border border-[#88f1d1]/50 bg-[#88f1d1]/16 py-2 text-[#88f1d1]"
            >
              <Sun aria-hidden="true" className="h-5 w-5 shrink-0" />
              <div className="text-left">
                <div className="text-[11px] font-extrabold uppercase">
                  WAKE UP / OPEN FROM SLEEP
                </div>
                <div className="text-[8.5px] text-[#b8d0d6]">
                  Turns display back on &amp; wakes computer from standby
                </div>
              </div>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => sendPowerAction('sleep')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/10 text-[#22d3ee]"
            >
              <Moon aria-hidden="true" className="h-5 w-5" />
              <span className="text-[10px] font-extrabold">SLEEP COMPUTER</span>
              <span className="text-[8px] text-zinc-400">Standby (wakeable)</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => sendPowerAction('display_sleep')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#34d399]/30 bg-[#34d399]/10 text-[#34d399]"
            >
              <MonitorOff aria-hidden="true" className="h-5 w-5" />
              <span className="text-[10px] font-extrabold">DISPLAY OFF</span>
              <span className="text-[8px] text-zinc-400">Builds keep running</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => sendPowerAction('restart')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border text-[#fbbf24]"
              style={{
                background: confirmDanger === 'restart' ? 'rgba(251,191,36,0.28)' : 'rgba(251,191,36,0.1)',
                borderColor: confirmDanger === 'restart' ? '#fbbf24' : 'rgba(251,191,36,0.3)',
              }}
            >
              <RotateCw className="h-5 w-5" />
              <span className="text-[10px] font-extrabold">
                {confirmDanger === 'restart' ? 'TAP AGAIN TO RESTART' : 'RESTART'}
              </span>
              <span className="text-[8px] text-zinc-400">2-tap safety confirm</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => sendPowerAction('shutdown')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border text-[#ff5d6c]"
              style={{
                background: confirmDanger === 'shutdown' ? 'rgba(255,93,108,0.28)' : 'rgba(255,93,108,0.1)',
                borderColor: confirmDanger === 'shutdown' ? '#ff5d6c' : 'rgba(255,93,108,0.3)',
              }}
            >
              <Power className="h-5 w-5" />
              <span className="text-[10px] font-extrabold">
                {confirmDanger === 'shutdown' ? 'TAP AGAIN TO SHUT DOWN' : 'SHUT DOWN'}
              </span>
              <span className="text-[8px] text-zinc-400">2-tap safety confirm</span>
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
