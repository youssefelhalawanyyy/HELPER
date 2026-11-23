'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  HeartPulse,
  Loader2,
  MemoryStick,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wifi,
  Wrench,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { DoctorRepairAction } from '@/types/protocol';

function gradeColor(grade: string): string {
  if (grade === 'EXCELLENT') return '#34d399';
  if (grade === 'GOOD') return '#22d3ee';
  if (grade === 'SLOW') return '#fbbf24';
  return '#ff5d6c';
}

export function SystemDoctorView({ deck }: { deck: DevDeckState }) {
  const [rightTab, setRightTab] = useState<'issues' | 'log'>('issues');
  const logRef = useRef<HTMLDivElement | null>(null);
  const doc = deck.doctorReport;
  const isWin = (doc.platform || deck.hello?.platform) === 'win32';
  const accent = gradeColor(doc.grade);
  const busy = doc.scanning || doc.repairing;

  // Auto-run initial scan once when opening tab if never scanned
  const autoScannedRef = useRef(false);
  useEffect(() => {
    if (autoScannedRef.current) return;
    if (deck.status === 'connected' && doc.scannedAt === 0 && !doc.scanning) {
      autoScannedRef.current = true;
      deck.sendEvent({ type: 'doctor:scan', payload: { requestId: makeRequestId() } });
    }
  }, [deck, doc.scannedAt, doc.scanning]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [doc.repairLog]);

  const triggerScan = () => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'doctor:scan', payload: { requestId: makeRequestId() } });
  };

  const triggerRepair = (action: DoctorRepairAction) => {
    soundEngine.playClick();
    setRightTab('log');
    deck.sendEvent({ type: 'doctor:repair', payload: { requestId: makeRequestId(), action } });
  };

  const problemCount = doc.issues.filter((i) => i.severity !== 'healthy').length;

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1.1fr 1.65fr' }}>
      {/* LEFT: Health Score Gauge + Plain-English Diagnosis + 1-Tap Full Tune-Up */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-2.5">
        <div
          className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full"
          style={{ background: `linear-gradient(90deg, ${accent}, #22d3ee)` }}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <HeartPulse className="h-4 w-4" style={{ color: accent }} />
            <span className="disp text-[20px]">{isWin ? 'PC Doctor' : 'Mac Doctor'}</span>
          </div>
          <span
            className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
            style={{ background: `${accent}20`, color: accent }}
          >
            {doc.scannedAt ? doc.grade : 'READY'}
          </span>
        </div>

        {/* Score + 4 Key Metrics */}
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/70 p-2">
          <div
            className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(${accent} ${Math.max(4, doc.score) * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
            }}
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[#090b10]">
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: accent }} />
              ) : (
                <span className="num font-mono-tech text-[16px] font-extrabold text-white">
                  {doc.scannedAt ? doc.score : '--'}
                </span>
              )}
            </div>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
              <div className="flex items-center gap-1 text-[8px] text-zinc-400">
                <Cpu className="h-2.5 w-2.5 text-[#22d3ee]" />
                CPU
              </div>
              <div className="num font-mono-tech text-[10.5px] font-extrabold text-white">
                {doc.metrics.cpuPct}%
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
              <div className="flex items-center gap-1 text-[8px] text-zinc-400">
                <MemoryStick className="h-2.5 w-2.5 text-[#a78bfa]" />
                RAM
              </div>
              <div className="num font-mono-tech text-[10.5px] font-extrabold text-white">
                {doc.metrics.ramPct}%
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
              <div className="flex items-center gap-1 text-[8px] text-zinc-400">
                <HardDrive className="h-2.5 w-2.5 text-[#34d399]" />
                FREE
              </div>
              <div className="num font-mono-tech text-[10.5px] font-extrabold text-white">
                {doc.metrics.diskFreeGb}G
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
              <div className="flex items-center gap-1 text-[8px] text-zinc-400">
                <Trash2 className="h-2.5 w-2.5 text-[#fbbf24]" />
                JUNK
              </div>
              <div className="num font-mono-tech text-[10.5px] font-extrabold text-white">
                {doc.metrics.tempJunkMb}M
              </div>
            </div>
          </div>
        </div>

        {/* Plain-English Verdict */}
        <div className="deck-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/65 p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[8.5px] font-extrabold tracking-wider text-[#22d3ee] uppercase">
            <Sparkles className="h-3 w-3" />
            Plain-English Diagnosis
          </div>
          <p className="text-[10.5px] leading-[1.4] text-zinc-200">
            {busy && doc.activeAction ? doc.activeAction : doc.summaryEnglish}
          </p>
        </div>

        {/* Bottom Primary Action Buttons */}
        <div className="grid grid-cols-5 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={triggerScan}
            className="col-span-2 flex items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/[0.06] py-2 text-[9.5px] font-extrabold text-white disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${doc.scanning ? 'animate-spin' : ''}`} />
            SCAN
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={() => triggerRepair('full_tuneup')}
            className="col-span-3 flex items-center justify-center gap-1 rounded-xl bg-[#34d399] py-2 text-[9.5px] font-extrabold text-[#04130c] disabled:opacity-40"
            style={{ boxShadow: '0 2px 0 #14664a' }}
          >
            <Wrench className="h-3.5 w-3.5" />
            1-TAP TUNE-UP
          </motion.button>
        </div>
      </div>

      {/* RIGHT: Detailed Plain-English Issues List + Live Repair Console */}
      <div className="tile flex min-h-0 flex-col gap-2 p-2.5">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#ff5d6c] via-[#fbbf24] to-[#34d399]" />

        {/* Header Tabs + Quick Repair Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-full bg-black/75 p-0.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('issues');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase"
              style={{
                background: rightTab === 'issues' ? '#1f222c' : 'transparent',
                color: rightTab === 'issues' ? (problemCount > 0 ? '#fbbf24' : '#34d399') : '#7c8190',
              }}
            >
              <ShieldAlert className="h-3 w-3" />
              Diagnosis ({doc.issues.length})
            </button>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('log');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase"
              style={{
                background: rightTab === 'log' ? '#1f222c' : 'transparent',
                color: rightTab === 'log' ? '#22d3ee' : '#7c8190',
              }}
            >
              <Terminal className="h-3 w-3" />
              Repair Console ({doc.repairLog.length})
            </button>
          </div>

          <span className="font-mono-tech truncate text-[8.5px] text-zinc-400">
            {doc.metrics.integrityStatus}
          </span>
        </div>

        {/* Body */}
        {rightTab === 'issues' ? (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {doc.issues.map((issue) => {
              const color =
                issue.severity === 'critical'
                  ? '#ff5d6c'
                  : issue.severity === 'warning'
                    ? '#fbbf24'
                    : '#34d399';
              const Icon =
                issue.severity === 'critical'
                  ? ShieldAlert
                  : issue.severity === 'warning'
                    ? AlertTriangle
                    : CheckCircle2;

              return (
                <div
                  key={issue.id}
                  className="rounded-xl border border-white/[0.07] bg-black/70 p-2"
                  style={{ borderLeftWidth: 3, borderLeftColor: color }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                      <span className="truncate text-[10.5px] font-extrabold text-white">
                        {issue.title}
                      </span>
                    </div>

                    {issue.fixAction && (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        disabled={busy}
                        onClick={() => triggerRepair(issue.fixAction!)}
                        className="shrink-0 rounded-lg px-2 py-0.5 text-[8.5px] font-extrabold uppercase disabled:opacity-40"
                        style={{
                          background: `${color}22`,
                          color,
                          border: `1px solid ${color}55`,
                        }}
                      >
                        {issue.fixLabel || 'Fix'}
                      </motion.button>
                    )}
                  </div>

                  <p className="mt-1 text-[9.5px] leading-[1.38] text-zinc-300">
                    {issue.plainEnglish}
                  </p>
                  <div className="mt-1 font-mono-tech text-[8px] text-zinc-500">
                    Impact: {issue.impact}
                  </div>
                </div>
              );
            })}

            {doc.issues.length === 0 && (
              <div className="grid h-full place-items-center text-center">
                <div className="space-y-1">
                  <ShieldCheck className="mx-auto h-7 w-7 text-[#34d399]/60" />
                  <div className="text-[11px] font-bold text-zinc-300">
                    Ready to diagnose your {isWin ? 'Windows PC' : 'Mac'}
                  </div>
                  <div className="sub">
                    Tap SCAN to check CPU, RAM, disk health, junk, crashes & corrupted files
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={logRef}
            className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#040508] p-2 text-[9px] leading-relaxed text-[#d4f5e9]"
          >
            {doc.repairLog.length > 0 ? (
              doc.repairLog.map((line, idx) => (
                <div key={idx} className="break-words">
                  {line}
                </div>
              ))
            ) : (
              <div className="grid h-full place-items-center text-center text-zinc-500">
                Repair actions & SFC/DISM / disk verification output appear here live.
              </div>
            )}
          </div>
        )}

        {/* Quick Individual Repair Tools Strip */}
        <div className="grid grid-cols-4 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('verify_system_files')}
            className="flex items-center justify-center gap-1 rounded-xl border border-[#ff5d6c]/35 bg-[#ff5d6c]/12 py-1.5 text-[8.5px] font-extrabold text-[#ff5d6c] disabled:opacity-40"
          >
            <ShieldCheck className="h-3 w-3" />
            {isWin ? 'SFC/DISM' : 'VERIFY OS'}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('clean_junk')}
            className="flex items-center justify-center gap-1 rounded-xl border border-[#fbbf24]/35 bg-[#fbbf24]/12 py-1.5 text-[8.5px] font-extrabold text-[#fbbf24] disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            CLEAN JUNK
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('free_ram')}
            className="flex items-center justify-center gap-1 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/12 py-1.5 text-[8.5px] font-extrabold text-[#a78bfa] disabled:opacity-40"
          >
            <MemoryStick className="h-3 w-3" />
            FREE RAM
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('flush_dns')}
            className="flex items-center justify-center gap-1 rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/12 py-1.5 text-[8.5px] font-extrabold text-[#22d3ee] disabled:opacity-40"
          >
            <Wifi className="h-3 w-3" />
            FLUSH DNS
          </motion.button>
        </div>
      </div>
    </div>
  );
}
