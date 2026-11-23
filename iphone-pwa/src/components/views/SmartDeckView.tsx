'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
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

const COLOR_STYLES: Record<MacroButton['color'], { dot: string; icon: string; ring: string }> = {
  emerald: { dot: 'bg-emerald-400 shadow-[0_0_8px_#10B981]', icon: 'text-emerald-400', ring: 'hover:border-emerald-500/40' },
  crimson: { dot: 'bg-red-500 shadow-[0_0_8px_#EF4444]', icon: 'text-red-400', ring: 'hover:border-red-500/40' },
  amber: { dot: 'bg-amber-400 shadow-[0_0_8px_#F59E0B]', icon: 'text-amber-400', ring: 'hover:border-amber-500/40' },
  cyan: { dot: 'bg-cyan-400 shadow-[0_0_8px_#06B6D4]', icon: 'text-cyan-400', ring: 'hover:border-cyan-500/40' },
  violet: { dot: 'bg-violet-400 shadow-[0_0_8px_#8B5CF6]', icon: 'text-violet-400', ring: 'hover:border-violet-500/40' },
  slate: { dot: 'bg-zinc-400', icon: 'text-zinc-300', ring: 'hover:border-white/25' },
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
  onNavigateToMonitor,
}: {
  deck: DevDeckState;
  onNavigateToMonitor?: () => void;
}) {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualProfile, setManualProfile] = useState<ProfileId>('antigravity');
  const [editMode, setEditMode] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [voiceActiveMacroId, setVoiceActiveMacroId] = useState<string | null>(null);
  const voiceRecRef = useRef<SpeechRecLike | null>(null);
  const voiceTextRef = useRef('');

  const profiles = deck.config?.profiles ?? [
    { id: 'antigravity', name: 'Antigravity', matchApps: [], accent: 'cyan' },
    { id: 'vscode', name: 'VS Code', matchApps: [], accent: 'violet' },
    { id: 'chrome', name: 'Browser', matchApps: [], accent: 'amber' },
    { id: 'terminal', name: 'Terminal', matchApps: [], accent: 'emerald' },
    { id: 'general', name: 'General', matchApps: [], accent: 'violet' },
  ];

  const activeProfileId: ProfileId = autoSwitch ? deck.activeApp.profileId : manualProfile;

  const visibleMacros = useMemo(() => {
    const all = deck.config?.macros ?? [];
    return all.filter((m) => m.profileId === activeProfileId);
  }, [deck.config?.macros, activeProfileId]);

  const toggleVoicePrompt = (macro: MacroButton) => {
    if (voiceActiveMacroId === macro.id && voiceRecRef.current) {
      voiceRecRef.current.stop();
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

    voiceTextRef.current = '';
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let text = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        text += ev.results[i][0].transcript;
      }
      voiceTextRef.current = text.trim();
    };
    rec.onerror = () => setVoiceActiveMacroId(null);
    rec.onend = () => {
      setVoiceActiveMacroId(null);
      if (voiceTextRef.current) {
        deck.sendEvent({
          type: 'voice:transcript',
          payload: {
            requestId: makeRequestId(),
            text: voiceTextRef.current,
            autoPaste: macro.payload !== 'copyOnly',
          },
        });
        soundEngine.playSuccessChime();
      }
    };
    voiceRecRef.current = rec;
    setVoiceActiveMacroId(macro.id);
    rec.start();
  };

  const handlePressMacro = (macro: MacroButton) => {
    soundEngine.playClick();
    if (editMode) {
      setEditingMacro({ ...macro });
      return;
    }
    if (macro.actionType === 'voice') {
      toggleVoicePrompt(macro);
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

  const openNewMacro = () => {
    soundEngine.playClick();
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
    <div className="flex h-full flex-col gap-2.5 p-3">
      {/* Top Profile Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
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
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selected
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                    : 'border-white/[0.08] bg-[#101014] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {prof.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setAutoSwitch((v) => !v);
            }}
            className={`font-mono-tech flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              autoSwitch
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${autoSwitch ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            {autoSwitch ? 'Auto-Switch' : 'Manual Lock'}
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setEditMode((v) => !v);
            }}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              editMode
                ? 'border-violet-400/50 bg-violet-500/20 text-violet-200'
                : 'border-white/[0.08] bg-[#101014] text-zinc-400 hover:text-white'
            }`}
          >
            <Edit3 className="h-3 w-3" />
            {editMode ? 'Done' : 'Edit'}
          </button>

          <button
            type="button"
            onClick={openNewMacro}
            className="flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            Macro
          </button>
        </div>
      </div>

      {/* Hardware Macro Grid */}
      <div className="deck-scroll grid flex-1 grid-cols-4 gap-2.5 overflow-y-auto pb-1">
        {visibleMacros.map((macro) => {
          const Icon = ICON_MAP[macro.icon] || Zap;
          const style = COLOR_STYLES[macro.color] || COLOR_STYLES.slate;
          const isListeningVoice = voiceActiveMacroId === macro.id;
          return (
            <motion.button
              key={macro.id}
              type="button"
              whileTap={{ scale: 0.94, y: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              onClick={() => handlePressMacro(macro)}
              className={`hw-key group relative flex min-h-[86px] flex-col justify-between rounded-2xl p-3 text-left transition-colors ${style.ring} ${
                editMode ? 'border-dashed border-violet-400/50' : ''
              } ${isListeningVoice ? 'border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]' : ''}`}
            >
              <div className="flex w-full items-start justify-between">
                <Icon className={`h-5 w-5 ${isListeningVoice ? 'animate-pulse text-cyan-300' : style.icon}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              </div>

              <div className="mt-2">
                <div className="truncate text-xs font-semibold tracking-tight text-white">
                  {isListeningVoice ? 'Listening… Tap' : macro.label}
                </div>
                <div className="font-mono-tech mt-0.5 truncate text-[10px] text-zinc-500">
                  {editMode ? 'Tap to edit' : macro.sublabel || macro.actionType}
                </div>
              </div>
            </motion.button>
          );
        })}

        {visibleMacros.length === 0 && (
          <div className="hw-panel col-span-4 flex flex-col items-center justify-center rounded-2xl p-6 text-center">
            <p className="text-xs text-zinc-400">No macros in this profile yet.</p>
            <button
              type="button"
              onClick={openNewMacro}
              className="mt-2 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black"
            >
              Add First Macro
            </button>
          </div>
        )}
      </div>

      {/* Macro Editor Modal (<dialog>) */}
      <HardwareDialog
        open={Boolean(editingMacro)}
        title={editingMacro?.label ? `Edit Macro — ${editingMacro.label}` : 'New Hardware Macro'}
        onClose={() => setEditingMacro(null)}
      >
        {editingMacro && (
          <form onSubmit={handleSaveMacro} className="grid grid-cols-12 gap-3">
            <label className="col-span-6 flex flex-col gap-1">
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Label</span>
              <input
                type="text"
                required
                autoFocus
                value={editingMacro.label}
                onChange={(e) => setEditingMacro({ ...editingMacro, label: e.target.value })}
                placeholder="Run Tests"
                className="rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
              />
            </label>

            <label className="col-span-3 flex flex-col gap-1">
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Sublabel</span>
              <input
                type="text"
                value={editingMacro.sublabel || ''}
                onChange={(e) => setEditingMacro({ ...editingMacro, sublabel: e.target.value })}
                placeholder="⌘⇧T"
                className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
              />
            </label>

            <label className="col-span-3 flex flex-col gap-1">
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Color</span>
              <select
                value={editingMacro.color}
                onChange={(e) =>
                  setEditingMacro({ ...editingMacro, color: e.target.value as MacroButton['color'] })
                }
                className="rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
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
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Action Type</span>
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
                className="rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
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
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Icon</span>
              <select
                value={editingMacro.icon}
                onChange={(e) => setEditingMacro({ ...editingMacro, icon: e.target.value })}
                className="rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
              >
                {Object.keys(ICON_MAP).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-span-4 flex flex-col gap-1">
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">Profile</span>
              <select
                value={editingMacro.profileId}
                onChange={(e) =>
                  setEditingMacro({ ...editingMacro, profileId: e.target.value as ProfileId })
                }
                className="rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-span-12 flex flex-col gap-1">
              <span className="font-mono-tech text-[10px] uppercase text-zinc-400">
                {editingMacro.actionType === 'shortcut'
                  ? 'Whitelisted Shortcut'
                  : editingMacro.actionType === 'stream'
                    ? 'Background Log Stream Preset'
                    : editingMacro.actionType === 'terminal'
                      ? 'Command Sent to Active Terminal.app / iTerm2 Window'
                      : editingMacro.actionType === 'voice'
                        ? 'Voice Delivery Mode'
                        : editingMacro.actionType === 'shell'
                          ? 'Shell Command (runs in projectDir)'
                          : 'Snippet Text'}
              </span>
              {editingMacro.actionType === 'shortcut' ? (
                <select
                  value={editingMacro.payload}
                  onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-cyan-200 outline-none focus:border-cyan-400"
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
                  className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-cyan-200 outline-none focus:border-cyan-400"
                >
                  {logPresets.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.label} ({pr.command} {pr.args.join(' ')})
                    </option>
                  ))}
                </select>
              ) : editingMacro.actionType === 'voice' ? (
                <select
                  value={editingMacro.payload}
                  onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-cyan-200 outline-none focus:border-cyan-400"
                >
                  <option value="autoPaste">Auto-Paste at Mac Cursor (⌘V)</option>
                  <option value="copyOnly">Copy to Mac Clipboard Only</option>
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={editingMacro.payload}
                  onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  placeholder={
                    editingMacro.actionType === 'terminal'
                      ? 'npm run dev'
                      : editingMacro.actionType === 'shell'
                        ? 'npm run build'
                        : 'console.log(123)'
                  }
                  className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-cyan-200 outline-none focus:border-cyan-400"
                />
              )}
            </label>

            <div className="col-span-12 flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => handleDeleteMacro(editingMacro.id)}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="submit"
                className="rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-black"
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
