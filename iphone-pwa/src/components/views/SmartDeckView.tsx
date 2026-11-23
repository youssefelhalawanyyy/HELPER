'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  Check,
  GitBranch,
  Mic,
  Play,
  Plus,
  RotateCcw,
  Square,
  Terminal,
  Wand2,
} from 'lucide-react';
import { HardwareDialog } from '@/components/shell/HardwareDialog';
import { Burst, DECK_SPRING, HardwareTile } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { MacroActionType, MacroButton, ProfileId } from '@/types/protocol';

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

export function SmartDeckView({
  deck,
  antigravityPinned,
  onNavigateToMonitor,
}: {
  deck: DevDeckState;
  antigravityPinned: boolean;
  onNavigateToMonitor?: () => void;
}) {
  // Run Dev / Stream timer state
  const [runTimer, setRunTimer] = useState(0);
  const [localRunDemo, setLocalRunDemo] = useState(false);
  const isStreaming = deck.logStatus.running || localRunDemo;

  // Git Pull animation state
  const [gitAnim, setGitAnim] = useState<'idle' | 'pull' | 'done'>('idle');

  // Format / Accept animation state
  const [fmtAnim, setFmtAnim] = useState<'idle' | 'run' | 'done'>('idle');

  // Voice AI waveform & speech state
  const [voiceOn, setVoiceOn] = useState(false);
  const [waveTick, setWaveTick] = useState(0);
  const [transcript, setTranscript] = useState('');
  const voiceRecRef = useRef<SpeechRecLike | null>(null);
  const latestTextRef = useRef('');

  // Ports kill burst animation
  const [burstPort, setBurstPort] = useState<number | null>(null);
  const [demoKilled, setDemoKilled] = useState<Record<number, boolean>>({});

  // Custom Macro Modal
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      setRunTimer(0);
      return;
    }
    const id = window.setInterval(() => setRunTimer((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    if (!voiceOn) return;
    const id = window.setInterval(() => setWaveTick(Date.now()), 85);
    return () => window.clearInterval(id);
  }, [voiceOn]);

  const handleRunDev = () => {
    if (deck.status === 'connected') {
      if (deck.logStatus.running) {
        deck.sendEvent({ type: 'logs:stop', payload: { requestId: makeRequestId() } });
      } else {
        const presetId = deck.config?.logPresets?.[0]?.id || 'preset-typecheck';
        deck.sendEvent({
          type: 'logs:start',
          payload: { requestId: makeRequestId(), presetId },
        });
        deck.triggerFlash('success', 'Streaming project command');
      }
    } else {
      setLocalRunDemo((v) => !v);
      if (!localRunDemo) deck.triggerFlash('success', 'Dev server running');
    }
  };

  const handleGitPull = () => {
    if (gitAnim === 'pull') return;
    setGitAnim('pull');
    if (deck.status === 'connected') {
      deck.sendEvent({
        type: 'macro:execute',
        payload: {
          requestId: makeRequestId(),
          macroId: antigravityPinned ? 'ag-agent-chat' : 'vscode-git-pull',
        },
      });
    }
    window.setTimeout(() => {
      setGitAnim('done');
      deck.triggerFlash('success', antigravityPinned ? 'Antigravity Chat Focused' : 'Git Pull Complete');
      window.setTimeout(() => setGitAnim('idle'), 2000);
    }, 950);
  };

  const handleFormatOrAccept = () => {
    if (fmtAnim === 'run') return;
    setFmtAnim('run');
    if (deck.status === 'connected') {
      deck.sendEvent({
        type: 'macro:execute',
        payload: {
          requestId: makeRequestId(),
          macroId: antigravityPinned ? 'ag-accept-changes' : 'vscode-format',
        },
      });
    }
    window.setTimeout(() => {
      setFmtAnim('done');
      deck.triggerFlash('success', antigravityPinned ? 'Accepted Antigravity Diff (⌘↵)' : 'Formatted Document');
      window.setTimeout(() => setFmtAnim('idle'), 1800);
    }, 850);
  };

  const toggleVoice = () => {
    if (voiceOn) {
      voiceRecRef.current?.stop();
      setVoiceOn(false);
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecLike;
      webkitSpeechRecognition?: new () => SpeechRecLike;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    setVoiceOn(true);
    setTranscript('');
    latestTextRef.current = '';

    if (!SpeechRec) {
      setTranscript('Listening… (Web Speech supported on iOS Safari / Chrome)');
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let text = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        text += ev.results[i][0].transcript;
      }
      latestTextRef.current = text.trim();
      setTranscript(text.trim());
    };
    rec.onerror = () => setVoiceOn(false);
    rec.onend = () => {
      setVoiceOn(false);
      if (latestTextRef.current && deck.status === 'connected') {
        deck.sendEvent({
          type: 'voice:transcript',
          payload: {
            requestId: makeRequestId(),
            text: latestTextRef.current,
            autoPaste: true,
          },
        });
        soundEngine.playSuccessChime();
      }
    };
    voiceRecRef.current = rec;
    rec.start();
  };

  // Real ports when connected, graceful preview ports when unpaired
  const displayedPorts =
    deck.ports.length > 0
      ? deck.ports.slice(0, 3)
      : [
          { port: 3000, pid: 1001, process: 'next-server', address: '*:3000' },
          { port: 4747, pid: 1002, process: 'mac-bridge', address: '*:4747' },
        ];

  const handleKillPort = (port: number, pid: number) => {
    soundEngine.playErrorThud();
    setBurstPort(port);
    deck.triggerFlash('error', `Killed :${port}`);
    if (deck.status === 'connected' && deck.ports.length > 0) {
      deck.sendEvent({
        type: 'port:kill',
        payload: { requestId: makeRequestId(), pid, port },
      });
    } else {
      setDemoKilled((d) => ({ ...d, [port]: true }));
    }
    window.setTimeout(() => setBurstPort(null), 650);
  };

  const handleSaveMacro = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMacro || !editingMacro.label.trim() || !editingMacro.payload.trim()) return;
    soundEngine.playSuccessChime();
    deck.sendEvent({
      type: 'macro:upsert',
      payload: { requestId: makeRequestId(), macro: editingMacro },
    });
    setEditingMacro(null);
  };

  const mins = Math.floor(runTimer / 600);
  const secs = Math.floor(runTimer / 10) % 60;
  const codeBarWidths = fmtAnim === 'idle' ? [70, 38, 86, 52] : [62, 62, 62, 62];
  const aliveCount = displayedPorts.filter((p) => !demoKilled[p.port]).length;

  return (
    <div
      className="grid h-full gap-2"
      style={{ gridTemplateColumns: '1fr 1fr 205px', gridTemplateRows: '1fr 1fr' }}
    >
      {/* Tile 1: Run Dev / Stream */}
      <HardwareTile
        accent="#34d399"
        title={antigravityPinned ? 'Run\nCheck' : 'Run\nDev'}
        icon={isStreaming ? <Square className="h-[20px] w-[20px]" /> : <Play className="h-[22px] w-[22px]" />}
        active={isStreaming}
        onClick={handleRunDev}
        sub={isStreaming ? 'Running · tap to stop' : 'Start background stream'}
      >
        {isStreaming && (
          <div className="w-full">
            <div className="num text-[22px] font-extrabold text-[#34d399]">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              <span className="text-[12px] opacity-60">.{runTimer % 10}</span>
            </div>
            <div className="relative mt-1 h-1 w-4/5 overflow-hidden rounded-full bg-white/10">
              <div className="anim-sweep absolute inset-y-0 w-1/3 rounded-full bg-[#34d399]" />
            </div>
          </div>
        )}
      </HardwareTile>

      {/* Tile 2: Git Pull / Antigravity Agent Chat */}
      <HardwareTile
        accent="#22d3ee"
        title={antigravityPinned ? 'Agent\nChat' : 'Git\nPull'}
        icon={
          gitAnim === 'done' ? (
            <Check className="h-[22px] w-[22px]" />
          ) : antigravityPinned ? (
            <Bot className="h-[22px] w-[22px]" />
          ) : (
            <GitBranch className="h-[22px] w-[22px]" />
          )
        }
        active={gitAnim !== 'idle'}
        onClick={handleGitPull}
        sub={
          antigravityPinned
            ? '⌘L · Focus Antigravity'
            : gitAnim === 'pull'
              ? 'Fetching origin…'
              : gitAnim === 'done'
                ? 'Up to date'
                : 'Fetch latest'
        }
      >
        <div className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-bold text-[#22d3ee]">
          <GitBranch className="h-[11px] w-[11px]" />
          <span>{deck.gitStatus.branch || 'main'}</span>
          {gitAnim === 'pull' && (
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-[#22d3ee]"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.6 }}
            />
          )}
        </div>
      </HardwareTile>

      {/* Right Column (Spans 2 Rows): Active Ports + Mini Equalizer */}
      <div
        className="tile flex h-full flex-col gap-2 p-3"
        style={{ gridRow: '1 / span 2', gridColumn: 3 }}
      >
        <div className="flex items-center">
          <span className="sub">Active ports</span>
          <span className="num ml-1.5 rounded-full bg-white/10 px-1.5 text-[10px] font-bold">
            {aliveCount}
          </span>
          <motion.button
            type="button"
            whileTap={{ rotate: -180, scale: 0.85 }}
            aria-label="Refresh ports"
            onClick={() => {
              soundEngine.playClick();
              setDemoKilled({});
              if (deck.status === 'connected') {
                deck.sendEvent({ type: 'ports:refresh', payload: { requestId: makeRequestId() } });
              }
            }}
            className="ml-auto text-[#7c8190] hover:text-white"
          >
            <RotateCcw className="h-[13px] w-[13px]" />
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.85 }}
            aria-label="Add custom macro"
            onClick={() => {
              soundEngine.playClick();
              setEditingMacro({
                id: `macro-${Date.now().toString(36)}`,
                profileId: antigravityPinned ? 'antigravity' : 'vscode',
                label: '',
                sublabel: '',
                icon: 'Terminal',
                color: 'cyan',
                actionType: 'terminal',
                payload: '',
              });
            }}
            className="ml-1.5 text-[#22d3ee] hover:text-white"
          >
            <Plus className="h-[14px] w-[14px]" />
          </motion.button>
        </div>

        <div className="flex flex-col gap-1.5">
          {displayedPorts.slice(0, 2).map((p) => {
            const killed = Boolean(demoKilled[p.port]);
            return (
              <div key={`${p.port}-${p.pid}`} className="relative h-[40px]">
                <AnimatePresence>
                  {!killed ? (
                    <motion.div
                      key="row"
                      exit={{ opacity: 0, scale: 0.7, x: -14, rotate: -4, filter: 'brightness(2.2)' }}
                      transition={{ duration: 0.28 }}
                      className="flex h-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.045] pr-1.5 pl-2.5"
                    >
                      <span className="relative h-1.5 w-1.5 shrink-0">
                        <i className="anim-ping absolute inset-0 rounded-full bg-[#34d399]" />
                        <i className="absolute inset-0 rounded-full bg-[#34d399]" />
                      </span>
                      <span className="num flex-1 truncate text-[12px] font-semibold">
                        localhost:{p.port}
                      </span>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.88 }}
                        whileHover={{ scale: 1.06 }}
                        transition={DECK_SPRING}
                        onClick={() => handleKillPort(p.port, p.pid)}
                        aria-label={`Kill port ${p.port}`}
                        className="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white"
                        style={{ background: '#e5484d', boxShadow: '0 2px 0 #7a1d20' }}
                      >
                        KILL
                      </motion.button>
                    </motion.div>
                  ) : (
                    <div className="sub grid h-full place-items-center rounded-xl border border-dashed border-white/10">
                      Port {p.port} freed
                    </div>
                  )}
                </AnimatePresence>
                {burstPort === p.port && <Burst key={`b-${p.port}`} color="#ff5d6c" />}
              </div>
            );
          })}
        </div>

        {/* Live Mini Activity Window */}
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            onNavigateToMonitor?.();
          }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-black/50 text-left"
        >
          <div className="flex h-4 items-center gap-1 bg-white/[0.05] px-2">
            <i className="h-1 w-1 rounded-full bg-[#ff5d6c]" />
            <i className="h-1 w-1 rounded-full bg-[#fbbf24]" />
            <i className="h-1 w-1 rounded-full bg-[#34d399]" />
            <span className="ml-1 truncate text-[8px] text-[#7c8190]">
              {deck.activeApp.appName || 'localhost:3000'}
            </span>
          </div>
          <div className="flex-1 p-2">
            {aliveCount > 0 ? (
              <div className="flex h-full items-end gap-1">
                {['#34d399', '#22d3ee', '#a78bfa', '#60a5fa', '#34d399'].map((c, i) => (
                  <motion.div
                    key={i}
                    className="flex-1 rounded-t"
                    style={{ background: c, opacity: 0.85 }}
                    animate={{ height: ['30%', '90%', '50%'] }}
                    transition={{
                      repeat: Infinity,
                      repeatType: 'reverse',
                      duration: 1.1 + i * 0.2,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-center text-[9px] leading-tight font-semibold text-[#ff5d6c]">
                Can&apos;t reach
                <br />
                localhost:3000
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Tile 3: Format / Accept Diff */}
      <HardwareTile
        accent="#a78bfa"
        title={antigravityPinned ? 'Accept\nDiff' : 'Format'}
        icon={fmtAnim === 'done' ? <Check className="h-[22px] w-[22px]" /> : <Wand2 className="h-[22px] w-[22px]" />}
        active={fmtAnim !== 'idle'}
        onClick={handleFormatOrAccept}
        sub={
          antigravityPinned
            ? '⌘↵ · Accept Changes'
            : fmtAnim === 'run'
              ? 'Prettier + lint…'
              : fmtAnim === 'done'
                ? 'Formatted cleanly'
                : 'Prettier & lint'
        }
      >
        <div className="flex w-3/4 flex-col gap-1.5">
          {codeBarWidths.map((w, i) => (
            <motion.div
              key={i}
              className="relative h-1.5 overflow-hidden rounded-full"
              style={{ background: 'rgba(167,139,250,.35)' }}
              animate={{ width: `${w}%` }}
              transition={{ ...DECK_SPRING, delay: i * 0.07 }}
            >
              {fmtAnim === 'run' && (
                <div className="anim-sweep absolute inset-y-0 w-1/2 bg-white/60" />
              )}
            </motion.div>
          ))}
        </div>
      </HardwareTile>

      {/* Tile 4: Voice AI (30-bar live waveform) */}
      <HardwareTile
        accent="#60a5fa"
        title={'Voice\nAI'}
        icon={<Mic className="h-[22px] w-[22px]" />}
        active={voiceOn}
        onClick={toggleVoice}
        sub={voiceOn ? 'Listening · tap to paste on Mac' : 'Voice prompts · auto-paste'}
      >
        <div className="w-full">
          <div className="flex h-7 items-center gap-[2.5px]">
            {Array.from({ length: 30 }).map((_, i) => {
              const h = voiceOn
                ? 4 +
                  Math.abs(Math.sin(waveTick / 130 + i * 0.55)) *
                    Math.abs(Math.sin(waveTick / 330 + i * 0.2)) *
                    22
                : 3;
              return (
                <motion.i
                  key={i}
                  className="w-[3px] rounded-full"
                  animate={{ height: h }}
                  transition={{ duration: 0.08 }}
                  style={{
                    background: voiceOn ? `hsl(${215 + i * 2}, 90%, 62%)` : '#3a3e4b',
                  }}
                />
              );
            })}
          </div>
          {voiceOn && (
            <div className="mt-1 truncate text-[10px] font-medium text-[#9fc2ff]">
              “{transcript || 'Speak your prompt…'}”
            </div>
          )}
        </div>
      </HardwareTile>

      {/* Custom Macro Editor Dialog */}
      <HardwareDialog
        open={Boolean(editingMacro)}
        title="Add Custom Macro"
        onClose={() => setEditingMacro(null)}
      >
        {editingMacro && (
          <form onSubmit={handleSaveMacro} className="grid grid-cols-12 gap-3">
            <label className="col-span-6 flex flex-col gap-1">
              <span className="sub">Label</span>
              <input
                type="text"
                required
                autoFocus
                value={editingMacro.label}
                onChange={(e) => setEditingMacro({ ...editingMacro, label: e.target.value })}
                placeholder="Mac Terminal Cmd"
                className="rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#22d3ee]"
              />
            </label>
            <label className="col-span-6 flex flex-col gap-1">
              <span className="sub">Action Type</span>
              <select
                value={editingMacro.actionType}
                onChange={(e) =>
                  setEditingMacro({
                    ...editingMacro,
                    actionType: e.target.value as MacroActionType,
                  })
                }
                className="rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#22d3ee]"
              >
                <option value="terminal">Active Mac Terminal</option>
                <option value="shell">Background Shell</option>
                <option value="stream">Stream in PWA Logs</option>
                <option value="shortcut">macOS Shortcut</option>
              </select>
            </label>
            <label className="col-span-6 flex flex-col gap-1">
              <span className="sub">Profile</span>
              <select
                value={editingMacro.profileId}
                onChange={(e) =>
                  setEditingMacro({ ...editingMacro, profileId: e.target.value as ProfileId })
                }
                className="rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#22d3ee]"
              >
                <option value="antigravity">Antigravity</option>
                <option value="vscode">VS Code</option>
                <option value="terminal">Terminal</option>
                <option value="chrome">Browser</option>
                <option value="general">General</option>
              </select>
            </label>
            <label className="col-span-6 flex flex-col gap-1">
              <span className="sub">Command / Payload</span>
              <input
                type="text"
                required
                value={editingMacro.payload}
                onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                placeholder="npm run dev"
                className="font-mono-tech rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-[#22d3ee] outline-none focus:border-[#22d3ee]"
              />
            </label>
            <div className="col-span-12 flex justify-end pt-1">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full bg-[#34d399] px-4 py-1.5 text-xs font-extrabold text-[#04130c]"
              >
                <Terminal className="h-3.5 w-3.5" />
                Save Macro
              </button>
            </div>
          </form>
        )}
      </HardwareDialog>
    </div>
  );
}
