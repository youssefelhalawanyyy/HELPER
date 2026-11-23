'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  Eye,
  FileCode2,
  FileDiff,
  Loader2,
  MessageSquare,
  Mic,
  Search,
  Send,
  Sparkles,
  Terminal,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type {
  AntigravityChatTurn,
  AntigravityTerminalRun,
  AntigravityToolItem,
} from '@/types/protocol';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'Step plan', color: '#22d3ee' },
  { cmd: '/boost', desc: 'Deep mode', color: '#a78bfa' },
  { cmd: '/goal', desc: 'Auto loop', color: '#34d399' },
  { cmd: '/compact', desc: 'Trim ctx', color: '#fbbf24' },
  { cmd: '/grill-me', desc: 'Q&A spec', color: '#f472b6' },
  { cmd: '/learn', desc: 'Save rule', color: '#60a5fa' },
];

interface SpeechRecLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function formatTokens(n: number): string {
  if (!n) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function shortModel(model?: string): string {
  if (!model) return '';
  return model
    .replace(/^models\//i, '')
    .replace(/-preview.*$/i, '')
    .replace(/-exp.*$/i, '')
    .slice(0, 18);
}

function formatTime(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function toolStyle(name: string): { color: string; Icon: typeof Wrench } {
  const lower = name.toLowerCase();
  if (lower.includes('edit') || lower.includes('write') || lower.includes('multi_replace')) {
    return { color: '#34d399', Icon: FileCode2 };
  }
  if (lower.includes('command') || lower.includes('shell') || lower.includes('terminal')) {
    return { color: '#fbbf24', Icon: Terminal };
  }
  if (lower.includes('read') || lower.includes('view')) {
    return { color: '#22d3ee', Icon: Eye };
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find')) {
    return { color: '#60a5fa', Icon: Search };
  }
  if (lower.includes('agent') || lower.includes('browser') || lower.includes('notify')) {
    return { color: '#a78bfa', Icon: Bot };
  }
  return { color: '#9ca3af', Icon: Wrench };
}

function renderInlineSpans(line: string) {
  const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return (
        <code
          key={i}
          className="font-mono-tech rounded bg-white/[0.08] px-1 py-0.5 text-[9.5px] text-[#22d3ee]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return (
        <strong key={i} className="font-bold text-white">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}

function FormattedAgentText({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-1 text-[10.5px] leading-[1.45] text-zinc-200">
      {blocks.map((block, bIdx) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
          return (
            <pre
              key={bIdx}
              className="font-mono-tech overflow-x-auto rounded-lg border border-white/[0.07] bg-black/80 px-2 py-1.5 text-[9px] leading-snug text-[#a5f3fc]"
            >
              {inner}
            </pre>
          );
        }
        const lines = block.split('\n');
        return (
          <div key={bIdx} className="space-y-0.5">
            {lines.map((rawLine, lIdx) => {
              const line = rawLine.trimEnd();
              if (!line.trim()) return <div key={lIdx} className="h-1" />;
              if (/^#{1,3}\s+/.test(line)) {
                return (
                  <div key={lIdx} className="pt-0.5 text-[11px] font-extrabold text-white">
                    {renderInlineSpans(line.replace(/^#{1,3}\s+/, ''))}
                  </div>
                );
              }
              if (/^\s*[-*•]\s+/.test(line)) {
                return (
                  <div key={lIdx} className="flex items-start gap-1.5 pl-1">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-[#22d3ee]" />
                    <span className="min-w-0 flex-1 break-words">
                      {renderInlineSpans(line.replace(/^\s*[-*•]\s+/, ''))}
                    </span>
                  </div>
                );
              }
              return (
                <p key={lIdx} className="break-words">
                  {renderInlineSpans(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ToolCallChip({ tool }: { tool: AntigravityToolItem }) {
  const [open, setOpen] = useState(false);
  const { color, Icon } = toolStyle(tool.name);
  const hasDetail = Boolean(tool.detail && tool.detail !== tool.summary);

  return (
    <div
      className="rounded-lg border border-white/[0.07] bg-white/[0.03]"
      style={{ borderLeftWidth: 2, borderLeftColor: color }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <Icon className="h-3 w-3 shrink-0" style={{ color }} />
        <span className="font-mono-tech shrink-0 text-[9px] font-extrabold" style={{ color }}>
          {tool.name}
        </span>
        <span className="font-mono-tech min-w-0 flex-1 truncate text-[9px] text-zinc-300">
          {tool.summary}
        </span>
        {hasDetail &&
          (open ? (
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
          ))}
      </button>
      {open && hasDetail && (
        <div className="font-mono-tech border-t border-white/[0.05] bg-black/50 px-2 py-1 text-[8.5px] break-all text-zinc-400">
          {tool.detail}
        </div>
      )}
    </div>
  );
}

function ChatTurnBubble({ turn }: { turn: AntigravityChatTurn }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm border border-[#22d3ee]/30 bg-gradient-to-br from-[#2563eb]/25 to-[#22d3ee]/12 px-2.5 py-1.5">
          <div className="mb-0.5 flex items-center justify-end gap-1.5">
            <span className="font-mono-tech text-[8px] font-bold tracking-wider text-[#22d3ee] uppercase">
              You
            </span>
            {turn.ts > 0 && (
              <span className="font-mono-tech text-[8px] text-zinc-400">
                {formatTime(turn.ts)}
              </span>
            )}
          </div>
          <p className="text-[10.5px] leading-snug break-words whitespace-pre-wrap text-white">
            {turn.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full rounded-2xl rounded-bl-sm border border-white/[0.08] bg-black/70 px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-md bg-[#22d3ee]/15 text-[#22d3ee]">
              <Bot className="h-2.5 w-2.5" />
            </span>
            <span className="font-mono-tech text-[9px] font-extrabold tracking-wider text-[#22d3ee] uppercase">
              Antigravity
            </span>
            {turn.model && (
              <span className="font-mono-tech rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] text-zinc-400">
                {shortModel(turn.model)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {Boolean(turn.tokens) && (
              <span className="num font-mono-tech text-[8px] text-[#a78bfa]">
                +{formatTokens(turn.tokens || 0)} tok
              </span>
            )}
            {turn.ts > 0 && (
              <span className="font-mono-tech text-[8px] text-zinc-500">
                {formatTime(turn.ts)}
              </span>
            )}
          </div>
        </div>

        {turn.thinking && (
          <div className="mb-1.5 rounded-lg border border-[#a78bfa]/20 bg-[#a78bfa]/[0.06]">
            <button
              type="button"
              onClick={() => setThinkingOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
            >
              <Brain className="h-3 w-3 shrink-0 text-[#a78bfa]" />
              <span className="font-mono-tech shrink-0 text-[8.5px] font-bold text-[#a78bfa] uppercase">
                Thought
              </span>
              {!thinkingOpen && (
                <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-400 italic">
                  {turn.thinking}
                </span>
              )}
              {thinkingOpen ? (
                <ChevronDown className="ml-auto h-2.5 w-2.5 shrink-0 text-[#a78bfa]" />
              ) : (
                <ChevronRight className="ml-auto h-2.5 w-2.5 shrink-0 text-[#a78bfa]" />
              )}
            </button>
            {thinkingOpen && (
              <div className="border-t border-[#a78bfa]/15 px-2 py-1.5 text-[9.5px] leading-relaxed break-words whitespace-pre-wrap text-zinc-300 italic">
                {turn.thinking}
              </div>
            )}
          </div>
        )}

        {turn.tools.length > 0 && (
          <div className="mb-1.5 space-y-1">
            {turn.tools.map((tool, i) => (
              <ToolCallChip key={`${tool.name}-${i}`} tool={tool} />
            ))}
          </div>
        )}

        {turn.text && <FormattedAgentText text={turn.text} />}
      </div>
    </div>
  );
}

function AgentTerminalPanel({
  runs,
  selectedId,
  onSelect,
  onToggleIdeTerminal,
  compact = false,
}: {
  runs: AntigravityTerminalRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleIdeTerminal: () => void;
  compact?: boolean;
}) {
  const outRef = useRef<HTMLPreElement | null>(null);
  const activeRun = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  useEffect(() => {
    if (!outRef.current) return;
    outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [activeRun?.id, activeRun?.output]);

  if (!activeRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <TerminalSquare className="h-6 w-6 text-[#fbbf24]/50" />
        <div className="sub">No agent terminal commands yet</div>
        <button
          type="button"
          onClick={onToggleIdeTerminal}
          className="rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[9px] font-bold text-zinc-200"
        >
          Toggle IDE Terminal ⌘`
        </button>
      </div>
    );
  }

  const badgeColor =
    activeRun.status === 'running'
      ? '#34d399'
      : activeRun.status === 'error'
        ? '#ff5d6c'
        : '#22d3ee';

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {/* Command history tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5" data-no-swipe="true">
        {runs.slice(0, compact ? 4 : 6).map((r) => {
          const active = r.id === activeRun.id;
          const dot =
            r.status === 'running' ? '#34d399' : r.status === 'error' ? '#ff5d6c' : '#22d3ee';
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onSelect(r.id);
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[8.5px] font-bold transition-colors"
              style={{
                background: active ? '#1a1d27' : 'rgba(255,255,255,0.03)',
                borderColor: active ? `${dot}77` : 'rgba(255,255,255,0.07)',
                color: active ? '#f4f4f6' : '#8b90a0',
              }}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${r.status === 'running' ? 'animate-pulse' : ''}`}
                style={{ background: dot }}
              />
              <span className="max-w-[96px] truncate">{r.summary}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleIdeTerminal}
          className="ml-auto shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[8px] font-extrabold text-[#fbbf24]"
        >
          IDE ⌘`
        </button>
      </div>

      {/* Command header bar */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/80 px-2 py-1">
        <div className="font-mono-tech min-w-0 flex-1 truncate text-[9px] text-[#fbbf24]">
          $ {activeRun.command}
        </div>
        <span
          className="font-mono-tech shrink-0 rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase"
          style={{ background: `${badgeColor}20`, color: badgeColor }}
        >
          {activeRun.status === 'running'
            ? 'RUNNING'
            : `EXIT ${activeRun.exitCode ?? 0}`}
        </span>
      </div>

      {/* Pure-black OLED terminal output well */}
      <pre
        ref={outRef}
        className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#040508] p-2 text-[8.5px] leading-[1.4] whitespace-pre-wrap break-words text-[#d4f5e9]"
      >
        {activeRun.output || (activeRun.status === 'running' ? 'Streaming terminal output…' : '(no output)')}
      </pre>
    </div>
  );
}

export function AntigravityMissionView({ deck }: { deck: DevDeckState }) {
  const [mainMode, setMainMode] = useState<'chat' | 'terminal'>('chat');
  const [sideTab, setSideTab] = useState<'term' | 'live' | 'slash' | 'plan'>('term');
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState('');
  const [listening, setListening] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<SpeechRecLike | null>(null);

  const ag = deck.antigravityState;
  const prog = deck.agentProgress;
  const isWorking = ag.statusLabel === 'WORKING' || prog.active;
  const turns = ag.chatTurns ?? [];
  const terminalRuns = ag.terminalRuns ?? [];
  const hasRunningTerm = terminalRuns.some((r) => r.status === 'running');

  useEffect(() => {
    if (!pinnedToBottom || !scrollRef.current || mainMode !== 'chat') return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, ag.currentFocus, pinnedToBottom, mainMode]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(distanceFromBottom < 36);
  };

  const scrollToBottom = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setPinnedToBottom(true);
  };

  const toggleIdeTerminal = () => {
    soundEngine.playClick();
    deck.sendEvent({
      type: 'macro:execute',
      payload: { requestId: makeRequestId(), macroId: 'ag-toggle-terminal' },
    });
  };

  const sendPrompt = (overrideText?: string) => {
    const text = (overrideText ?? promptText).trim();
    if (!text) return;
    soundEngine.playClick();
    deck.sendEvent({
      type: 'antigravity:prompt',
      payload: { requestId: makeRequestId(), text, submit: true },
    });
    setPromptText('');
  };

  const toggleVoice = () => {
    if (listening) {
      voiceRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecLike;
      webkitSpeechRecognition?: new () => SpeechRecLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      deck.showToast(false, 'Voice dictation not supported in this browser');
      return;
    }
    soundEngine.playClick();
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let full = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        full += ev.results[i][0].transcript;
      }
      setPromptText(full);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    voiceRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1.8fr 1.05fr' }}>
      {/* LEFT / MAIN: Live Antigravity Chat Mirror OR Expanded Agent Terminal */}
      <div className="tile relative flex min-h-0 flex-col p-2.5">
        <div className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full bg-gradient-to-r from-[#2563eb] via-[#22d3ee] to-[#34d399]" />

        {/* Live Telemetry Header + Chat/Terminal Switch */}
        <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="relative h-2 w-2 shrink-0">
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
              className="font-mono-tech shrink-0 text-[9px] font-extrabold uppercase"
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
            <span className="truncate text-[9.5px] font-medium text-zinc-300">
              {prog.active
                ? prog.step
                : ag.currentFocus ||
                  (ag.conversationId ? `Session ${ag.conversationId.slice(0, 8)}` : 'Antigravity Live')}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Main view toggle: Chat vs Full-Width Agent Terminal */}
            <div className="flex rounded-full bg-black/75 p-0.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setMainMode('chat');
                }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase"
                style={{
                  background: mainMode === 'chat' ? '#1f222c' : 'transparent',
                  color: mainMode === 'chat' ? '#22d3ee' : '#7c8190',
                }}
              >
                <MessageSquare className="h-2.5 w-2.5" />
                Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setMainMode('terminal');
                }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase"
                style={{
                  background: mainMode === 'terminal' ? '#1f222c' : 'transparent',
                  color: mainMode === 'terminal' ? '#fbbf24' : '#7c8190',
                }}
              >
                <Terminal className="h-2.5 w-2.5" />
                Term
                {hasRunningTerm && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34d399]" />
                )}
              </button>
            </div>

            <span className="num font-mono-tech rounded-full border border-white/[0.08] bg-black/70 px-1.5 py-0.5 text-[8px] font-bold text-[#a78bfa]">
              #{ag.stepCount || 0} · {formatTokens(ag.contextTokens)}
            </span>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({
                  type: 'app:focus',
                  payload: { requestId: makeRequestId(), appName: 'Antigravity IDE' },
                });
              }}
              className="flex items-center gap-0.5 rounded-full bg-[#2563eb] px-2 py-0.5 text-[8px] font-extrabold text-white"
              style={{ boxShadow: '0 0 10px #2563eb88' }}
            >
              <ExternalLink className="h-2.5 w-2.5" />
              IDE
            </button>
          </div>
        </div>

        {/* Optional Live Progress Bar */}
        {prog.active && (
          <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#22d3ee] to-[#34d399] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(4, prog.percent))}%` }}
            />
          </div>
        )}

        {/* Main Body: Live Chat Stream OR Expanded Agent Terminal */}
        {mainMode === 'chat' ? (
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="deck-scroll h-full space-y-2 overflow-y-auto pr-1"
            >
              {turns.length > 0 ? (
                turns.map((turn) => <ChatTurnBubble key={turn.id} turn={turn} />)
              ) : (
                <div className="grid h-full place-items-center text-center">
                  <div className="space-y-1">
                    <Bot className="mx-auto h-6 w-6 text-[#22d3ee]/60" />
                    <div className="text-[11px] font-bold text-zinc-300">
                      Waiting for live Antigravity session
                    </div>
                    <div className="sub">
                      Restart npm run live on Mac to stream full chat & agent terminal
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!pinnedToBottom && turns.length > 0 && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full border border-[#22d3ee]/50 bg-black/90 px-2.5 py-1 text-[9px] font-bold text-[#22d3ee] shadow-lg"
              >
                <ArrowDown className="h-3 w-3" />
                Latest
              </button>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <AgentTerminalPanel
              runs={terminalRuns}
              selectedId={selectedTermId}
              onSelect={setSelectedTermId}
              onToggleIdeTerminal={toggleIdeTerminal}
            />
          </div>
        )}

        {/* Bottom Prompt & Voice Bar -> Sends directly into Antigravity IDE */}
        <form
          data-no-swipe="true"
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt();
          }}
          className="mt-1.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-1.5"
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={toggleVoice}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition-colors"
            style={{
              background: listening ? '#ff5d6c26' : 'rgba(255,255,255,0.05)',
              borderColor: listening ? '#ff5d6c' : 'rgba(255,255,255,0.1)',
              color: listening ? '#ff5d6c' : '#9ca3af',
            }}
            aria-label="Voice dictate prompt"
          >
            <Mic className={`h-3.5 w-3.5 ${listening ? 'animate-pulse' : ''}`} />
          </motion.button>

          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder={listening ? 'Listening…' : 'Send prompt to Antigravity IDE…'}
            className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/75 px-2.5 text-[10.5px] text-white outline-none placeholder:text-zinc-500 focus:border-[#22d3ee]"
          />

          <motion.button
            type="submit"
            whileTap={{ scale: 0.94 }}
            disabled={!promptText.trim()}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[#22d3ee] px-2.5 text-[10px] font-extrabold text-[#041016] disabled:opacity-35"
          >
            <Send className="h-3 w-3" />
            SEND
          </motion.button>
        </form>
      </div>

      {/* RIGHT: Mission Inspector Sidebar (Agent Terminal / Steps & Diff / Slash / Plan + Accept/Reject) */}
      <div className="tile flex min-h-0 flex-col gap-2 p-2.5">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#fbbf24] via-[#a78bfa] to-[#34d399]" />

        {/* 4-Tab Switcher */}
        <div className="grid grid-cols-4 gap-0.5 rounded-full bg-black/75 p-0.5">
          {(
            [
              { id: 'term', label: 'Term', color: '#fbbf24' },
              { id: 'live', label: 'Diff', color: '#34d399' },
              { id: 'slash', label: 'Slash', color: '#22d3ee' },
              { id: 'plan', label: 'Plan', color: '#a78bfa' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setSideTab(t.id);
              }}
              className="flex items-center justify-center gap-1 truncate rounded-full px-1 py-1 text-[8px] font-extrabold uppercase transition-colors"
              style={{
                background: sideTab === t.id ? '#1f222c' : 'transparent',
                color: sideTab === t.id ? t.color : '#7c8190',
              }}
            >
              {t.id === 'term' && hasRunningTerm && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34d399]" />
              )}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {sideTab === 'term' && (
            <AgentTerminalPanel
              runs={terminalRuns}
              selectedId={selectedTermId}
              onSelect={setSelectedTermId}
              onToggleIdeTerminal={toggleIdeTerminal}
              compact
            />
          )}

          {sideTab === 'live' && (
            <div className="deck-scroll h-full space-y-2 overflow-y-auto pr-0.5">
              {ag.steps.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="sub !text-[8px]">Active Checklist</span>
                    <span className="num font-mono-tech text-[8.5px] text-[#22d3ee]">
                      {ag.steps.filter((s) => s.status === 'done').length}/{ag.steps.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {ag.steps.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-[9.5px]">
                        {s.status === 'done' ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-[#34d399]" />
                        ) : s.status === 'in_progress' ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#22d3ee]" />
                        ) : (
                          <Circle className="h-3 w-3 shrink-0 text-zinc-600" />
                        )}
                        <span
                          className={`truncate ${
                            s.status === 'done' ? 'text-zinc-400 line-through' : 'text-zinc-200'
                          }`}
                        >
                          {s.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-white/[0.06] bg-black/60 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[9px] font-extrabold text-zinc-300 uppercase">
                    <FileDiff className="h-3 w-3 text-[#34d399]" />
                    Live Diff
                  </span>
                  <span className="num font-mono-tech text-[9px] font-extrabold">
                    <span className="text-[#34d399]">+{ag.totalAdded}</span>{' '}
                    <span className="text-[#ff5d6c]">-{ag.totalRemoved}</span>
                  </span>
                </div>
                <div className="space-y-1">
                  {ag.diffFiles.map((f) => (
                    <div
                      key={f.file}
                      className="flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1 text-[9px]"
                    >
                      <span className="font-mono-tech truncate text-zinc-200">{f.file}</span>
                      <span className="num shrink-0 font-bold">
                        <span className="text-[#34d399]">+{f.added}</span>{' '}
                        <span className="text-[#ff5d6c]">-{f.removed}</span>
                      </span>
                    </div>
                  ))}
                  {ag.diffFiles.length === 0 && (
                    <div className="sub py-3 text-center">Working tree clean</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {sideTab === 'slash' && (
            <div className="deck-scroll h-full space-y-2 overflow-y-auto pr-0.5">
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[#a78bfa]" />
                <span className="sub !text-[8.5px]">One-Tap IDE Slash (⌘L)</span>
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
                    className="rounded-xl border border-white/[0.07] bg-white/[0.04] px-2 py-1.5 text-left hover:border-white/25"
                  >
                    <div
                      className="font-mono-tech truncate text-[10.5px] font-extrabold"
                      style={{ color: item.color }}
                    >
                      {item.cmd}
                    </div>
                    <div className="truncate text-[8.5px] text-[#7c8190]">{item.desc}</div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {sideTab === 'plan' && (
            <div className="deck-scroll h-full space-y-1 overflow-y-auto pr-0.5">
              <div className="flex items-center justify-between">
                <span className="sub !text-[8.5px]">Active Artifact</span>
                <span className="font-mono-tech truncate text-[8.5px] text-[#a78bfa]">
                  {ag.artifactName || 'none'}
                </span>
              </div>
              <div className="font-mono-tech rounded-xl border border-white/[0.06] bg-black/75 p-2 text-[9px] leading-relaxed whitespace-pre-wrap text-zinc-200">
                {ag.artifactPreview || 'No implementation_plan.md or task.md in active conversation.'}
              </div>
            </div>
          )}
        </div>

        {/* Pinned Bottom Accept / Reject Controls */}
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
            className="flex items-center justify-center gap-1 rounded-xl border border-[#ff5d6c]/40 bg-[#ff5d6c]/15 py-2 text-[9.5px] font-extrabold text-[#ff5d6c]"
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
            className="flex items-center justify-center gap-1 rounded-xl bg-[#34d399] py-2 text-[9.5px] font-extrabold text-[#04130c]"
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
