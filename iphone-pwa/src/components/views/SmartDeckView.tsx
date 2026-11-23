'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AppWindow,
  Bot,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Code2,
  Command,
  Copy,
  Cpu,
  Edit3,
  Eraser,
  GitBranch,
  GitPullRequest,
  Link2,
  Lock,
  Mic,
  OctagonX,
  PanelLeft,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Terminal,
  TerminalSquare,
  Trash2,
  VolumeX,
  Wand2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { HardwareDialog } from '@/components/shell/HardwareDialog';
import { Burst, DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { MacroActionType, MacroButton, ProfileId } from '@/types/protocol';

/* -------------------------------------------------------------------------- */
/*  Tokens                                                                    */
/* -------------------------------------------------------------------------- */

const ICON_MAP: Record<string, typeof Zap> = {
  Bot,
  CheckCircle2,
  XCircle,
  Mic,
  Sparkles,
  Radio,
  Activity,
  Send,
  Wand2,
  Terminal,
  Command,
  GitPullRequest,
  Save,
  Play,
  Search,
  PanelLeft,
  RefreshCw,
  Code2,
  Smartphone,
  Plus,
  X,
  TerminalSquare,
  Eraser,
  OctagonX,
  GitBranch,
  RotateCcw,
  Cpu,
  Camera,
  Copy,
  ClipboardPaste,
  VolumeX,
  Lock,
  Zap,
};

const ACCENT_HEX: Record<MacroButton['color'], string> = {
  emerald: '#34d399',
  crimson: '#ff5d6c',
  amber: '#fbbf24',
  cyan: '#22d3ee',
  violet: '#a78bfa',
  slate: '#9ca3af',
};

const COLOR_ORDER: MacroButton['color'][] = ['cyan', 'emerald', 'amber', 'crimson', 'violet', 'slate'];

const SHORTCUT_OPTIONS = [
  'antigravity.agentChat',
  'antigravity.acceptChanges',
  'antigravity.rejectChanges',
  'antigravity.toggleTerminal',
  'antigravity.newAgent',
  'antigravity.commandPalette',
  'vscode.format',
  'vscode.toggleTerminal',
  'vscode.commandPalette',
  'vscode.saveAll',
  'vscode.quickOpen',
  'vscode.toggleSidebar',
  'chrome.hardReload',
  'chrome.devTools',
  'chrome.responsiveToggle',
  'chrome.newTab',
  'chrome.closeTab',
  'chrome.console',
  'terminal.clear',
  'terminal.killProcess',
  'terminal.newTab',
  'terminal.repeatLast',
  'system.screenshotSelection',
  'system.spotlight',
  'system.copy',
  'system.paste',
  'system.toggleMute',
  'system.lockScreen',
];

const ACTION_META: Record<string, { label: string; icon: typeof Zap; hint: string }> = {
  shell: { label: 'Shell', icon: Terminal, hint: 'Runs silently in the background on your Mac.' },
  terminal: { label: 'Terminal', icon: TerminalSquare, hint: 'Types the command into your active terminal.' },
  stream: { label: 'Stream', icon: Activity, hint: 'Runs a log preset and streams output here.' },
  shortcut: { label: 'Shortcut', icon: Command, hint: 'Sends a keyboard shortcut to the frontmost app.' },
  voice: { label: 'Voice', icon: Mic, hint: 'Dictate a prompt and send it to your Mac.' },
  snippet: { label: 'Snippet', icon: ClipboardPaste, hint: 'Pastes this text wherever your cursor is.' },
};

const ACTION_ORDER: MacroActionType[] = [
  'shell',
  'terminal',
  'stream',
  'shortcut',
  'voice',
  'snippet',
];

const SURFACE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.012))',
  border: '1px solid rgba(255,255,255,.065)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)',
};

const FIELD =
  'rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-white outline-none transition-colors focus:border-[#22d3ee]';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee]/70';

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

/* -------------------------------------------------------------------------- */
/*  Keycap face (shared by the grid and the editor preview)                   */
/* -------------------------------------------------------------------------- */

