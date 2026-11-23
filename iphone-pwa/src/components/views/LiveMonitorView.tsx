'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Square } from 'lucide-react';
import { BrushedDial, GlowRing } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatSpeed, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const PIPELINE_STEPS = ['Install', 'Compile', 'Test', 'Bundle'];

export function LiveMonitorView({ deck }: { deck: DevDeckState }) {
  const [stepIdx, setStepIdx] = useState(-1);
  const [dialVal, setDialVal] = useState(deck.mediaState.volume);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const lastSendRef = useRef(0);

  useEffect(() => {
    setDialVal(deck.mediaState.volume);
  }, [deck.mediaState.volume]);

  useEffect(() => {
    if (stepIdx < 0 || stepIdx >= PIPELINE_STEPS.length) return;
    const id = window.setTimeout(() => {
      setStepIdx((x) => x + 1);
      soundEngine.playDetent();
      if (stepIdx === PIPELINE_STEPS.length - 1) {
        deck.triggerFlash('success', 'Build passed cleanly');
      }
    }, 850);
    return () => window.clearTimeout(id);
  }, [stepIdx, deck]);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [deck.logs.length, showLogs]);

  const done = stepIdx >= PIPELINE_STEPS.length;
  const running = (stepIdx >= 0 && !done) || deck.logStatus.running;

  const handleRunBuild = () => {
    soundEngine.playClick();
    if (deck.status === 'connected') {
      if (deck.logStatus.running) {
        deck.sendEvent({ type: 'logs:stop', payload: { requestId: makeRequestId() } });
      } else {
        const presetId = deck.config?.logPresets?.[0]?.id || 'preset-typecheck';
        deck.sendEvent({
          type: 'logs:start',
          payload: { requestId: makeRequestId(), presetId },
        });
        setShowLogs(true);
      }
    } else {
      setStepIdx(0);
    }
  };

  const handleDialChange = (nextVal: number, delta: number) => {
    setDialVal(nextVal);
    if (deck.status === 'connected' && Date.now() - lastSendRef.current > 90) {
      lastSendRef.current = Date.now();
      deck.sendEvent({
        type: 'hardware:dial',
        payload: { mode: 'volume', delta, value: Math.round(nextVal) },
      });
    }
  };

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1.15fr 1fr 155px' }}>
      {/* Column 1: Telemetry Rings */}
      <div className="tile flex flex-col p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="disp text-[28px]">Telemetry</div>
        <div className="flex flex-1 items-center justify-around">
          <GlowRing value={deck.stats.cpuPct || 24} color="#22d3ee" label="CPU %" />
          <GlowRing value={deck.stats.ramPct || 46} color="#f472b6" label="RAM %" />
        </div>
        <div className="flex items-center justify-between">
          <span className="sub">
            Disk {deck.stats.diskPct || 52}% · ↓{formatSpeed(deck.stats.netRxKBs)}
          </span>
          <span className="sub !text-[#22d3ee]">Mac · live</span>
        </div>
      </div>

      {/* Column 2: Build Pipeline / Live Log Stream */}
      <div className="tile flex flex-col p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="disp text-left text-[28px] hover:text-[#34d399]"
            title="Toggle Pipeline / Raw Logs"
          >
            {showLogs ? 'Logs' : 'Build'}
          </button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            aria-label="Run build"
            onClick={handleRunBuild}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-extrabold"
            style={{
              background: deck.logStatus.running ? '#e5484d' : '#34d399',
              color: deck.logStatus.running ? '#ffffff' : '#04130c',
              boxShadow: deck.logStatus.running ? '0 2px 0 #7a1d20' : '0 2px 0 #14664a',
            }}
          >
            {deck.logStatus.running ? (
              <>
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </>
            ) : running ? (
              'Building…'
            ) : done ? (
              'Rebuild'
            ) : (
              'Run build'
            )}
          </motion.button>
        </div>

        {showLogs ? (
          <div className="deck-scroll font-mono-tech my-2 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/70 p-2 text-[9.5px] leading-relaxed">
            {deck.logs.length === 0 ? (
              <div className="grid h-full place-items-center text-[#7c8190]">
                Tap Run build to stream stdout/stderr
              </div>
            ) : (
              deck.logs.slice(-50).map((line) => (
                <div
                  key={line.id}
                  className={`break-all ${
                    line.level === 'error'
                      ? 'text-[#ff5d6c]'
                      : line.level === 'success'
                        ? 'text-[#34d399]'
                        : line.level === 'warn'
                          ? 'text-[#fbbf24]'
                          : 'text-zinc-300'
                  }`}
                >
                  {line.text}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-2">
            {PIPELINE_STEPS.map((s, i) => {
              const stepDone = stepIdx > i;
              const current = stepIdx === i;
              return (
                <div
                  key={s}
                  className="flex items-center gap-2 text-[11px] font-semibold"
                  style={{ opacity: stepIdx < 0 ? 0.55 : 1 }}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full border"
                    style={{
                      borderColor: stepDone ? '#34d399' : current ? '#fbbf24' : '#3a3e4b',
                      background: stepDone ? '#34d399' : 'transparent',
                      color: '#04130c',
                    }}
                  >
                    {stepDone && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    {current && (
                      <motion.i
                        className="h-1.5 w-1.5 rounded-full bg-[#fbbf24]"
                        animate={{ opacity: [1, 0.2, 1] }}
                        transition={{ repeat: Infinity, duration: 0.7 }}
                      />
                    )}
                  </span>
                  <span className="flex-1">{s}</span>
                  <span className="sub num">{stepDone ? 'ok' : current ? '…' : ''}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="sub" style={{ color: done ? '#34d399' : undefined }}>
            {done ? 'Build passed' : running ? 'In progress' : 'Tap title for logs'}
          </span>
        </div>
      </div>

      {/* Column 3: Brushed-Metal Rotary Dial */}
      <div className="tile flex flex-col items-center p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#fbbf24]" />
        <div className="text-center text-[11px] leading-tight font-extrabold">
          Mac volume
          <div className="sub mt-0.5">&amp; utils</div>
        </div>
        <div className="grid flex-1 place-items-center">
          <BrushedDial value={dialVal} onChange={handleDialChange} label="Mac volume dial" />
        </div>
        <div className="sub">Drag to turn</div>
      </div>
    </div>
  );
}
