'use client';

import { InstrumentGauge } from '@/components/shell/InstrumentGauge';

import { HealthInsights } from './HealthInsights';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  HardDrive,
  HeartPulse,
  KeyRound,
  MemoryStick,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
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
  const [rightTab, setRightTab] = useState<'issues' | 'terminal' | 'report'>('issues');
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const termRef = useRef<HTMLDivElement | null>(null);
  const prevReportTsRef = useRef<number>(0);

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

  // Auto-scroll live terminal
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [doc.terminalLines]);

  // Auto-switch to English Post-Repair Report when a new repair finishes
  useEffect(() => {
    const ts = doc.postReport?.generatedAt || 0;
    if (ts > 0 && ts !== prevReportTsRef.current && !doc.repairing) {
      prevReportTsRef.current = ts;
      setRightTab('report');
    }
  }, [doc.postReport?.generatedAt, doc.repairing]);

  const triggerScan = () => {
    soundEngine.playClick();
    setRightTab('terminal');
    deck.sendEvent({ type: 'doctor:scan', payload: { requestId: makeRequestId() } });
  };

  const triggerRepair = (action: DoctorRepairAction) => {
    soundEngine.playClick();
    setRightTab('terminal');
    deck.sendEvent({ type: 'doctor:repair', payload: { requestId: makeRequestId(), action } });
  };

  const problemCount = doc.issues.filter((i) => i.severity !== 'healthy').length;
  const report = doc.postReport;

  return (
    <div className="screen-grid layout-doctor">
      {/* LEFT: Health Gauge + Metrics + Plain-English Verdict + SCAN ALL / AI AUTO-FIX */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
        <div
          className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full"
          style={{ background: `linear-gradient(90deg, ${accent}, #22d3ee)` }}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <HeartPulse className="h-4 w-4" style={{ color: accent }} />
            <span className="disp text-[19px]">{isWin ? 'PC Rescue' : 'Mac Rescue'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setKeyOpen((v) => !v);
              }}
              title="Configure AI Repair Key (saved locally on computer)"
              className="flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-console-micro font-extrabold uppercase"
              style={{
                background: doc.aiConfigured ? '#a78bfa22' : 'rgba(255,255,255,0.06)',
                borderColor: doc.aiConfigured ? '#a78bfa66' : 'rgba(255,255,255,0.12)',
                color: doc.aiConfigured ? '#c4b5fd' : '#9ca3af',
              }}
            >
              <KeyRound className="h-2.5 w-2.5" />
              {doc.aiConfigured ? 'AI ON' : 'SET KEY'}
            </button>
            <span
              className="font-mono-tech rounded-full px-2 py-0.5 text-console-micro font-extrabold uppercase"
              style={{ background: `${accent}20`, color: accent }}
            >
              {doc.scannedAt ? doc.grade : 'READY'}
            </span>
          </div>
        </div>

        {/* Optional Local AI Key Input Bar */}
        {keyOpen && (
          <form
            data-no-swipe="true"
            onSubmit={(e) => {
              e.preventDefault();
              if (keyInput.trim().length < 12) return;
              soundEngine.playClick();
              deck.sendEvent({
                type: 'doctor:setAiKey',
                payload: { requestId: makeRequestId(), apiKey: keyInput.trim() },
              });
              setKeyInput('');
              setKeyOpen(false);
            }}
            className="flex items-center gap-1 rounded-xl border border-[#a78bfa]/40 bg-black/85 p-1.5"
          >
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste Gemini AI Repair Key…"
              className="h-6 min-w-0 flex-1 rounded-lg bg-white/[0.06] px-2 text-console-caption text-white outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              className="h-6 shrink-0 rounded-lg bg-[#a78bfa] px-2 text-console-micro font-extrabold text-[#0b0718]"
            >
              SAVE
            </button>
          </form>
        )}

        {/* Health Score + 4 Key Metrics */}
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/70 p-2">
          <InstrumentGauge
            className="instrument-summary"
            mode="health"
            label="Health"
            unit="/100"
            value={doc.scannedAt ? doc.score : null}
            accent={accent}
            status={busy ? (doc.repairing ? 'Repairing…' : 'Scanning…') : undefined}
          />

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="flex items-center gap-1 text-console-micro text-zinc-400">
                <Cpu className="h-2.5 w-2.5 text-[#22d3ee]" />
                CPU
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-white">
                {doc.metrics.cpuPct}%
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="flex items-center gap-1 text-console-micro text-zinc-400">
                <MemoryStick className="h-2.5 w-2.5 text-[#a78bfa]" />
                RAM
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-white">
                {doc.metrics.ramPct}%
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="flex items-center gap-1 text-console-micro text-zinc-400">
                <HardDrive className="h-2.5 w-2.5 text-[#34d399]" />
                FREE
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-white">
                {doc.metrics.diskFreeGb}G
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="flex items-center gap-1 text-console-micro text-zinc-400">
                <Trash2 className="h-2.5 w-2.5 text-[#fbbf24]" />
                JUNK
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-white">
                {doc.metrics.tempJunkMb}M
              </div>
            </div>
          </div>
        </div>

        {/* Security & Integrity Status Strip */}
        <div className="grid grid-cols-2 gap-1">
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-black/60 px-2 py-1">
            <ShieldCheck className="h-3 w-3 shrink-0 text-[#34d399]" />
            <span className="truncate text-console-micro font-bold text-zinc-200">
              {doc.metrics.securityStatus}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-black/60 px-2 py-1">
            <HardDrive className="h-3 w-3 shrink-0 text-[#22d3ee]" />
            <span className="truncate text-console-micro font-bold text-zinc-200">
              {doc.metrics.integrityStatus}
            </span>
          </div>
        </div>

        {/* Plain-English Verdict */}
        <div className="deck-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/65 p-2">
          <div className="mb-0.5 flex items-center gap-1 text-console-micro font-extrabold tracking-wider text-[#22d3ee] uppercase">
            <Sparkles className="h-2.5 w-2.5" />
            Diagnosis Summary
          </div>
          <p className="text-console-caption leading-[1.38] text-zinc-200">
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
            className="col-span-2 flex h-8 items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/[0.06] text-console-caption font-extrabold whitespace-nowrap text-white disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 shrink-0 ${doc.scanning ? 'animate-spin' : ''}`} />
            SCAN ALL
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={() => triggerRepair(doc.aiConfigured ? 'ai_rescue' : 'fix_all')}
            className="col-span-3 flex h-8 items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#a78bfa] via-[#22d3ee] to-[#34d399] text-console-caption font-extrabold whitespace-nowrap text-[#04130c] disabled:opacity-40"
            style={{ boxShadow: '0 2px 0 #14664a' }}
          >
            {doc.aiConfigured ? (
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Wrench className="h-3.5 w-3.5 shrink-0" />
            )}
            {doc.aiConfigured ? 'AI AUTO-FIX' : 'FIX ALL & RESCUE'}
          </motion.button>
        </div>
      </div>

      {/* RIGHT: 3-Tab Diagnostic, Live Terminal & Post-Repair English Report */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#ff5d6c] via-[#fbbf24] to-[#34d399]" />

        {/* 3-Tab Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-full bg-black/75 p-0.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('issues');
              }}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-console-micro font-extrabold uppercase"
              style={{
                background: rightTab === 'issues' ? '#1f222c' : 'transparent',
                color: rightTab === 'issues' ? (problemCount > 0 ? '#fbbf24' : '#34d399') : '#7c8190',
              }}
            >
              <ShieldAlert className="h-3 w-3" />
              Issues ({problemCount})
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('terminal');
              }}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-console-micro font-extrabold uppercase"
              style={{
                background: rightTab === 'terminal' ? '#1f222c' : 'transparent',
                color: rightTab === 'terminal' ? '#22d3ee' : '#7c8190',
              }}
            >
              <Terminal className="h-3 w-3" />
              Terminal
              {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34d399]" />}
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('report');
              }}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-console-micro font-extrabold uppercase"
              style={{
                background: rightTab === 'report' ? '#1f222c' : 'transparent',
                color: rightTab === 'report' ? '#34d399' : '#7c8190',
              }}
            >
              <ClipboardCheck className="h-3 w-3" />
              English Report
              {report && <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />}
            </button>
          </div>

          <span className="font-mono-tech text-console-micro text-zinc-500">
            {busy ? 'LIVE RUNNING…' : `${doc.terminalLines.length} log lines`}
          </span>
        </div>

        {/* TAB 1: Issues & Plain-English Diagnosis */}
        {rightTab === 'issues' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            <HealthInsights deck={deck} />
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
                      <span className="truncate text-console-caption font-extrabold text-white">
                        {issue.title}
                      </span>
                    </div>

                    {issue.fixAction && (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        disabled={busy}
                        onClick={() => triggerRepair(issue.fixAction!)}
                        className="shrink-0 rounded-lg px-2 py-0.5 text-console-micro font-extrabold uppercase disabled:opacity-40"
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

                  <p className="mt-1 text-console-caption leading-[1.38] text-zinc-300">
                    {issue.plainEnglish}
                  </p>
                  <div className="font-mono-tech mt-0.5 text-console-micro text-zinc-500">
                    Impact: {issue.impact}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: Embedded Live Rescue Terminal */}
        {rightTab === 'terminal' && (
          <div
            ref={termRef}
            className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#040508] p-2 text-console-micro leading-[1.45]"
          >
            {doc.terminalLines.length > 0 ? (
              doc.terminalLines.map((line, idx) => {
                const color = line.startsWith('[AI THOUGHT')
                  ? 'text-[#c4b5fd] font-bold'
                  : line.startsWith('$ ')
                    ? 'text-[#fbbf24] font-bold'
                    : line.includes('❌') || line.includes('🛑') || /error|corrupt|threat|fail/i.test(line)
                      ? 'text-[#ff5d6c]'
                      : line.includes('✅') || /clean|verified|ok|finished|freed/i.test(line)
                        ? 'text-[#34d399]'
                        : line.startsWith('===')
                          ? 'text-[#22d3ee] font-bold'
                          : 'text-[#d4f5e9]';
                return (
                  <div key={idx} className={`break-words whitespace-pre-wrap ${color}`}>
                    {line}
                  </div>
                );
              })
            ) : (
              <div className="grid h-full place-items-center text-center text-zinc-500">
                Tap SCAN ALL or FIX ALL to watch live antivirus, SFC/DISM, diskutil & repair commands execute
                here.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Structured Plain-English Post-Repair Report */}
        {rightTab === 'report' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            {report ? (
              <>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-[#34d399]/30 bg-[#34d399]/[0.08] px-2.5 py-1.5">
                  <div>
                    <div className="text-console-caption font-extrabold text-white">Full Rescue Report</div>
                    <div className="num font-mono-tech text-console-caption font-extrabold text-[#34d399]">
                      Health Score: {report.scoreBefore} → {report.scoreAfter}/100
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={triggerScan}
                      className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-console-micro font-extrabold text-zinc-200 uppercase disabled:opacity-40"
                    >
                      Re-Scan
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => triggerRepair(doc.aiConfigured ? 'ai_rescue' : 'fix_all')}
                      className="rounded-lg bg-[#34d399] px-2 py-1 text-console-micro font-extrabold text-[#04130c] uppercase disabled:opacity-40"
                    >
                      Redo All
                    </button>
                  </div>
                </div>

                {/* What Was Fixed */}
                <div className="rounded-xl border border-[#34d399]/25 bg-black/70 p-2">
                  <div className="mb-1 text-console-caption font-extrabold tracking-wider text-[#34d399] uppercase">
                    ✓ What Was Fixed
                  </div>
                  <div className="space-y-1 text-console-caption text-zinc-200">
                    {report.whatWasFixed.map((item, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#34d399]" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* What Could Not Be Auto-Fixed */}
                {report.whatWasNotFixed.length > 0 && (
                  <div className="rounded-xl border border-[#fbbf24]/30 bg-black/70 p-2">
                    <div className="mb-1 text-console-caption font-extrabold tracking-wider text-[#fbbf24] uppercase">
                      ! What Could Not Be Auto-Fixed (Needs You)
                    </div>
                    <div className="space-y-1 text-console-caption text-zinc-200">
                      {report.whatWasNotFixed.map((item, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#fbbf24]" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Why It Was Slow */}
                <div className="rounded-xl border border-[#22d3ee]/25 bg-black/70 p-2">
                  <div className="mb-1 text-console-caption font-extrabold tracking-wider text-[#22d3ee] uppercase">
                    Why Your Computer Was Slow (Root Cause)
                  </div>
                  <div className="space-y-1 text-console-caption text-zinc-300">
                    {report.whyItHappened.map((item, i) => (
                      <p key={i}>• {item}</p>
                    ))}
                  </div>
                </div>

                {/* Step-by-Step Next Actions */}
                <div className="rounded-xl border border-[#a78bfa]/25 bg-black/70 p-2">
                  <div className="mb-1 text-console-caption font-extrabold tracking-wider text-[#a78bfa] uppercase">
                    Recommended Next Steps
                  </div>
                  <div className="space-y-1 text-console-caption text-zinc-200">
                    {report.nextSteps.map((step, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="font-mono-tech font-extrabold text-[#a78bfa]">{i + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Redo Any Specific Repair Step */}
                <div className="rounded-xl border border-white/[0.07] bg-black/60 p-2">
                  <div className="mb-1.5 text-console-micro font-extrabold tracking-wider text-zinc-400 uppercase">
                    Re-Run Any Specific Repair
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { action: 'scan_malware', label: 'Redo Virus Scan', color: '#f472b6' },
                        { action: 'verify_system_files', label: 'Redo Corrupt Fix', color: '#ff5d6c' },
                        { action: 'clean_junk', label: 'Redo Clean Junk', color: '#fbbf24' },
                        { action: 'free_ram', label: 'Redo Trim RAM', color: '#a78bfa' },
                        { action: 'flush_dns', label: 'Redo Flush DNS', color: '#22d3ee' },
                      ] as const
                    ).map((btn) => (
                      <button
                        key={btn.action}
                        type="button"
                        disabled={busy}
                        onClick={() => triggerRepair(btn.action)}
                        className="rounded-lg border px-2 py-1 text-console-micro font-extrabold uppercase disabled:opacity-40"
                        style={{
                          background: `${btn.color}18`,
                          borderColor: `${btn.color}44`,
                          color: btn.color,
                        }}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid h-full place-items-center text-center">
                <div className="space-y-1.5">
                  <ClipboardCheck className="mx-auto h-7 w-7 text-[#34d399]/60" />
                  <div className="text-console-body font-bold text-zinc-200">No Rescue Report Yet</div>
                  <div className="sub max-w-[260px]">
                    Tap &quot;FIX ALL &amp; RESCUE&quot; to scan viruses, verify corrupted files, clean junk,
                    and generate a complete English report.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Individual Repair Tools Strip (pixel-aligned h-8 with left card buttons) */}
        <div className="grid grid-cols-4 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('scan_malware')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#f472b6]/35 bg-[#f472b6]/12 text-console-micro font-extrabold whitespace-nowrap text-[#f472b6] disabled:opacity-40"
          >
            <Bug className="h-3 w-3 shrink-0" />
            VIRUS SCAN
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('verify_system_files')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#ff5d6c]/35 bg-[#ff5d6c]/12 text-console-micro font-extrabold whitespace-nowrap text-[#ff5d6c] disabled:opacity-40"
          >
            <ShieldCheck className="h-3 w-3 shrink-0" />
            {isWin ? 'SFC/DISM' : 'CORRUPT FIX'}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('clean_junk')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#fbbf24]/35 bg-[#fbbf24]/12 text-console-micro font-extrabold whitespace-nowrap text-[#fbbf24] disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3 shrink-0" />
            CLEAN JUNK
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => triggerRepair('free_ram')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/12 text-console-micro font-extrabold whitespace-nowrap text-[#a78bfa] disabled:opacity-40"
          >
            <MemoryStick className="h-3 w-3 shrink-0" />
            FREE RAM
          </motion.button>
        </div>
      </div>
    </div>
  );
}
