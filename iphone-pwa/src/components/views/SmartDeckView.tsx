'use client';

import { WorkspaceBookmarks, ChainProgress } from './WorkspaceControls';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './SmartDeckView.module.css';
import {
  Activity,
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Code2,
  Command,
  Copy,
  Cpu,
  Edit3,
  Eraser,
  GitBranch,
  GitPullRequest,
  Layers3,
  Link2,
  Lock,
  Mic,
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
  SlidersHorizontal,
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

const ACCENT_HEX: Record<MacroButton['color'], string> = {
  emerald: '#34d399',
  crimson: '#ff5d6c',
  amber: '#fbbf24',
  cyan: '#22d3ee',
  violet: '#a78bfa',
  slate: '#9cb4bb',
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
  'media.prev',
  'media.playpause',
  'media.next',
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
  chain: {
    label: 'Chain',
    name: 'Macro sequence',
    icon: Clock,
    color: 'amber',
    hint: 'Run comma-separated steps in order: wake, antigravity, chrome, dev-server, caffeine, or a shortcut ID.',
    example: 'wake, antigravity, chrome, dev-server, caffeine',
  },
  shortcut: {
    label: 'Shortcut',
    icon: Command,
    hint: 'Send a key combination to the active app.',
    name: 'Keyboard shortcut',
    color: 'violet',
    example: 'Open Quick Open in VS Code with ⌘P.',
  },
  shell: {
    label: 'Shell',
    icon: Terminal,
    hint: 'Run a command in the background.',
    name: 'Shell command',
    color: 'emerald',
    example: 'Run npm run typecheck in your project directory.',
  },
  terminal: {
    label: 'Terminal',
    icon: TerminalSquare,
    hint: 'Send a command to your terminal.',
    name: 'Terminal command',
    color: 'amber',
    example: 'Send git status to your terminal and read the result there.',
  },
  stream: {
    label: 'Stream',
    icon: Activity,
    hint: 'Follow live output from a log preset.',
    name: 'Log stream',
    color: 'cyan',
    example: 'Start a log preset and follow its output in Live Monitor.',
  },
  voice: {
    label: 'Voice',
    icon: Mic,
    hint: 'Speak a prompt and send it to your computer.',
    name: 'Voice dictation',
    color: 'crimson',
    example: 'Dictate a prompt, then copy it or paste it into the active app.',
  },
  snippet: {
    label: 'Snippet',
    icon: ClipboardPaste,
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
  'rounded-xl border border-[#98c8ce2e] bg-[#0a151c] px-3 py-2 text-xs text-[#effaf7] outline-none transition-colors focus:border-[#88f1d1]';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[#88f1d1]/75';

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
    { id: 'music', name: 'Music', matchApps: [], accent: 'emerald' },
    { id: 'general', name: 'General', matchApps: [], accent: 'violet' },
  ];

  const activeProfileId: ProfileId = antigravityPinned
    ? 'antigravity'
    : autoSwitch
      ? deck.activeApp.profileId
      : manualProfile;

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileAccent =
    ACCENT_HEX[(activeProfile?.accent ?? 'cyan') as MacroButton['color']] ?? '#88f1d1';

  const pinKey = 'devdeck.pinned.'+(deck.bridgeBaseUrl || 'local');
  const [pinned,setPinned] = useState<string[]>([]);
  const [chain,setChain] = useState<MacroButton|null>(null);
  useEffect(()=>{try {setPinned(JSON.parse(localStorage.getItem(pinKey)||'[]'));} catch {setPinned([]);}setChain(null);},[pinKey]);
  function togglePin(id:string) {
    const next = pinned.includes(id)?pinned.filter(key=>key!==id):[...pinned,id];
    setPinned(next); localStorage.setItem(pinKey,JSON.stringify(next));
  }
  const profileMacros = (deck.config?.macros ?? []).filter((m) => m.profileId === activeProfileId);
  const searchTerm = query.trim().toLowerCase();
  const orderedMacros = [...pinned.flatMap(id=>deck.config?.macros.filter(m=>m.id===id) || []), ...profileMacros.filter(m=>!pinned.includes(m.id))];
  const visibleMacros = orderedMacros.filter((m) =>
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

  const handlePressMacro = async (macro: MacroButton) => {
    soundEngine.playClick();
    if (!isConnected) {
      deck.showToast(false, 'Pair your computer first to execute macros');
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
    if (macro.actionType === 'chain') setChain(macro);
    const result=await deck.requestAction({type:'macro:execute',payload:{requestId:makeRequestId(),macroId:macro.id}});
    if (!result.ok) return;
    setFlashId(macro.id);
    window.setTimeout(()=>setFlashId(cur=>cur===macro.id?null:cur),700);
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
        nextType === 'chain'
          ? 'wake, antigravity, chrome, dev-server, caffeine'
          : nextType === 'shortcut'
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
        {/* ============ STREAMLINED COMMAND BANNER ============ */}
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroTitleGroup}>
              <span className={styles.connection} role="status" data-live={isConnected}>
                <i />
                {connectionLabel}
                {isConnected && deck.hello?.hostname && ` · ${deck.hello.hostname}`}
              </span>
              <div className={styles.heroHeadlineRow}>
                <h1>Smart Deck</h1>
                <p>
                  {isConnected
                    ? `${activeProfile?.name ?? activeProfileId} profile · ${profileMacros.length} ${profileMacros.length === 1 ? 'macro' : 'macros'}`
                    : 'Pair your computer to run shortcuts, commands, and workflows.'}
                </p>
              </div>
            </div>

            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.heroButton}
                onClick={isConnected ? openNewMacro : onOpenPairing}
              >
                {isConnected ? (
                  <Plus size={15} aria-hidden="true" />
                ) : (
                  <Link2 size={15} aria-hidden="true" />
                )}
                <span>{isConnected ? 'New macro' : 'Pair computer'}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {/* ============ MAIN 2-COLUMN WORKSPACE ============ */}
        <div className={styles.panels}>
          <section className={styles.library} aria-labelledby="deck-library-title">
            <div className={styles.heading}>
              <div className={styles.titleGroup}>
                <Command size={18} aria-hidden="true" />
                <h2 id="deck-library-title">
                  {isConnected ? 'Macro library' : 'Action library'}
                </h2>
              </div>

              <label className={styles.search}>
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search library"
                  placeholder="Search macros…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              {isConnected && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={styles.tool}
                    title="Export Macro Deck as JSON backup"
                    onClick={() => {
                      soundEngine.playClick();
                      const allMacros = deck.config?.macros ?? [];
                      const blob = new Blob(
                        [JSON.stringify({ macros: allMacros, exportedAt: new Date().toISOString() }, null, 2)],
                        { type: 'application/json' },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'devdeck-macros-backup.json';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      deck.showToast(true, `Exported ${allMacros.length} macros to JSON`);
                    }}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    title="Import Macro Deck JSON"
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = 'application/json,.json';
                      inp.onchange = async () => {
                        const file = inp.files?.[0];
                        if (!file) return;
                        try {
                          const parsed = JSON.parse(await file.text()) as { macros?: MacroButton[] };
                          const list = Array.isArray(parsed.macros) ? parsed.macros : [];
                          for (const m of list) {
                            if (m?.id && m?.label && m?.payload) {
                              deck.sendEvent({
                                type: 'macro:upsert',
                                payload: { requestId: makeRequestId(), macro: m },
                              });
                            }
                          }
                          deck.showToast(true, `Imported ${list.length} macros!`);
                        } catch {
                          deck.showToast(false, 'Invalid macro JSON file');
                        }
                      };
                      inp.click();
                    }}
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    aria-pressed={editMode}
                    onClick={() => setEditMode(!editMode)}
                  >
                    <Edit3 size={14} aria-hidden="true" />
                    {editMode ? 'Done' : 'Edit'}
                  </button>
                </div>
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
                        soundEngine.playClick();
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
                  title="Automatically switch profile to match the active desktop app"
                  onClick={() => {
                    soundEngine.playClick();
                    setManualProfile(activeProfileId);
                    setAutoSwitch(!autoSwitch);
                  }}
                >
                  {antigravityPinned ? (
                    <Lock size={13} aria-hidden="true" />
                  ) : (
                    <Radio size={13} aria-hidden="true" />
                  )}
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
                <Mic size={15} aria-hidden="true" />
                <span>{liveTranscript || 'Listening…'}</span>
                <strong>Finish dictation</strong>
              </button>
            )}

            {editMode && isConnected && (
              <p className={styles.editHint}>
                Tap any macro key below to edit its command, icon, color, or profile.
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
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <ArrowUpRight size={15} aria-hidden="true" className={styles.cardArrow} />
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
                        detail={flashId===macro.id?'Confirmed':editMode?'Edit':pinned.includes(macro.id)?'Pinned':ACTION_META[macro.actionType].label}
                        voice={listening}
                      />
                    </button>
                  );
                })}

              {(isConnected ? !visibleMacros.length : !visibleTypes.length) && (
                <div className={styles.empty}>
                  {searchTerm ? <Search aria-hidden="true" /> : <Layers3 aria-hidden="true" />}
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
            {isConnected && <WorkspaceBookmarks deck={deck}/>}
          </section>

          <aside className={styles.sidebar} aria-label="Computer workspace and ports">
            <section className={styles.context}>
              <div className={styles.titleGroup}>
                <SlidersHorizontal size={16} aria-hidden="true" />
                <h2>Workspace</h2>
              </div>
              <dl>
                <div>
                  <dt>
                    <AppWindow size={14} aria-hidden="true" />
                    Active app
                  </dt>
                  <dd>{isConnected ? deck.activeApp.appName : 'Offline'}</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch size={14} aria-hidden="true" />
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
                  <Activity size={14} aria-hidden="true" />
                  <span>Live Monitor</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </section>

            <section className={styles.ports}>
              <div className={styles.heading}>
                <div className={styles.titleGroup}>
                  <Network size={16} aria-hidden="true" />
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
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
              </div>
              {isConnected && deck.ports.length > 0 ? (
                <ul role="list" className={`${styles.portList} deck-scroll`}>
                  {deck.ports.map((port) => (
                    <li key={`${port.port}-${port.pid}`}>
                      <i aria-hidden="true" />
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
                  <Radio size={20} aria-hidden="true" />
                  <span>
                    {isConnected
                      ? 'No dev servers listening'
                      : 'Pair your computer to view listening ports.'}
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
              {isConnected ? 'New macro' : 'Pair computer'}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </HardwareDialog>

      {chain && <ChainProgress deck={deck} id={chain.id} onClose={()=>setChain(null)} retry={()=>void handlePressMacro(chain)}/>}
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
            {existingMacro && <button type="button" className="col-span-12" onClick={()=>togglePin(editingMacro.id)}>{pinned.includes(editingMacro.id)?'Unpin key':'Pin key across profiles'}</button>}
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
              <p className="text-[10px] leading-snug text-[#9cb4bb]">
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
                        <Ico className="h-3.5 w-3.5" aria-hidden="true" />
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
                          : editingMacro.actionType === 'chain'
                            ? 'Routine Steps (perf:super, brightness:90, volume:50, caffeine, app:Chrome, shell:...)'
                            : 'Command'}
                </span>
                {editingMacro.actionType === 'chain' && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {(
                      [
                        ['Deep Work', 'perf:super, brightness:85, caffeine, antigravity, dev-server'],
                        ['Turbo Render', 'perf:turbo, brightness:100, caffeine'],
                        ['Eco Travel', 'perf:eco, brightness:50, volume:30'],
                        ['Movie Night', 'perf:eco, brightness:40, volume:70, chrome'],
                      ] as const
                    ).map(([name, tpl]) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() =>
                          setEditingMacro({
                            ...editingMacro,
                            label: editingMacro.label || name,
                            payload: tpl,
                          })
                        }
                        className="rounded-md border border-[#88f1d1]/35 bg-[#88f1d1]/12 px-2 py-0.5 text-[9px] font-extrabold text-[#88f1d1]"
                      >
                        + {name}
                      </button>
                    ))}
                  </div>
                )}
                {editingMacro.actionType === 'shortcut' ? (
                  <select
                    value={editingMacro.payload}
                    onChange={(e) => setEditingMacro({ ...editingMacro, payload: e.target.value })}
                    className={`font-mono-tech ${FIELD} text-[#88f1d1]`}
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
                    className={`font-mono-tech ${FIELD} text-[#88f1d1]`}
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
                    placeholder={
                      editingMacro.actionType === 'chain'
                        ? 'wake, chrome, caffeine'
                        : 'npm run dev'
                    }
                    className={`font-mono-tech ${FIELD} text-[#88f1d1]`}
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
                            ? `0 0 0 2px #091319, 0 0 0 3.5px ${ACCENT_HEX[c]}`
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
                <div className="deck-scroll grid max-h-[78px] grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-1 overflow-y-auto rounded-xl border border-[#98c8ce24] bg-[#0a151c] p-1.5">
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
                          color: on ? ACCENT_HEX[editingMacro.color] : '#9cb4bb',
                          boxShadow: on
                            ? `inset 0 0 0 1px ${ACCENT_HEX[editingMacro.color]}66`
                            : 'none',
                        }}
                      >
                        <Ico className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="col-span-12 flex items-center justify-between border-t border-[#98c8ce24] pt-2.5">
              <button
                type="button"
                hidden={!existingMacro}
                onClick={() => handleDeleteMacro(editingMacro.id)}
                className={`flex items-center gap-1 rounded-full border border-[#ff5d6c]/40 bg-[#ff5d6c]/10 px-3 py-1.5 text-xs font-bold text-[#ff5d6c] ${FOCUS}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete macro
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingMacro(null)}
                  className={`rounded-full border border-[#98c8ce29] bg-[#bcfff20d] px-3.5 py-1.5 text-xs font-bold text-[#effaf7] ${FOCUS}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`rounded-full bg-[#88f1d1] px-4 py-1.5 text-xs font-extrabold text-[#08221c] disabled:opacity-50 ${FOCUS}`}
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
