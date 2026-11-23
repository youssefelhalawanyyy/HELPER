'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  onOpenPairing,
}: {
  deck: DevDeckState;
  antigravityPinned: boolean;
  onNavigateToMonitor?: () => void;
  onOpenPairing?: () => void;
}) {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualProfile, setManualProfile] = useState<ProfileId>('antigravity');
  const [editMode, setEditMode] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [burstPort, setBurstPort] = useState<number | null>(null);
  const [voiceActiveId, setVoiceActiveId] = useState<string | null>(null);
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

  const visibleMacros = useMemo(() => {
    return (deck.config?.macros ?? []).filter((m) => m.profileId === activeProfileId);
  }, [deck.config?.macros, activeProfileId]);

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

  const logPresets = deck.config?.logPresets ?? [];

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 212px' }}>
      {/* Left: Profile Switcher + Live Hardware Macro Grid */}
      <div className="flex min-h-0 flex-col gap-2">
        {/* Compact Profile Bar */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 overflow-x-auto">
            {profiles.map((prof) => {
              const selected = prof.id === activeProfileId;
              return (
                <button
                  key={prof.id}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setAutoSwitch(false);
                    setManualProfile(prof.id);
                  }}
                  className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider transition-colors"
                  style={{
                    background: selected ? '#22d3ee' : 'rgba(255,255,255,.06)',
                    color: selected ? '#041317' : '#8b90a0',
                  }}
                >
                  {prof.name}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setAutoSwitch((v) => !v);
              }}
              className="rounded-full px-2 py-1 text-[9.5px] font-extrabold uppercase"
              style={{
                background: autoSwitch ? 'rgba(52,211,153,.14)' : 'rgba(251,191,36,.14)',
                color: autoSwitch ? '#34d399' : '#fbbf24',
              }}
            >
              {autoSwitch ? 'Auto' : 'Lock'}
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setEditMode((v) => !v);
              }}
              aria-label="Edit macros"
              className="grid h-6 w-6 place-items-center rounded-full"
              style={{
                background: editMode ? '#a78bfa' : 'rgba(255,255,255,.07)',
                color: editMode ? '#090612' : '#9ca3af',
              }}
            >
              <Edit3 className="h-3 w-3" />
            </button>

            <button
              type="button"
              onClick={openNewMacro}
              aria-label="Add macro"
              className="grid h-6 w-6 place-items-center rounded-full bg-[#34d399]/15 text-[#34d399] hover:bg-[#34d399]/25"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Real Macro Grid or Clean Connect Prompt */}
        {!isConnected ? (
          <div className="tile flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center">
            <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
            <div className="disp text-[28px] text-[#f2f3f7]">Mac Not Linked</div>
            <p className="max-w-[340px] text-[11px] text-[#8b90a0]">
              Connect to your local Mac bridge to load live macOS app profiles, execute shortcuts,
              stream terminal logs, and kill active dev ports.
            </p>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={onOpenPairing}
              className="mt-1 flex items-center gap-1.5 rounded-full bg-[#34d399] px-4 py-2 text-[11px] font-extrabold text-[#04130c]"
              style={{ boxShadow: '0 3px 0 #14664a' }}
            >
              <Link2 className="h-3.5 w-3.5" />
              PAIR MAC NOW
            </motion.button>
          </div>
        ) : (
          <div className="deck-scroll grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-y-auto pr-0.5">
            {visibleMacros.map((macro) => {
              const Icon = ICON_MAP[macro.icon] || Zap;
              const accent = ACCENT_HEX[macro.color] || '#22d3ee';
              const isVoiceActive = voiceActiveId === macro.id;
              return (
                <motion.button
                  key={macro.id}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ y: -1.5 }}
                  transition={DECK_SPRING}
                  onClick={() => handlePressMacro(macro)}
                  className="tile flex min-h-[112px] flex-col justify-between p-3"
                  style={
                    isVoiceActive
                      ? {
                          borderColor: accent,
                          boxShadow: `0 0 0 1px ${accent}55, 0 0 26px -6px ${accent}99`,
                        }
                      : editMode
                        ? { borderStyle: 'dashed', borderColor: '#a78bfa88' }
                        : undefined
                  }
                >
                  <div
                    className="absolute top-0 left-0 h-[3px] rounded-r-full transition-all"
                    style={{ width: isVoiceActive ? '100%' : '48%', background: accent }}
                  />
                  <div
                    className="absolute top-0 left-0 h-1/2 w-[3px] rounded-b-full"
                    style={{ background: `linear-gradient(${accent}, transparent)` }}
                  />

                  <div className="flex w-full items-start justify-between gap-1">
                    <div className="disp line-clamp-2 text-[19px] text-[#f2f3f7]">
                      {isVoiceActive ? 'Listening' : macro.label}
                    </div>
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${isVoiceActive ? 'animate-pulse' : ''}`}
                      style={{ color: accent }}
                    />
                  </div>

                  {isVoiceActive && (
                    <div className="my-1 flex h-5 items-center gap-[2px]">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <i
                          key={i}
                          className="w-[2.5px] rounded-full bg-[#22d3ee]"
                          style={{
                            height:
                              4 +
                              Math.abs(Math.sin(waveTick / 120 + i * 0.6)) * 14,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="sub truncate" style={{ color: isVoiceActive ? accent : undefined }}>
                    {isVoiceActive
                      ? liveTranscript || 'Tap again to paste'
                      : editMode
                        ? 'Tap to edit'
                        : macro.sublabel || macro.actionType}
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Column: Live Active Dev Ports + Active macOS App Status */}
      <div className="tile flex h-full min-h-0 flex-col gap-2 p-3">
        <div className="flex items-center">
          <span className="sub">Active ports</span>
          <span className="num ml-1.5 rounded-full bg-white/10 px-1.5 text-[10px] font-bold">
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
            className="ml-auto text-[#7c8190] hover:text-white"
          >
            <RotateCcw className="h-[13px] w-[13px]" />
          </motion.button>
        </div>

        <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          <AnimatePresence>
            {deck.ports.map((p) => (
              <div key={`${p.port}-${p.pid}`} className="relative h-[40px]">
                <motion.div
                  exit={{ opacity: 0, scale: 0.7, x: -14 }}
                  transition={{ duration: 0.25 }}
                  className="flex h-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.045] pr-1.5 pl-2.5"
                >
                  <span className="relative h-1.5 w-1.5 shrink-0">
                    <i className="anim-ping absolute inset-0 rounded-full bg-[#34d399]" />
                    <i className="absolute inset-0 rounded-full bg-[#34d399]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="num truncate text-[11.5px] font-bold">:{p.port}</div>
                    <div className="truncate text-[9px] text-[#7c8190]">{p.process}</div>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => handleKillPort(p.port, p.pid)}
                    aria-label={`Kill port ${p.port}`}
                    className="rounded-full px-2.5 py-1 text-[10px] font-extrabold text-white"
                    style={{ background: '#e5484d', boxShadow: '0 2px 0 #7a1d20' }}
                  >
                    KILL
                  </motion.button>
                </motion.div>
                {burstPort === p.port && <Burst color="#ff5d6c" />}
              </div>
            ))}
          </AnimatePresence>

          {deck.ports.length === 0 && (
            <div className="sub grid h-full place-items-center rounded-xl border border-dashed border-white/10 p-3 text-center">
              {isConnected ? 'No dev ports listening' : 'Connect Mac to scan ports'}
            </div>
          )}
        </div>

        {/* Live Active macOS App Card */}
        <div className="rounded-xl border border-white/[0.07] bg-black/55 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <AppWindow className="h-3.5 w-3.5 text-[#22d3ee]" />
            <span className="truncate text-[11px] font-bold text-[#f2f3f7]">
              {isConnected ? deck.activeApp.appName : 'Offline'}
            </span>
          </div>
          <div className="sub mt-0.5 truncate">
            {isConnected ? `Profile: ${activeProfileId}` : 'Awaiting Mac bridge'}
          </div>
        </div>
      </div>

      {/* Real Macro Editor Dialog */}
      <HardwareDialog
        open={Boolean(editingMacro)}
        title={editingMacro?.label ? `Edit Macro — ${editingMacro.label}` : 'New Hardware Macro'}
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
                placeholder="Run Tests"
                className="rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#22d3ee]"
              />
            </label>
            <label className="col-span-3 flex flex-col gap-1">
              <span className="sub">Sublabel</span>
              <input
                type="text"
                value={editingMacro.sublabel || ''}
                onChange={(e) => setEditingMacro({ ...editingMacro, sublabel: e.target.value })}
                placeholder="⌘⇧T"
                className="font-mono-tech rounded-xl border border-white/10 bg-black px-2.5 py-2 text-xs text-white outline-none focus:border-[#22d3ee]"
              />
            </label>
            <label className="col-span-3 flex flex-col gap-1">
              <span className="sub">Color</span>
              <select
                value={editingMacro.color}
                onChange={(e) =>
                  setEditingMacro({ ...editingMacro, color: e.target.value as MacroButton['color'] })
                }
                className="rounded-xl border border-white/10 bg-black px-2 py-2 text-xs text-white outline-none"
              >
                <option value="cyan">Cyan</option>
                <option value="emerald">Emerald</option>
                <option value="amber">Amber</option>
                <option value="crimson">Crimson</option>
                <option value="violet">Violet</option>
                <option value="slate">Slate</option>
              </select>
            </label>

            <label className="col-span-4 flex flex-col gap-1">
              <span className="sub">Action</span>
              <select
                value={editingMacro.actionType}
                onChange={(e) => {
                  const nextType = e.target.value as MacroActionType;
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
                }}
                className="rounded-xl border border-white/10 bg-black px-2 py-2 text-xs text-white outline-none"
              >
                <option value="shell">Background Shell</option>
                <option value="terminal">Active Mac Terminal</option>
                <option value="stream">Stream in PWA Logs</option>
                <option value="shortcut">macOS Shortcut</option>
                <option value="voice">Voice-to-Prompt</option>
                <option value="snippet">Paste Snippet</option>
              </select>
            </label>

            <label className="col-span-4 flex flex-col gap-1">
              <span className="sub">Icon</span>
              <select
                value={editingMacro.icon}
                onChange={(e) => setEditingMacro({ ...editingMacro, icon: e.target.value })}
                className="rounded-xl border border-white/10 bg-black px-2 py-2 text-xs text-white outline-none"
              >
                {Object.keys(ICON_MAP).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-span-4 flex flex-col gap-1">
              <span className="sub">Profile</span>
              <select
                value={editingMacro.profileId}
                onChange={(e) =>
                  setEditingMacro({ ...editingMacro, profileId: e.target.value as ProfileId })
                }
                className="rounded-xl border border-white/10 bg-black px-2 py-2 text-xs text-white outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-span-12 flex flex-col gap-1">
              <span className="sub">Payload</span>
              {editingMacro.actionType === 'shortcut' ? (
                <select
                  value={editingMacro.payload}
                  onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  className="font-mono-tech rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-[#22d3ee]"
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
                  className="font-mono-tech rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-[#22d3ee]"
                >
                  {logPresets.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={editingMacro.payload}
                  onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  placeholder="npm run dev"
                  className="font-mono-tech rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-[#22d3ee]"
                />
              )}
            </label>

            <div className="col-span-12 flex justify-between pt-1">
              <button
                type="button"
                onClick={() => handleDeleteMacro(editingMacro.id)}
                className="flex items-center gap-1 rounded-full border border-[#ff5d6c]/40 bg-[#ff5d6c]/10 px-3 py-1.5 text-xs font-bold text-[#ff5d6c]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="submit"
                className="rounded-full bg-[#34d399] px-4 py-1.5 text-xs font-extrabold text-[#04130c]"
              >
                Save Macro
              </button>
            </div>
          </form>
        )}
      </HardwareDialog>
    </div>
  );
}
