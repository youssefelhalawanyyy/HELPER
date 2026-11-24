'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './SmartDeckView.module.css';
import {
  Activity,
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Calendar,
  Camera,
  CheckCircle2,
  Circle,
  ClipboardPaste,
  Clock,
  Cloud,
  CloudLightning,
  Code2,
  Command,
  Copy,
  Cpu,
  Edit3,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  GitPullRequest,
  Globe,
  Heart,
  Layers3,
  Link2,
  Loader2,
  Lock,
  Mic,
  Moon,
  MoonStar,
  MoreHorizontal,
  Network,
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
  Settings,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Terminal,
  TerminalSquare,
  TextCursor,
  Thermometer,
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

/* -------------------------------------------------------------------------- */
/*  Theme Tokens - Descklock Aesthetic                                        */
/* -------------------------------------------------------------------------- */

const THEME = {
  // Deep night sky background with subtle gradient
  background: '#0a0a12',
  surface: '#120a1f',
  surface2: '#1a122a',
  accent: '#c6b4ff',      // Soft lilac/primary
  accentGlow: 'rgba(198, 180, 255, 0.4)',
  muted: '#6b5b80',
  mutedSoft: '#4a3f6a',
  text: '#e8e4f0',
  textSubtle: '#a8a0c0',
  border: '#3a3050',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
};

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

const COLOR_ORDER: MacroButton['color'][] = [
  'cyan',
  'emerald',
  'amber',
  'crimson',
  'violet',
  'slate',
];

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

const ACTION_META: Record<
  MacroActionType,
  {
    label: string;
    name: string;
    icon: typeof Clock;
    color: MacroButton['color'];
    hint: string;
    example: string;
  }
> = {
  shortcut: {
    label: 'Shortcut',
    icon: Clock,
    hint: 'Send a key combination to the active app.',
    name: 'Keyboard shortcut',
    color: 'violet',
    example: 'Open Quick Open in VS Code with ⌘P.',
  },
  shell: {
    label: 'Shell',
    icon: Clock,
    hint: 'Run a command in the background.',
    name: 'Shell command',
    color: 'emerald',
    example: 'Run npm run typecheck in your project directory.',
  },
  terminal: {
    label: 'Terminal',
    icon: Clock,
    hint: 'Send a command to your terminal.',
    name: 'Terminal command',
    color: 'amber',
    example: 'Send git status to your terminal and read the result there.',
  },
  stream: {
    label: 'Stream',
    icon: Clock,
    hint: 'Follow live output from a log preset.',
    name: 'Log stream',
    color: 'cyan',
    example: 'Start a log preset and follow its output in Live Monitor.',
  },
  voice: {
    label: 'Voice',
    icon: Clock,
    hint: 'Speak a prompt and send it to your Mac.',
    name: 'Voice dictation',
    color: 'crimson',
    example: 'Dictate a prompt, then copy it or paste it into the active app.',
  },
  snippet: {
    label: 'Snippet',
    icon: Clock,
    hint: 'Paste saved text at your cursor.',
    name: 'Text snippet',
    color: 'slate',
    example: 'Insert a saved code fragment at the current cursor position.',
  },
};

const ACTION_ORDER = Object.keys(ACTION_META) as MacroActionType[];

function accentStyle(color: string) {
  return { '--accent': color } as CSSProperties;
}

const FIELD =
  'rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-white outline-none transition-colors focus:border-[#c6b4ff]';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[#c6b4ff]/70';

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

function KeycapFace({
  label,
  sublabel,
  Icon,
  detail,
  voice,
}: {
  label: string;
  sublabel: string;
  Icon: typeof Clock;
  detail?: string;
  voice?: boolean;
}) {
  return (
    <>
      <span className={styles.keyTop}>
        <span className={styles.keyIcon}>
          <Icon size={18} aria-hidden="true" />
        </span>
        {detail && <span className={styles.keyDetail}>{detail}</span>}
      </span>
      <span className={styles.keyCopy}>
        <strong>{voice ? 'Listening…' : label || 'Untitled'}</strong>
        <small>{sublabel}</small>
      </span>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Analog Clock Dial Component                                                 */
/* -------------------------------------------------------------------------- */

function AnalogClock({
  time,
}: {
  time: Date;
}) {
  const hour = time.getHours() % 12 || 12;
  const minute = time.getMinutes();
  const second = time.getSeconds();
  const millisec = time.getMilliseconds();
  
  const hourAngle = (hour * 30) + (minute * 0.5) + (second * 0.008) + (millisec * 0.00008);
  const minuteAngle = (minute * 6) + (second * 0.1) + (millisec * 0.01);
  const secondAngle = (second * 6) + (millisec * 0.06);
  
  const hourLength = 50;
  const minuteLength = 65;
  const secondLength = 75;

  return (
    <svg className="relative w-24 h-24 mx-auto" viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r="45"
        stroke="var(--accent)"
        strokeWidth={2}
        fill="none"
      />
      <circle
        cx="50"
        cy="50"
        r="38"
        stroke="var(--surface)"
        strokeWidth={1}
        fill="none"
      />
      
      {/* Hour marks */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * Math.PI / 6) - (Math.PI / 2);
        const x1 = 50 + 35 * Math.cos(angle);
        const y1 = 50 + 35 * Math.sin(angle);
        const x2 = 50 + 42 * Math.cos(angle);
        const y2 = 50 + 42 * Math.sin(angle);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--muted)"
            strokeWidth={1}
          />
        );
      })}
      
      {/* Center dot */}
      <circle cx="50" cy="50" r="3" fill="var(--accent)" />
      
      {/* Hand components */}
      <line
        x1="50"
        y1="50"
        x2={50 + hourLength * Math.cos(hourAngle * Math.PI / 180)}
        y2={50 + hourLength * Math.sin(hourAngle * Math.PI / 180)}
        stroke="var(--accent)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1="50"
        y1="50"
        x2={50 + minuteLength * Math.cos(minuteAngle * Math.PI / 180)}
        y2={50 + minuteLength * Math.sin(minuteAngle * Math.PI / 180)}
        stroke="var(--textSubtle)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1="50"
        y1="50"
        x2={50 + secondLength * Math.cos(secondAngle * Math.PI / 180)}
        y2={50 + secondLength * Math.sin(secondAngle * Math.PI / 180)}
        stroke="#ff5f57"
        strokeWidth={2}
        strokeLinecap="round"
      />
      
      {/* Decorative center */}
      <circle cx="50" cy="50" r="8" fill="var(--accentGlow)" />
      <circle cx="50" cy="50" r="4" fill="none" stroke="var(--accent)" strokeWidth={1} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Digital Clock Display                                                       */
/* -------------------------------------------------------------------------- */

function DigitalClock({
  time,
}: {
  time: Date;
}) {
  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');
  const ampm = time.getHours() >= 12 ? 'PM' : 'AM';

  return (
    <div className="flex items-center gap-2">
      <span className="text-3xl font-extrabold tracking-tight">{hours}</span>
      <span className="text-3xl font-extrabold tracking-tight">{minutes}</span>
      <span className="text-3xl font-extrabold tracking-tight">{seconds}</span>
      <span className="text-sm text-[var(--muted)]">ampm</span>
    </div>
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
  const [query, setQuery] = useState('');
  const [exploring, setExploring] = useState<MacroActionType | null>(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualProfile, setManualProfile] = useState<ProfileId>('antigravity');
  const [editMode, setEditMode] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [stoppingPort, setStoppingPort] = useState<number | null>(null);
  const [voiceActiveId, setVoiceActiveId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const voiceRecRef = useRef<SpeechRecLike | null>(null);
  const latestTextRef = useRef('');

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

  const profileMacros = (deck.config?.macros ?? []).filter((m) => m.profileId === activeProfileId);
  const searchTerm = query.trim().toLowerCase();
  const visibleMacros = profileMacros.filter((m) =>
    [m.label, m.sublabel, ACTION_META[m.actionType]?.label].some((part) =>
      part?.toLowerCase().includes(searchTerm),
    ),
  );
  const visibleTypes = ACTION_ORDER.filter((type) =>
    ACTION_META[type].name.toLowerCase().includes(searchTerm),
  );
  const connectionLabel = {
    connected: 'Connected',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    unpaired: 'Unpaired',
  }[deck.status];
  const existingMacro = Boolean(
    editingMacro && deck.config?.macros.some((m) => m.id === editingMacro.id),
  );
  const logPresets = deck.config?.logPresets ?? [];

  useEffect(() => {
    if (!isConnected) setVoiceActiveId(null);
    return () => {
      const rec = voiceRecRef.current;
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.stop();
        voiceRecRef.current = null;
      }
    };
  }, [isConnected]);

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

    if (voiceRecRef.current) return;
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
    rec.onerror = () => {
      latestTextRef.current = '';
      setVoiceActiveId(null);
      deck.showToast(false, 'Dictation stopped. Check microphone access and try again.');
    };
    rec.onend = () => {
      voiceRecRef.current = null;
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
    try {
      rec.start();
    } catch {
      voiceRecRef.current = null;
      setVoiceActiveId(null);
      deck.showToast(false, 'Could not start dictation. Check microphone access.');
    }
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
    setStoppingPort(port);
    deck.sendEvent({
      type: 'port:kill',
      payload: { requestId: makeRequestId(), pid, port },
    });
    window.setTimeout(() => setStoppingPort(null), 650);
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
    const sent = deck.sendEvent({
      type: 'macro:upsert',
      payload: { requestId: makeRequestId(), macro: editingMacro },
    });
    if (sent) {
      soundEngine.playSuccessChime();
      setEditingMacro(null);
    }
  };

  const handleDeleteMacro = (macroId: string) => {
    soundEngine.playErrorThud();
    const sent = deck.sendEvent({
      type: 'macro:delete',
      payload: { requestId: makeRequestId(), macroId },
    });
    if (sent) setEditingMacro(null);
  };

  const changeActionType = (nextType: MacroActionType) => {
    if (!editingMacro || editingMacro.actionType === nextType) return;
    soundEngine.playClick();
    setEditingMacro({
      ...editingMacro,
      actionType: nextType,
      payload:
        nextType === 'shortcut'
          ? SHORTCUT_OPTIONS[0]
          : nextType === 'stream'
            ? (logPresets[0]?.id ?? '')
            : nextType === 'voice'
              ? 'autoPaste'
              : '',
    });
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div className={styles.deck}>
      <div className={styles.workspace}>
        {/* ============ HEADER WITH CLOCK ============ */}
        <header className={styles.hero}>
          <div className={styles.heroClock}>
            <AnalogClock time={new Date()} />
            <DigitalClock time={new Date()} />
          </div>
          <div className={styles.heroCopy}>
            <span className={styles.connection} role="status" data-live={isConnected}>
              <i />
              {connectionLabel}
              {isConnected && deck.hello?.hostname && ` · ${deck.hello.hostname}`}
            </span>
            <h1>Smart Deck</h1>
            <p>
              {isConnected
                ? `${activeProfile?.name ?? activeProfileId} profile · ${profileMacros.length} ${profileMacros.length === 1 ? 'macro' : 'macros'}`
                : 'Pair your Mac to run shortcuts, commands, and workflows.'}
            </p>
            <button
              type="button"
              className={styles.heroButton}
              onClick={isConnected ? openNewMacro : onOpenPairing}
            >
              {isConnected ? <Plus size={15} /> : <Link2 size={15} />}
              {isConnected ? 'New macro' : 'Pair Mac'} <ArrowRight size={14} />
            </button>
          </div>
        </header>

        {/* ============ CLOCK INFO SECTION ============ */}
        <div className={styles.clockInfo}>
          <div className={styles.clockDetails}>
            <div className={styles.timeZone}>
              <Clock size={16} /> {new Date().toLocaleTimeString(undefined, { hour12: false })}
            </div>
            <div className={styles.dateDisplay}>
              <Calendar size={14} /> {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <div className={styles.quickActions}>
            <button type="button" className={styles.quickBtn} onClick={() => setAutoSwitch(!autoSwitch)}>
              {autoSwitch ? <MoonStar size={14} /> : <Sun size={14} />}
              {autoSwitch ? 'Auto-switch' : 'Manual mode'}
            </button>
            <button type="button" className={styles.quickBtn} onClick={onNavigateToMonitor}>
              <Activity size={14} /> Live Monitor
            </button>
          </div>
        </div>

        <div className={styles.panels}>
          <section className={styles.library} aria-labelledby="deck-library-title">
            <div className={styles.heading}>
              <div className={styles.titleGroup}>
                <MoonStar size={19} />
                <h2 id="deck-library-title">{isConnected ? 'Macro library' : 'Action library'}</h2>
              </div>
              <label className={styles.search}>
                <Search size={14} />
                <input
                  type="search"
                  aria-label="Search library"
                  placeholder="Search library"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {isConnected && (
                <button
                  type="button"
                  className={styles.tool}
                  aria-pressed={editMode}
                  onClick={() => setEditMode(!editMode)}
                >
                  <Edit3 size={14} />
                  {editMode ? 'Done' : 'Edit'}
                </button>
              )}
            </div>
            {isConnected && (
              <div className={styles.profileBar}>
                <div
                  role="group"
                  aria-label="Macro profiles"
                  className={styles.profiles}
                  data-no-swipe="true"
                >
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      disabled={antigravityPinned && profile.id !== activeProfileId}
                      aria-pressed={profile.id === activeProfileId}
                      onClick={() => {
                        setAutoSwitch(false);
                        setManualProfile(profile.id);
                        setQuery('');
                      }}
                    >
                      {profile.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.follow}
                  disabled={antigravityPinned}
                  aria-pressed={autoSwitch && !antigravityPinned}
                  title="Follow the active Mac app"
                  onClick={() => {
                    setManualProfile(activeProfileId);
                    setAutoSwitch(!autoSwitch);
                  }}
                >
                  {antigravityPinned ? <Lock size={13} /> : <Radio size={13} />}
                  {antigravityPinned ? 'Pinned' : autoSwitch ? 'Following app' : 'Manual'}
                </button>
              </div>
            )}
            {isConnected && voiceActiveId && (
              <button
                className={styles.dictation}
                type="button"
                onClick={() => voiceRecRef.current?.stop()}
              >
                <Mic size={14} />
                <span>{liveTranscript || 'Listening…'}</span>
                <strong>Finish dictation</strong>
              </button>
            )}
            {editMode && isConnected && (
              <p className={styles.editHint}>
                Select a macro to edit its action, appearance, or profile.
              </p>
            )}
            <div className={`${styles.keys} deck-scroll`} data-preview={!isConnected}>
              {!isConnected &&
                visibleTypes.map((type) => {
                  const Icon = ACTION_META[type].icon;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={styles.key}
                      style={accentStyle(ACCENT_HEX[ACTION_META[type].color])}
                      onClick={() => setExploring(type)}
                    >
                      <span className={styles.keyTop}>
                        <span className={styles.keyIcon}>
                          <Icon size={18} />
                        </span>
                        <ArrowUpRight size={14} aria-hidden="true" className={styles.cardArrow} />
                      </span>
                      <span className={styles.keyCopy}>
                        <strong>{ACTION_META[type].name}</strong>
                        <small>{ACTION_META[type].hint}</small>
                      </span>
                    </button>
                  );
                })}
              {isConnected &&
                visibleMacros.map((macro) => {
                  const listening = voiceActiveId === macro.id;
                  return (
                    <button
                      key={macro.id}
                      type="button"
                      className={styles.key}
                      data-edit={editMode}
                      data-active={flashId === macro.id || listening}
                      style={accentStyle(ACCENT_HEX[macro.color] ?? profileAccent)}
                      onClick={() => handlePressMacro(macro)}
                    >
                      <KeycapFace
                        label={macro.label}
                        sublabel={
                          listening
                            ? liveTranscript || 'Tap to finish'
                            : macro.sublabel || ACTION_META[macro.actionType].label
                        }
                        Icon={ICON_MAP[macro.icon] || Clock}
                        detail={editMode ? 'Edit' : ACTION_META[macro.actionType].label}
                        voice={listening}
                      />
                    </button>
                  );
                })}
              {(isConnected ? !visibleMacros.length : !visibleTypes.length) && (
                <div className={styles.empty}>
                  {searchTerm ? <Search /> : <Layers3 />}
                  <strong>
                    {searchTerm ? 'No matching actions' : 'This profile has no macros yet'}
                  </strong>
                  <button
                    className={styles.tool}
                    type="button"
                    onClick={searchTerm ? () => setQuery('') : openNewMacro}
                  >
                    {searchTerm ? 'Clear search' : 'Create first macro'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <aside className={styles.sidebar} aria-label="Mac workspace">
            <section className={styles.context}>
              <div className={styles.titleGroup}>
                <SlidersHorizontal size={16} />
                <h2>Workspace</h2>
              </div>
              <dl>
                <div>
                  <dt>
                    <AppWindow size={14} />
                    Active app
                  </dt>
                  <dd>{isConnected ? deck.activeApp.appName : 'Offline'}</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch size={14} />
                    Git branch
                  </dt>
                  <dd>
                    {isConnected
                      ? deck.gitStatus.isGitRepo
                        ? deck.gitStatus.branch
                        : 'No repository'
                      : '—'}
                  </dd>
                </div>
              </dl>
              {onNavigateToMonitor && (
                <button type="button" className={styles.monitor} onClick={onNavigateToMonitor}>
                  <Activity size={14} />
                  Live Monitor
                  <ArrowUpRight size={14} />
                </button>
              )}
            </section>
            <section className={styles.ports}>
              <div className={styles.heading}>
                <div className={styles.titleGroup}>
                  <Network size={16} />
                  <h2>Dev ports</h2>
                </div>
                {isConnected && <span className={styles.count}>{deck.ports.length}</span>}
                <button
                  type="button"
                  className={styles.refresh}
                  aria-label="Refresh ports"
                  disabled={!isConnected}
                  onClick={() =>
                    deck.sendEvent({
                      type: 'ports:refresh',
                      payload: { requestId: makeRequestId() },
                    })
                  }
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              {isConnected && deck.ports.length > 0 ? (
                <ul className={`${styles.portList} deck-scroll`}>
                  {deck.ports.map((port) => (
                    <li key={`${port.port}-${port.pid}`}>
                      <i />
                      <div>
                        <strong>:{port.port}</strong>
                        <small>{port.process}</small>
                      </div>
                      <button
                        type="button"
                        aria-label={`Stop port ${port.port}`}
                        disabled={stoppingPort === port.port}
                        onClick={() => handleKillPort(port.port, port.pid)}
                      >
                        Stop
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.portEmpty}>
                  <Radio size={20} />
                  <span>
                    {isConnected ? 'No servers listening' : 'Pair your Mac to see listening ports.'}
                  </span>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      <HardwareDialog
        open={Boolean(exploring)}
        title={exploring ? ACTION_META[exploring].name : 'Action details'}
        onClose={() => setExploring(null)}
      >
        {exploring && (
          <div className={styles.actionInfo} data-no-swipe="true">
            <p>{ACTION_META[exploring].hint}</p>
            <div>
              <strong>Example</strong>
              <p>{ACTION_META[exploring].example}</p>
            </div>
            <button
              type="button"
              className={styles.tool}
              onClick={() => {
                setExploring(null);
                if (isConnected) openNewMacro();
                else onOpenPairing?.();
              }}
            >
              {isConnected ? 'New macro' : 'Pair Mac'}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </HardwareDialog>
      {/* ============================ Macro editor =========================== */}
      <HardwareDialog
        open={Boolean(editingMacro)}
        title={existingMacro ? 'Edit macro' : 'New macro'}
        onClose={() => setEditingMacro(null)}
      >
        {editingMacro && (
          <form
            onSubmit={handleSaveMacro}
            className={`grid grid-cols-12 gap-3 ${styles.editor}`}
            data-no-swipe="true"
          >
            {/* Live preview */}
            <div className="col-span-4 flex flex-col gap-1.5">
              <span className="sub">Preview</span>
              <div className={styles.key} style={accentStyle(ACCENT_HEX[editingMacro.color])}>
                <KeycapFace
                  label={editingMacro.label}
                  sublabel={
                    editingMacro.sublabel || ACTION_META[editingMacro.actionType]?.label || ''
                  }
                  Icon={ICON_MAP[editingMacro.icon] || Clock}
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
                        className={styles.actionChoice}
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
                    className={`font-mono-tech ${FIELD} text-[#d1bfff]`}
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
                    className={`font-mono-tech ${FIELD} text-[#d1bfff]`}
                  >
                    {logPresets.length === 0 && <option value="">No presets configured</option>}
                    {logPresets.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.label}
                      </option>
                    ))}
                  </select>
                ) : editingMacro.actionType === 'voice' ? (
                  <select
                    className={FIELD}
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                  >
                    <option value="autoPaste">Paste into app</option>
                    <option value="copyOnly">Copy only</option>
                  </select>
                ) : editingMacro.actionType === 'snippet' ? (
                  <textarea
                    className={FIELD}
                    rows={3}
                    required
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    placeholder="Text to insert"
                  />
                ) : (
                  <input
                    type="text"
                    required
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    placeholder="npm run dev"
                    className={`font-mono-tech ${FIELD} text-[#d1bfff]`}
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
                          boxShadow: on
                            ? `0 0 0 2px #0b0c10, 0 0 0 3.5px ${ACCENT_HEX[c]}`
                            : 'none',
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
                <div className="deck-scroll grid max-h-[78px] grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/40 p-1.5">
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
                          boxShadow: on
                            ? `inset 0 0 0 1px ${ACCENT_HEX[editingMacro.color]}66`
                            : 'none',
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
                hidden={!existingMacro}
                onClick={() => handleDeleteMacro(editingMacro.id)}
                className={`flex items-center gap-1 rounded-full border border-[#ff5d6c]/40 bg-[#ff5d6c]/10 px-3 py-1.5 text-xs font-bold text-[#ff5d6c] ${FOCUS}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete macro
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingMacro(null)}
                  className={`rounded-full bg-white/[0.07] px-3.5 py-1.5 text-xs font-bold text-[#c9ccd6] ${FOCUS}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`rounded-full bg-[#c6b4ff] px-4 py-1.5 text-xs font-bold text-[#241c30] disabled:opacity-50 ${FOCUS}`}
                  disabled={
                    !isConnected || !editingMacro.label.trim() || !editingMacro.payload.trim()
                  }
                >
                  {existingMacro ? 'Save changes' : 'Create macro'}
                </button>
              </div>
            </div>
          </form>
        )}
      </HardwareDialog>
    </div>
  );
}
