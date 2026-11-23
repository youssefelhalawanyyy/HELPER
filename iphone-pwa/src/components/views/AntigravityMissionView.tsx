'use client';

import { motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileDiff,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'Step-by-step plan', color: '#22d3ee' },
  { cmd: '/boost', desc: 'Deep thinking', color: '#a78bfa' },
  { cmd: '/goal', desc: 'Overnight loop', color: '#34d399' },
  { cmd: '/compact', desc: 'Free context', color: '#fbbf24' },
  { cmd: '/grill-me', desc: 'Design Q&A', color: '#f472b6' },
  { cmd: '/learn', desc: 'Persist rule', color: '#60a5fa' },
];

export function AntigravityMissionView({ deck }: { deck: DevDeckState }) {
  const ag = deck.antigravityState;
  const prog = deck.agentProgress;

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1.15fr 1fr' }}>
      {/* Column 1: Live Agent Status, Progress HUD & One-Tap Slash Command Pad */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full bg-gradient-to-r from-[#2563eb] to-[#22d3ee]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Bot className="h-4 w-4 text-[#22d3ee]" />
            <span className="disp text-[22px]">Mission</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'app:focus',
                payload: { requestId: makeRequestId(), appName: 'Antigravity' },
              });
            }}
            className="flex items-center gap-1 rounded-full bg-[#2563eb] px-2.5 py-0.5 text-[9.5px] font-extrabold text-white"
            style={{ boxShadow: '0 0 12px #2563eb88' }}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            OPEN IDE
          </button>
        </div>

        {/* Live Agent Activity & MCP Progress HUD */}
        <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase">
              <i
                className={`h-2 w-2 rounded-full ${ag.active || prog.active ? 'anim-ping bg-[#34d399]' : 'bg-zinc-600'}`}
              />
              <span style={{ color: ag.active || prog.active ? '#34d399' : '#8b90a0' }}>
                {prog.active ? prog.title || 'Agent Working' : ag.active ? 'Agent Active' : 'Agent Idle'}
              </span>
            </span>
            {prog.active && (
              <span className="num text-[10px] font-extrabold text-[#22d3ee]">
                {Math.round(prog.percent)}%
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[10px] text-zinc-300">
            {prog.active
              ? prog.step
              : ag.conversationId
                ? `Brain: ${ag.conversationId.slice(0, 12)}…`
                : 'Ready for Antigravity MCP'}
          </div>
          {prog.active && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#22d3ee] to-[#34d399] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(4, prog.percent))}%` }}
              />
            </div>
          )}
        </div>

        {/* One-Tap Antigravity Slash Command Pad */}
        <div className="flex flex-1 flex-col justify-end">
          <div className="mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[#a78bfa]" />
            <span className="sub !text-[8.5px]">One-Tap Slash Commands (⌘L + Paste)</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {SLASH_COMMANDS.map((item) => (
              <motion.button
                key={item.cmd}
                type="button"
                whileTap={{ scale: 0.93 }}
                transition={DECK_SPRING}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'antigravity:slash',
                    payload: { requestId: makeRequestId(), command: item.cmd },
                  });
                }}
                className="rounded-xl border border-white/[0.07] bg-white/[0.04] px-2.5 py-1.5 text-left hover:border-white/25"
              >
                <div className="font-mono-tech text-[11px] font-extrabold" style={{ color: item.color }}>
                  {item.cmd}
                </div>
                <div className="truncate text-[8.5px] text-[#7c8190]">{item.desc}</div>
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Column 2: Active Brain Artifact Reader (implementation_plan.md / task.md) */}
      <div className="tile flex min-h-0 flex-col p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileCode2 className="h-4 w-4 shrink-0 text-[#a78bfa]" />
            <span className="disp truncate text-[20px]">Active Plan</span>
          </div>
          <span className="font-mono-tech truncate text-[9px] text-[#a78bfa]">
            {ag.artifactName || 'none'}
          </span>
        </div>

        <div className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/75 p-2.5 text-[9.5px] leading-relaxed whitespace-pre-wrap text-zinc-200">
          {ag.artifactPreview || 'No active implementation_plan.md or task.md found in ~/.gemini/antigravity/brain/ yet.'}
        </div>
      </div>

      {/* Column 3: Live Agent Diff Viewer + Accept / Reject */}
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
              Working tree clean — agent edits appear here live
            </div>
          )}
        </div>

        {/* One-Tap Accept / Reject Diff Buttons */}
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