function keycapStyle(accent: string, mode: 'idle' | 'voice' | 'edit'): CSSProperties {
  return {
    background: `radial-gradient(120% 90% at 0% 0%, ${accent}${mode === 'voice' ? '2e' : '16'}, transparent 62%), linear-gradient(180deg, #191b23 0%, #0f1117 100%)`,
    border: `1px solid ${mode === 'voice' ? accent : mode === 'edit' ? '#a78bfa88' : 'rgba(255,255,255,.08)'}`,
    borderStyle: mode === 'edit' ? 'dashed' : 'solid',
    boxShadow:
      mode === 'voice'
        ? `0 0 0 1px ${accent}55, 0 0 28px -6px ${accent}aa, inset 0 1px 0 rgba(255,255,255,.07)`
        : 'inset 0 1px 0 rgba(255,255,255,.07), 0 3px 0 #05060a, 0 8px 18px -8px rgba(0,0,0,.8)',
  };
}

function KeycapFace({
  label,
  sublabel,
  Icon,
  accent,
  voice,
  transcript,
  waveTick,
}: {
  label: string;
  sublabel: string;
  Icon: typeof Zap;
  accent: string;
  voice?: boolean;
  transcript?: string;
  waveTick?: number;
}) {
  return (
    <>
      {/* status LED */}
      <span
        className="absolute top-3 left-3 h-1.5 w-1.5 rounded-full"
        style={{ background: accent, boxShadow: `0 0 8px 1px ${accent}` }}
      />

      <div className="flex w-full items-start justify-end">
        <span
          className="grid h-8 w-8 place-items-center rounded-[10px]"
          style={{
            background: `${accent}1c`,
            boxShadow: `inset 0 0 0 1px ${accent}33`,
          }}
        >
          <Icon className={`h-4 w-4 ${voice ? 'animate-pulse' : ''}`} style={{ color: accent }} />
        </span>
      </div>

      {voice && (
        <div className="pointer-events-none absolute inset-x-3 top-[34%] flex h-6 items-center justify-center gap-[3px]">
          {Array.from({ length: 18 }).map((_, i) => (
            <i
              key={i}
              className="w-[2.5px] rounded-full"
              style={{
                background: accent,
                height: 4 + Math.abs(Math.sin((waveTick ?? 0) / 120 + i * 0.6)) * 18,
                opacity: 0.55 + (i % 3) * 0.15,
              }}
            />
          ))}
        </div>
      )}

      <div className="w-full text-left">
        <div className="disp line-clamp-2 text-[17px] leading-[1.05] text-[#f2f3f7]">
          {voice ? 'Listening' : label || 'Untitled'}
        </div>
        <div
          className="font-mono-tech mt-1 truncate text-[9.5px]"
          style={{ color: voice ? accent : '#7c8190' }}
        >
          {voice ? transcript || 'Tap again to send' : sublabel}
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  View                                                                      */
/* -------------------------------------------------------------------------- */

export function SmartDeckView({
  deck,
  antigravityPinned,
  onNavigateToMonitor,
  onOpenPairing,
}: {
  deck: DevDeckState;
  antigravityPinned: boolean;
  onNavigateToMonitor?: () => void;
  onOpenPairing?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualProfile, setManualProfile] = useState<ProfileId>('antigravity');
  const [editMode, setEditMode] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [burstPort, setBurstPort] = useState<number | null>(null);
  const [voiceActiveId, setVoiceActiveId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [waveTick, setWaveTick] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const voiceRecRef = useRef<SpeechRecLike | null>(null);
  const latestTextRef = useRef('');

  useEffect(() => {
    if (!voiceActiveId) return;
    const id = window.setInterval(() => setWaveTick(Date.now()), 85);
    return () => window.clearInterval(id);
  }, [voiceActiveId]);

  const isConnected = deck.status === 'connected';
  const profiles = deck.config?.profiles ?? [
    { id: 'antigravity', name: 'Antigravity', matchApps: [], accent: 'cyan' },
    { id: 'vscode', name: 'VS Code', matchApps: [], accent: 'violet' },
    { id: 'chrome', name: 'Browser', matchApps: [], accent: 'amber' },
    { id: 'terminal', name: 'Terminal', matchApps: [], accent: 'emerald' },
    { id: 'general', name: 'General', matchApps: [], accent: 'violet' },
  ];

  const activeProfileId: ProfileId = antigravityPinned
    ? 'antigravity'
    : autoSwitch
      ? deck.activeApp.profileId
      : manualProfile;

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileAccent =
    ACCENT_HEX[(activeProfile?.accent ?? 'cyan') as MacroButton['color']] ?? '#22d3ee';

  const visibleMacros = useMemo(() => {
    return (deck.config?.macros ?? []).filter((m) => m.profileId === activeProfileId);
  }, [deck.config?.macros, activeProfileId]);

  const logPresets = deck.config?.logPresets ?? [];

  /* ------------------------------ handlers -------------------------------- */

  const toggleVoice = (macro: MacroButton) => {
    if (voiceActiveId === macro.id) {
      voiceRecRef.current?.stop();
      setVoiceActiveId(null);
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecLike;
      webkitSpeechRecognition?: new () => SpeechRecLike;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) {
      deck.showToast(false, 'Web Speech API unavailable in this browser');
      return;
    }

    latestTextRef.current = '';
    setLiveTranscript('');
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
      setLiveTranscript(text.trim());
    };
    rec.onerror = () => setVoiceActiveId(null);
    rec.onend = () => {
      setVoiceActiveId(null);
      if (latestTextRef.current) {
        deck.sendEvent({
          type: 'voice:transcript',
          payload: {
            requestId: makeRequestId(),
            text: latestTextRef.current,
            autoPaste: macro.payload !== 'copyOnly',
          },
        });
        soundEngine.playSuccessChime();
      }
    };
    voiceRecRef.current = rec;
    setVoiceActiveId(macro.id);
    rec.start();
  };

  const handlePressMacro = (macro: MacroButton) => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Pair your Mac first to execute macros');
      onOpenPairing?.();
      return;
    }
    if (editMode) {
      setEditingMacro({ ...macro });
      return;
    }
    if (macro.actionType === 'voice') {
      toggleVoice(macro);
      return;
    }
    setFlashId(macro.id);
    window.setTimeout(() => setFlashId((cur) => (cur === macro.id ? null : cur)), 480);
    deck.sendEvent({
      type: 'macro:execute',
      payload: { requestId: makeRequestId(), macroId: macro.id },
    });
    if (macro.actionType === 'stream' && onNavigateToMonitor) {
      onNavigateToMonitor();
    }
  };

  const handleKillPort = (port: number, pid: number) => {
    if (!isConnected) return;
    soundEngine.playErrorThud();
    setBurstPort(port);
    deck.sendEvent({
      type: 'port:kill',
      payload: { requestId: makeRequestId(), pid, port },
    });
    window.setTimeout(() => setBurstPort(null), 650);
  };

  const openNewMacro = () => {
    soundEngine.playClick();
    if (!isConnected) {
      onOpenPairing?.();
      return;
    }
    setEditingMacro({
      id: `macro-${Date.now().toString(36)}`,
      profileId: activeProfileId,
      label: '',
      sublabel: '',
      icon: 'Zap',
      color: 'cyan',
      actionType: 'shell',
      payload: '',
    });
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

  const handleDeleteMacro = (macroId: string) => {
    soundEngine.playErrorThud();
    deck.sendEvent({
      type: 'macro:delete',
      payload: { requestId: makeRequestId(), macroId },
    });
    setEditingMacro(null);
  };

  const changeActionType = (nextType: MacroActionType) => {
    if (!editingMacro) return;
    soundEngine.playClick();
    setEditingMacro({
      ...editingMacro,
      actionType: nextType,
      payload:
        nextType === 'shortcut'
          ? SHORTCUT_OPTIONS[0]
          : nextType === 'stream'
            ? logPresets[0]?.id || 'preset-typecheck'
            : nextType === 'voice'
              ? 'autoPaste'
              : '',
    });
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="grid h-full gap-2.5" style={{ gridTemplateColumns: '1fr 212px' }}>
      {/* ============================ LEFT: keys ============================ */}
      <div className="flex min-h-0 flex-col gap-2.5">
        {/* Profile rail */}
        <div className="flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Profiles"
            className="deck-scroll relative flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full p-[3px]"
            style={{ background: 'rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,.06)' }}
          >
            {profiles.map((prof) => {
              const selected = prof.id === activeProfileId;
              const tint = ACCENT_HEX[prof.accent as MacroButton['color']] ?? '#22d3ee';
              return (
                <button
                  key={prof.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    soundEngine.playClick();
                    setAutoSwitch(false);
                    setManualProfile(prof.id);
                  }}
                  className={`relative shrink-0 rounded-full px-3 py-1 text-[10.5px] font-bold tracking-wide transition-colors ${FOCUS}`}
                  style={{ color: selected ? '#06080c' : '#8b90a0' }}
                >
                  {selected && (
                    <motion.span
                      layoutId="profile-pill"
                      transition={DECK_SPRING}
                      className="absolute inset-0 rounded-full"
                      style={{ background: tint, boxShadow: `0 0 16px -2px ${tint}99` }}
                    />
                  )}
                  <span className="relative">{prof.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-pressed={autoSwitch}
              onClick={() => {
                soundEngine.playClick();
                setAutoSwitch((v) => !v);
              }}
              className={`flex items-center gap-1 rounded-full py-1 pr-2.5 pl-2 text-[10px] font-bold ${FOCUS}`}
              style={{
                background: autoSwitch ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.12)',
                color: autoSwitch ? '#34d399' : '#fbbf24',
                border: `1px solid ${autoSwitch ? 'rgba(52,211,153,.28)' : 'rgba(251,191,36,.28)'}`,
              }}
            >
              {autoSwitch ? <Radio className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {autoSwitch ? 'Follows app' : 'Locked'}
            </button>

            <button
              type="button"
              aria-label="Edit macros"
              aria-pressed={editMode}
              onClick={() => {
                soundEngine.playClick();
                setEditMode((v) => !v);
              }}
              className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${FOCUS}`}
              style={{
                background: editMode ? '#a78bfa' : 'rgba(255,255,255,.07)',
                color: editMode ? '#090612' : '#9ca3af',
              }}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              aria-label="Add macro"
              onClick={openNewMacro}
              className={`grid h-7 w-7 place-items-center rounded-full bg-[#34d399] text-[#04130c] transition-transform active:scale-90 ${FOCUS}`}
              style={{ boxShadow: '0 2px 0 #14664a' }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Edit-mode banner */}
        <AnimatePresence initial={false}>
          {editMode && isConnected && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[10.5px] font-semibold text-[#c4b5fd]"
                style={{ background: 'rgba(167,139,250,.1)', border: '1px solid rgba(167,139,250,.25)' }}
              >
                <Edit3 className="h-3 w-3" />
                Tap a key to edit it. Tap the pencil again when you are done.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Key grid / empty / disconnected */}
        {!isConnected ? (
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl" style={SURFACE}>
            {/* ghost keys */}
            <div className="absolute inset-0 grid grid-cols-4 gap-2.5 p-3 opacity-[0.35] blur-[1.5px]" aria-hidden>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-[18px]"
                  style={{ ...keycapStyle(ACCENT_HEX[COLOR_ORDER[i % 6]], 'idle'), minHeight: 92 }}
                />
              ))}
            </div>
            <div
              className="absolute inset-0"
              style={{ background: 'radial-gradient(70% 70% at 50% 50%, rgba(8,9,13,.92), rgba(8,9,13,.6))' }}
            />
            <div className="relative flex max-w-[360px] flex-col items-center gap-2.5 p-6 text-center">
              <span
                className="grid h-11 w-11 place-items-center rounded-2xl"
                style={{ background: 'rgba(34,211,238,.1)', boxShadow: 'inset 0 0 0 1px rgba(34,211,238,.3)' }}
              >
                <Link2 className="h-5 w-5 text-[#22d3ee]" />
              </span>
              <div className="disp text-[26px] leading-none text-[#f2f3f7]">Mac not linked</div>
              <p className="text-[11px] leading-relaxed text-[#8b90a0]">
                Pair with your Mac to load app profiles, run shortcuts, stream terminal logs and
                stop dev servers from here.
              </p>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={onOpenPairing}
                className={`mt-1 flex items-center gap-1.5 rounded-full bg-[#34d399] px-4 py-2 text-[11px] font-extrabold text-[#04130c] ${FOCUS}`}
                style={{ boxShadow: '0 3px 0 #14664a' }}
              >
                <Link2 className="h-3.5 w-3.5" />
                Pair Mac
              </motion.button>
            </div>
          </div>
        ) : visibleMacros.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl p-6 text-center" style={{ ...SURFACE, borderStyle: 'dashed' }}>
            <div className="disp text-[22px] text-[#f2f3f7]">No keys for {activeProfile?.name ?? 'this profile'}</div>
            <p className="max-w-[300px] text-[11px] text-[#8b90a0]">
              Add a macro and it will appear here whenever this profile is active.
            </p>
            <button
              type="button"
              onClick={openNewMacro}
              className={`mt-1 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-extrabold ${FOCUS}`}
              style={{ background: profileAccent, color: '#06080c', boxShadow: `0 3px 0 ${profileAccent}66` }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add macro
            </button>
          </div>
        ) : (
          <div className="deck-scroll grid min-h-0 flex-1 auto-rows-[minmax(100px,1fr)] grid-cols-4 gap-2.5 overflow-y-auto p-0.5 pb-1.5">
            <AnimatePresence mode="popLayout" initial={false}>
              {visibleMacros.map((macro, idx) => {
                const Icon = ICON_MAP[macro.icon] || Zap;
                const accent = ACCENT_HEX[macro.color] || '#22d3ee';
                const isVoiceActive = voiceActiveId === macro.id;
                const mode = isVoiceActive ? 'voice' : editMode ? 'edit' : 'idle';
                return (
                  <motion.button
                    key={`${activeProfileId}-${macro.id}`}
                    type="button"
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={
                      editMode && !reduceMotion
                        ? { opacity: 1, y: 0, scale: 1, rotate: [0, idx % 2 ? 0.7 : -0.7, 0] }
                        : { opacity: 1, y: 0, scale: 1, rotate: 0 }
                    }
                    exit={{ opacity: 0, scale: 0.94 }}
                    whileTap={{ y: 3, scale: 0.975 }}
                    whileHover={{ y: -1.5 }}
                    transition={
                      editMode && !reduceMotion
                        ? { rotate: { repeat: Infinity, duration: 0.42 + (idx % 3) * 0.06 }, default: DECK_SPRING }
                        : DECK_SPRING
                    }
                    onClick={() => handlePressMacro(macro)}
                    aria-label={`${macro.label}${isVoiceActive ? ', listening' : ''}`}
                    className={`relative flex flex-col justify-between overflow-hidden rounded-[18px] p-3 text-left ${FOCUS}`}
                    style={keycapStyle(accent, mode)}
                  >
                    <KeycapFace
                      label={macro.label}
                      sublabel={editMode ? 'Tap to edit' : macro.sublabel || ACTION_META[macro.actionType]?.label || macro.actionType}
                      Icon={Icon}
                      accent={accent}
                      voice={isVoiceActive}
                      transcript={liveTranscript}
                      waveTick={waveTick}
                    />

                    {editMode && (
                      <span className="absolute right-1.5 bottom-1.5 grid h-4 w-4 place-items-center rounded-full bg-[#a78bfa] text-[#090612]">
                        <Edit3 className="h-2.5 w-2.5" />
                      </span>
                    )}

                    {/* press confirmation */}
                    <AnimatePresence>
                      {flashId === macro.id && (
                        <motion.span
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.45 }}
                          className="pointer-events-none absolute inset-0 rounded-[18px]"
                          style={{
                            background: `radial-gradient(circle at 50% 50%, ${accent}55, transparent 70%)`,
                            boxShadow: `inset 0 0 0 1.5px ${accent}`,
                          }}
                        />
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ========================= RIGHT: ports + app ======================== */}
      <aside className="flex h-full min-h-0 flex-col gap-2.5">
        {/* Frontmost app */}
        <div className="relative overflow-hidden rounded-2xl px-3 py-2.5" style={SURFACE}>
          <div
            className="pointer-events-none absolute -top-8 -right-8 h-20 w-20 rounded-full blur-2xl"
            style={{ background: `${profileAccent}33` }}
          />
          <div className="relative flex items-center gap-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]"
              style={{ background: `${profileAccent}1c`, boxShadow: `inset 0 0 0 1px ${profileAccent}33` }}
            >
              <AppWindow className="h-4 w-4" style={{ color: profileAccent }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-bold text-[#f2f3f7]">
                {isConnected ? deck.activeApp.appName : 'Offline'}
              </div>
              <div className="truncate text-[9.5px] text-[#7c8190]">
                {isConnected ? `${activeProfile?.name ?? activeProfileId} profile` : 'Waiting for your Mac'}
              </div>
            </div>
            <span className="relative h-2 w-2 shrink-0">
              {isConnected && (
                <i className="anim-ping absolute inset-0 rounded-full" style={{ background: '#34d399' }} />
              )}
              <i
                className="absolute inset-0 rounded-full"
                style={{ background: isConnected ? '#34d399' : '#4b5060' }}
              />
            </span>
          </div>
        </div>

        {/* Ports */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl p-2.5" style={SURFACE}>
          <div className="flex items-center px-0.5">
            <span className="text-[11px] font-bold text-[#f2f3f7]">Dev ports</span>
            <span className="num ml-1.5 rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-[#c9ccd6]">
              {deck.ports.length}
            </span>
            <motion.button
              type="button"
              whileTap={{ rotate: -180, scale: 0.85 }}
              aria-label="Refresh ports"
              onClick={() => {
                soundEngine.playClick();
                if (isConnected) {
                  deck.sendEvent({ type: 'ports:refresh', payload: { requestId: makeRequestId() } });
                }
              }}
              className={`ml-auto grid h-6 w-6 place-items-center rounded-full text-[#7c8190] hover:bg-white/10 hover:text-white ${FOCUS}`}
            >
              <RotateCcw className="h-3 w-3" />
            </motion.button>
          </div>

          <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            <AnimatePresence initial={false}>
              {deck.ports.map((p) => (
                <motion.div
                  key={`${p.port}-${p.pid}`}
                  layout
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.7, x: -14 }}
                  transition={{ duration: 0.25 }}
                  className="relative flex h-[46px] items-center gap-2 rounded-xl pr-1.5 pl-2.5"
                  style={{
                    background: 'rgba(0,0,0,.35)',
                    border: '1px solid rgba(255,255,255,.06)',
                    boxShadow: 'inset 3px 0 0 #34d399',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="num truncate text-[13px] leading-none font-bold text-[#f2f3f7]">
                      :{p.port}
                    </div>
                    <div className="mt-1 truncate text-[9px] text-[#7c8190]">{p.process}</div>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ y: 2, scale: 0.94 }}
                    onClick={() => handleKillPort(p.port, p.pid)}
                    aria-label={`Stop port ${p.port}`}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold text-white ${FOCUS}`}
                    style={{ background: '#e5484d', boxShadow: '0 2px 0 #7a1d20' }}
                  >
                    Stop
                  </motion.button>
                  {burstPort === p.port && <Burst color="#ff5d6c" />}
                </motion.div>
              ))}
            </AnimatePresence>

            {deck.ports.length === 0 && (
              <div className="grid h-full min-h-[96px] place-items-center rounded-xl border border-dashed border-white/10 p-3 text-center">
                <div>
                  <Activity className="mx-auto mb-1.5 h-4 w-4 text-[#4b5060]" />
                  <div className="text-[10.5px] text-[#7c8190]">
                    {isConnected ? 'No servers listening' : 'Pair your Mac to scan ports'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ============================ Macro editor =========================== */}
      <HardwareDialog
        open={Boolean(editingMacro)}
        title={editingMacro?.label ? `Edit macro — ${editingMacro.label}` : 'New macro'}
        onClose={() => setEditingMacro(null)}
      >
        {editingMacro && (
          <form onSubmit={handleSaveMacro} className="grid grid-cols-12 gap-3">
            {/* Live preview */}
            <div className="col-span-4 flex flex-col gap-1.5">
              <span className="sub">Preview</span>
              <div
                className="relative flex min-h-[112px] flex-1 flex-col justify-between overflow-hidden rounded-[18px] p-3"
                style={keycapStyle(ACCENT_HEX[editingMacro.color] || '#22d3ee', 'idle')}
              >
                <KeycapFace
                  label={editingMacro.label}
                  sublabel={editingMacro.sublabel || ACTION_META[editingMacro.actionType]?.label || ''}
                  Icon={ICON_MAP[editingMacro.icon] || Zap}
                  accent={ACCENT_HEX[editingMacro.color] || '#22d3ee'}
                />
              </div>
              <p className="text-[10px] leading-snug text-[#7c8190]">
                {ACTION_META[editingMacro.actionType]?.hint}
              </p>
            </div>

            {/* Fields */}
            <div className="col-span-8 grid grid-cols-6 gap-2.5">
              <label className="col-span-4 flex flex-col gap-1">
                <span className="sub">Label</span>
                <input
                  type="text"
                  required
                  autoFocus
                  value={editingMacro.label}
                  onChange={(e) => setEditingMacro({ ...editingMacro, label: e.target.value })}
                  placeholder="Run tests"
                  className={FIELD}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="sub">Caption</span>
                <input
                  type="text"
                  value={editingMacro.sublabel || ''}
                  onChange={(e) => setEditingMacro({ ...editingMacro, sublabel: e.target.value })}
                  placeholder="⌘⇧T"
                  className={`font-mono-tech ${FIELD}`}
                />
              </label>

              {/* Action type */}
              <div className="col-span-6 flex flex-col gap-1">
                <span className="sub">Action</span>
                <div className="grid grid-cols-6 gap-1">
                  {ACTION_ORDER.map((type) => {
                    const meta = ACTION_META[type];
                    const Ico = meta.icon;
                    const on = editingMacro.actionType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={on}
                        onClick={() => changeActionType(type)}
                        className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[9.5px] font-bold transition-colors ${FOCUS}`}
                        style={{
                          background: on ? 'rgba(34,211,238,.14)' : 'rgba(255,255,255,.04)',
                          color: on ? '#22d3ee' : '#8b90a0',
                          border: `1px solid ${on ? 'rgba(34,211,238,.4)' : 'rgba(255,255,255,.06)'}`,
                        }}
                      >
                        <Ico className="h-3.5 w-3.5" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payload */}
              <label className="col-span-6 flex flex-col gap-1">
                <span className="sub">
                  {editingMacro.actionType === 'shortcut'
                    ? 'Shortcut'
                    : editingMacro.actionType === 'stream'
                      ? 'Log preset'
                      : editingMacro.actionType === 'voice'
                        ? 'After dictation'
                        : editingMacro.actionType === 'snippet'
                          ? 'Text to paste'
                          : 'Command'}
                </span>
                {editingMacro.actionType === 'shortcut' ? (
                  <select
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    className={`font-mono-tech ${FIELD} text-[#22d3ee]`}
                  >
                    {SHORTCUT_OPTIONS.map((sc) => (
                      <option key={sc} value={sc}>
                        {sc}
                      </option>
                    ))}
                  </select>
                ) : editingMacro.actionType === 'stream' ? (
                  <select
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    className={`font-mono-tech ${FIELD} text-[#22d3ee]`}
                  >
                    {logPresets.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.label}
                      </option>
                    ))}
                  </select>
                ) : editingMacro.actionType === 'voice' ? (
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { id: 'autoPaste', label: 'Paste into app' },
                      { id: 'copyOnly', label: 'Copy only' },
                    ].map((opt) => {
                      const on = editingMacro.payload === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setEditingMacro({ ...editingMacro, payload: opt.id })}
                          className={`rounded-xl py-2 text-[11px] font-bold ${FOCUS}`}
                          style={{
                            background: on ? 'rgba(34,211,238,.14)' : 'rgba(255,255,255,.04)',
                            color: on ? '#22d3ee' : '#8b90a0',
                            border: `1px solid ${on ? 'rgba(34,211,238,.4)' : 'rgba(255,255,255,.06)'}`,
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    type="text"
                    required
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    placeholder={editingMacro.actionType === 'snippet' ? 'Text to insert' : 'npm run dev'}
                    className={`font-mono-tech ${FIELD} text-[#22d3ee]`}
                  />
                )}
              </label>

              {/* Color */}
              <div className="col-span-3 flex flex-col gap-1">
                <span className="sub">Color</span>
                <div className="flex items-center gap-1.5 py-1">
                  {COLOR_ORDER.map((c) => {
                    const on = editingMacro.color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={on}
                        onClick={() => setEditingMacro({ ...editingMacro, color: c })}
                        className={`h-5 w-5 rounded-full transition-transform ${FOCUS}`}
                        style={{
                          background: ACCENT_HEX[c],
                          transform: on ? 'scale(1.15)' : 'scale(1)',
                          boxShadow: on ? `0 0 0 2px #0b0c10, 0 0 0 3.5px ${ACCENT_HEX[c]}` : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Profile */}
              <label className="col-span-3 flex flex-col gap-1">
                <span className="sub">Profile</span>
                <select
                  value={editingMacro.profileId}
                  onChange={(e) =>
                    setEditingMacro({ ...editingMacro, profileId: e.target.value as ProfileId })
                  }
                  className={FIELD}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* Icon picker */}
              <div className="col-span-6 flex flex-col gap-1">
                <span className="sub">Icon</span>
                <div className="deck-scroll grid max-h-[78px] grid-cols-11 gap-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/40 p-1.5">
                  {Object.keys(ICON_MAP).map((name) => {
                    const Ico = ICON_MAP[name];
                    const on = editingMacro.icon === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        title={name}
                        aria-label={name}
                        aria-pressed={on}
                        onClick={() => setEditingMacro({ ...editingMacro, icon: name })}
                        className={`grid h-6 w-6 place-items-center rounded-lg transition-colors ${FOCUS}`}
                        style={{
                          background: on ? `${ACCENT_HEX[editingMacro.color]}26` : 'transparent',
                          color: on ? ACCENT_HEX[editingMacro.color] : '#7c8190',
                          boxShadow: on ? `inset 0 0 0 1px ${ACCENT_HEX[editingMacro.color]}66` : 'none',
                        }}
                      >
                        <Ico className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="col-span-12 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
              <button
                type="button"
                onClick={() => handleDeleteMacro(editingMacro.id)}
                className={`flex items-center gap-1 rounded-full border border-[#ff5d6c]/40 bg-[#ff5d6c]/10 px-3 py-1.5 text-xs font-bold text-[#ff5d6c] ${FOCUS}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete macro
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingMacro(null)}
                  className={`rounded-full bg-white/[0.07] px-3.5 py-1.5 text-xs font-bold text-[#c9ccd6] ${FOCUS}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`rounded-full bg-[#34d399] px-4 py-1.5 text-xs font-extrabold text-[#04130c] ${FOCUS}`}
                  style={{ boxShadow: '0 2px 0 #14664a' }}
                >
                  Save changes
                </button>
              </div>
            </div>
          </form>
        )}
      </HardwareDialog>
    </div>
  );
}
