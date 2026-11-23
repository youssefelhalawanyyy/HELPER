'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileCode2,
  FileDiff,
  Loader2,
  Sparkles,
  Terminal,
  User,
  XCircle,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'Step plan', color: '#22d3ee' },
  { cmd: '/boost', desc: 'Deep mode', color: '#a78bfa' },
  { cmd: '/goal', desc: 'Auto loop', color: '#34d399' },
  { cmd: '/compact', desc: 'Trim ctx', color: '#fbbf24' },
  { cmd: '/grill-me', desc: 'Q&A spec', color: '#f472b6' },
  { cmd: '/learn', desc: 'Save rule', color: '#60a5fa' },
];

function formatTokens(n: number): string {
  if (!n) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function AntigravityMissionView({ deck }: { deck: DevDeckState }) {
  const [centerTab, setCenterTab] = useState<'feed' | 'plan'>('feed');
  const ag = deck.antigravityState;
  const prog = deck.agentProgress;

  const isWorking = ag.statusLabel === 'WORKING' || prog.active;

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1.25fr 0.95fr' }}>
      {/* Column 1: Live Agent Status, Real Telemetry, Current Focus & Slash Pad */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full bg-gradient-to-r from-[#2563eb] to-[#22d3ee]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Bot className="h-4 w-4 text-[#22d3ee]" />
            <span className="disp text-[21px]">Antigravity</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'app:focus',
                payload: { requestId: makeRequestId(), appName: 'Antigravity IDE' },
              });
            }}
            className="flex items-center gap-1 rounded-full bg-[#2563eb] px-2.5 py-0.5 text-[9px] font-extrabold text-white"
            style={{ boxShadow: '0 0 12px #2563eb88' }}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            OPEN IDE
          </button>
        </div>

        {/* Live Agent Telemetry Card (100% real data from transcript.jsonl) */}
        <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase">
              <span className="relative h-2 w-2">
                {isWorking && (
                  <i className="anim-ping absolute inset-0 rounded-full bg-[#34d399]" />
                )}
                <i
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: isWorking
                      ? '#34d399'
                      : ag.statusLabel === 'WAITING'
                        ? '#22d3ee'
                        : '#6b7080',
                  }}
                />
              </span>
              <span
                style={{
                  color: isWorking
                    ? '#34d399'
                    : ag.statusLabel === 'WAITING'
                      ? '#22d3ee'
                      : '#8b90a0',
                }}
              >
                {prog.active ? prog.title : ag.statusLabel}
              </span>
            </span>

            <span className="num font-mono-tech text-[9.5px] font-bold text-[#a78bfa]">
              #{ag.stepCount || 0} · {formatTokens(ag.contextTokens)} ctx
            </span>
          </div>

          <div className="mt-1 truncate text-[10px] font-medium text-zinc-200">
            {prog.active
              ? prog.step
              : ag.currentFocus || ag.lastUserPrompt || 'Waiting for active conversation…'}
          </div>

          {prog.active && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#22d3ee] to-[#34d399] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(4, prog.percent))}%` }}
              />
            </div>
          )}

          {ag.steps.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-white/[0.06] pt-1">
              {ag.steps.slice(0, 3).map((s, idx) => (
                <div key={idx} className="flex items-center gap-1.5 text-[9px]">
                  {s.status === 'done' ? (
                    <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-[#34d399]" />
                  ) : s.status === 'in_progress' ? (
                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-[#22d3ee]" />
                  ) : (
                    <Circle className="h-2.5 w-2.5 shrink-0 text-zinc-600" />
                  )}
                  <span className="truncate text-zinc-300">{s.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* One-Tap Slash Command Pad */}
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[#a78bfa]" />
            <span className="sub !text-[8.5px]">Slash Commands (IDE ⌘L)</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {SLASH_COMMANDS.map((item) => (
              <motion.button
                key={item.cmd}
                type="button"
                whileTap={{ scale: 0.92 }}
                transition={DECK_SPRING}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'antigravity:slash',
                    payload: { requestId: makeRequestId(), command: item.cmd },
                  });
                }}
                className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-1.5 py-1 text-left hover:border-white/25"
              >
                <div
                  className="font-mono-tech truncate text-[10px] font-extrabold"
                  style={{ color: item.color }}
                >
                  {item.cmd}
                </div>
                <div className="truncate text-[8px] text-[#7c8190]">{item.desc}</div>
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Column 2: Real-Time Agent Feed (transcript.jsonl) OR Active Plan */}
      <div className="tile flex min-h-0 flex-col p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setCenterTab('feed');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9.5px] font-extrabold uppercase"
              style={{
                background: centerTab === 'feed' ? '#1f222c' : 'transparent',
                color: centerTab === 'feed' ? '#22d3ee' : '#7c8190',
              }}
            >
              <Activity className="h-3 w-3" />
              Live Feed
            </button>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setCenterTab('plan');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9.5px] font-extrabold uppercase"
              style={{
                background: centerTab === 'plan' ? '#1f222c' : 'transparent',
                color: centerTab === 'plan' ? '#a78bfa' : '#7c8190',
              }}
            >
              <FileCode2 className="h-3 w-3" />
              Plan
            </button>
          </div>
          <span className="font-mono-tech truncate text-[8.5px] text-[#7c8190]">
            {centerTab === 'plan' ? ag.artifactName || 'none' : `${ag.recentEvents.length} live`}
          </span>
        </div>

        {centerTab === 'feed' ? (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {ag.recentEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/60 px-2.5 py-1.5"
              >
                <span className="mt-0.5 shrink-0">
                  {ev.kind === 'user' ? (
                    <User className="h-3 w-3 text-[#fbbf24]" />
                  ) : ev.kind === 'tool' ? (
                    <Terminal className="h-3 w-3 text-[#22d3ee]" />
                  ) : (
                    <Bot className="h-3 w-3 text-[#34d399]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="font-mono-tech text-[9.5px] font-extrabold"
                      style={{
                        color:
                          ev.kind === 'user'
                            ? '#fbbf24'
                            : ev.kind === 'tool'
                              ? '#22d3ee'
                              : '#34d399',
                      }}
                    >
                      {ev.label}
                    </span>
                  </div>
                  <p className="truncate text-[10px] text-zinc-300">{ev.detail}</p>
                </div>
              </div>
            ))}
            {ag.recentEvents.length === 0 && (
              <div className="sub grid h-full place-items-center text-center">
                Connect Mac bridge to stream live Antigravity transcript
              </div>
            )}
          </div>
        ) : (
          <div className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/75 p-2.5 text-[9.5px] leading-relaxed whitespace-pre-wrap text-zinc-200">
            {ag.artifactPreview || 'No implementation_plan.md or task.md in active conversation.'}
          </div>
        )}
      </div>

      {/* Column 3: Live Git Diff + Accept / Reject */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FileDiff className="h-4 w-4 text-[#34d399]" />
            <span className="disp text-[20px]">Live Diff</span>
          </div>
          <span className="num text-[10px] font-extrabold">
            <span className="text-[#34d399]">+{ag.totalAdded}</span>{' '}
            <span className="text-[#ff5d6c]">-{ag.totalRemoved}</span>
          </span>
        </div>

        <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          {ag.diffFiles.map((f) => (
            <div
              key={f.file}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-[9.5px]"
            >
              <span className="font-mono-tech truncate text-zinc-200">{f.file}</span>
              <span className="num shrink-0 font-bold">
                <span className="text-[#34d399]">+{f.added}</span>{' '}
                <span className="text-[#ff5d6c]">-{f.removed}</span>
              </span>
            </div>
          ))}
          {ag.diffFiles.length === 0 && (
            <div className="sub grid h-full place-items-center text-center">
              Working tree clean — agent edits appear live
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              soundEngine.playErrorThud();
              deck.sendEvent({
                type: 'macro:execute',
                payload: { requestId: makeRequestId(), macroId: 'ag-reject-changes' },
              });
            }}
            className="flex items-center justify-center gap-1 rounded-xl border border-[#ff5d6c]/40 bg-[#ff5d6c]/15 py-2 text-[10px] font-extrabold text-[#ff5d6c]"
          >
            <XCircle className="h-3.5 w-3.5" />
            REJECT ⌘⌫
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              soundEngine.playSuccessChime();
              deck.sendEvent({
                type: 'macro:execute',
                payload: { requestId: makeRequestId(), macroId: 'ag-accept-changes' },
              });
            }}
            className="flex items-center justify-center gap-1 rounded-xl bg-[#34d399] py-2 text-[10px] font-extrabold text-[#04130c]"
            style={{ boxShadow: '0 2px 0 #14664a' }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            ACCEPT ⌘↵
          </motion.button>
        </div>
      </div>
    </div>
  );
}
