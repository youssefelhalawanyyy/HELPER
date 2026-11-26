'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { BatteryCharging, Cpu, Thermometer, X } from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

export type GaugeHistoryKind = 'cpu' | 'heat' | 'battery';

interface GaugeHistorySample {
  ts: number;
  cpuPct: number;
  cpuTempC: number | null;
  batteryPct: number | null;
  batteryWattage: number | null;
  topApp: string;
}

interface GaugeHistoryPayload {
  samples: GaugeHistorySample[];
  batteryInsights: {
    estimateText: string;
    codingWatts: number;
    callsWatts: number;
    idleWatts: number;
  };
}

export function GaugeHistorySheet({
  kind,
  deck,
  onClose,
}: {
  kind: GaugeHistoryKind;
  deck: DevDeckState;
  onClose: () => void;
}) {
  const [data, setData] = useState<GaugeHistoryPayload | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    void fetch(`${deck.bridgeBaseUrl}/api/timeline/gauges`, {
      headers: { authorization: `Bearer ${deck.pairing.token}` },
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean } & Partial<GaugeHistoryPayload>) => {
        if (d.ok && Array.isArray(d.samples)) {
          setData({
            samples: d.samples,
            batteryInsights: d.batteryInsights || {
              estimateText: 'Calculating…',
              codingWatts: 10,
              callsWatts: 13,
              idleWatts: 4,
            },
          });
        }
      })
      .catch(() => {});
  }, [deck.status, deck.bridgeBaseUrl, deck.pairing?.token]);

  if (!mounted) return null;

  const cpuVal = Math.round(deck.stats.cpuPct || 0);
  const tempVal = deck.powerState.cpuTempC;
  const battVal = deck.stats.batteryPct ?? deck.powerState.batteryPct ?? 0;

  const heatState =
    tempVal === null ? 'Idle' : tempVal >= 82 ? 'Hot' : tempVal >= 62 ? 'Warm' : 'Cool';
  const accent =
    kind === 'heat'
      ? tempVal !== null && tempVal >= 82
        ? '#ff5d6c'
        : tempVal !== null && tempVal >= 62
          ? '#fbbf24'
          : '#34d399'
      : kind === 'battery'
        ? '#7dd3fc'
        : '#88f1d1';

  const series = (data?.samples || []).map((s) =>
    kind === 'heat' ? s.cpuTempC ?? 0 : kind === 'battery' ? s.batteryPct ?? 0 : s.cpuPct,
  );
  const maxVal = kind === 'heat' ? 105 : 100;
  const points = series
    .map((v, i) => {
      const x = (i / Math.max(1, series.length - 1)) * 100;
      const y = 38 - Math.min(1, Math.max(0, v / maxVal)) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-no-swipe="true"
      onClick={onClose}
      className="fixed inset-0 z-[9990] flex items-end justify-center bg-black/75 p-3 sm:items-center"
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 160 }}
        dragElastic={0.2}
        onDragEnd={(_e, info) => {
          if (info.offset.y > 70) {
            soundEngine.playDetent();
            onClose();
          }
        }}
        initial={{ y: 40, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 40, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] space-y-3 rounded-3xl border border-[#98c8ce33] bg-[#0a161d] p-4 shadow-2xl"
      >
        {/* Drag Handle */}
        <div className="mx-auto h-1 w-10 rounded-full bg-white/15" />

        {/* Signature Shared Gauge Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-2xl border"
              style={{ borderColor: `${accent}55`, background: `${accent}18`, color: accent }}
            >
              {kind === 'heat' ? (
                <Thermometer className="h-6 w-6" />
              ) : kind === 'battery' ? (
                <BatteryCharging className="h-6 w-6" />
              ) : (
                <Cpu className="h-6 w-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono-tech text-2xl font-extrabold text-white">
                  {kind === 'heat'
                    ? tempVal !== null
                      ? `${tempVal.toFixed(1)}°C`
                      : '--°C'
                    : kind === 'battery'
                      ? `${battVal}%`
                      : `${cpuVal}%`}
                </span>
                {kind === 'heat' && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase"
                    style={{ background: `${accent}24`, color: accent }}
                  >
                    {heatState}
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-[#9cb4bb]">
                {kind === 'heat'
                  ? 'CPU Silicon Thermal History · Drag down to return'
                  : kind === 'battery'
                    ? data?.batteryInsights.estimateText || 'Battery drain & workload comparison'
                    : 'CPU Load History · Recent samples'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail sheet"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.08] text-zinc-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* History Chart */}
        <div className="rounded-2xl border border-white/[0.07] bg-[#050d12] p-3">
          <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold text-[#9cb4bb] uppercase">
            <span>Recent Timeline ({series.length} samples)</span>
            <span style={{ color: accent }}>
              Peak:{' '}
              {series.length > 0
                ? `${Math.max(...series).toFixed(kind === 'heat' ? 1 : 0)}${kind === 'heat' ? '°C' : '%'}`
                : '--'}
            </span>
          </div>
          {series.length >= 2 ? (
            <svg viewBox="0 0 100 40" className="h-20 w-full overflow-visible">
              <polyline
                fill="none"
                stroke={accent}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points}
              />
            </svg>
          ) : (
            <div className="grid h-16 place-items-center text-[10px] text-zinc-500">
              Collecting live samples…
            </div>
          )}
        </div>

        {/* Battery Workload Drain Comparison (Battery Clock) */}
        {kind === 'battery' && data?.batteryInsights && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
              <div className="text-[8.5px] font-bold text-zinc-400 uppercase">Coding</div>
              <div className="font-mono-tech text-sm font-extrabold text-[#88f1d1]">
                {data.batteryInsights.codingWatts}W
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
              <div className="text-[8.5px] font-bold text-zinc-400 uppercase">Video Calls</div>
              <div className="font-mono-tech text-sm font-extrabold text-[#fbbf24]">
                {data.batteryInsights.callsWatts}W
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
              <div className="text-[8.5px] font-bold text-zinc-400 uppercase">Idle</div>
              <div className="font-mono-tech text-sm font-extrabold text-[#7dd3fc]">
                {data.batteryInsights.idleWatts}W
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
