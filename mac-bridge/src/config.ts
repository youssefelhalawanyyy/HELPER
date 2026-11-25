import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeckProfile,
  DevDeckPublicConfig,
  LogPreset,
  MacroButton,
  SnippetItem,
} from './types/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BRIDGE_ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DEFAULT_SCANS_DIR = path.join(BRIDGE_ROOT, 'scans');
const DEFAULT_PROJECT_DIR = path.resolve(BRIDGE_ROOT, '..');

export interface PersistedConfig extends DevDeckPublicConfig {
  token: string;
}

const DEFAULT_PROFILES: DeckProfile[] = [
  {
    id: 'antigravity',
    name: 'Antigravity',
    matchApps: ['Antigravity IDE', 'Antigravity', 'Google Antigravity'],
    accent: 'cyan',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    matchApps: ['Code', 'Visual Studio Code', 'Code - Insiders', 'Cursor', 'Windsurf'],
    accent: 'violet',
  },
  {
    id: 'chrome',
    name: 'Browser',
    matchApps: ['Google Chrome', 'Arc', 'Safari', 'Brave Browser', 'Firefox'],
    accent: 'amber',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    matchApps: ['Terminal', 'iTerm2', 'Warp', 'Ghostty', 'Alacritty', 'kitty'],
    accent: 'emerald',
  },
  { id: 'music', name: 'Music', matchApps: ['Spotify', 'Music', 'Apple Music'], accent: 'emerald' },
  {
    id: 'general',
    name: 'General',
    matchApps: [],
    accent: 'violet',
  },
];

const DEFAULT_MACROS: MacroButton[] = [
  {
    id: 'morning-setup',
    profileId: 'general',
    label: 'Morning Setup',
    sublabel: 'Start workspace',
    icon: 'Sun',
    color: 'amber',
    actionType: 'chain',
    payload: 'wake, antigravity, chrome, dev-server, caffeine',
  },
  ...(['prev', 'playpause', 'next'] as const).map(
    (action): MacroButton => ({
      id: 'music-' + action,
      profileId: 'music',
      label: { prev: 'Previous', playpause: 'Play / pause', next: 'Next' }[action],
      sublabel: 'Playback',
      icon: 'Music',
      color: 'emerald',
      actionType: 'shortcut',
      payload: 'media.' + action,
    }),
  ),
  // Antigravity profile
  {
    id: 'ag-agent-chat',
    profileId: 'antigravity',
    label: 'Agent Chat',
    sublabel: '⌘L',
    icon: 'Bot',
    color: 'cyan',
    actionType: 'shortcut',
    payload: 'antigravity.agentChat',
  },
  {
    id: 'ag-accept-changes',
    profileId: 'antigravity',
    label: 'Accept All',
    sublabel: '⌘↵',
    icon: 'CheckCircle2',
    color: 'emerald',
    actionType: 'shortcut',
    payload: 'antigravity.acceptChanges',
  },
  {
    id: 'ag-reject-changes',
    profileId: 'antigravity',
    label: 'Reject Diff',
    sublabel: '⌘⌫',
    icon: 'XCircle',
    color: 'crimson',
    actionType: 'shortcut',
    payload: 'antigravity.rejectChanges',
  },
  {
    id: 'ag-toggle-terminal',
    profileId: 'antigravity',
    label: 'Toggle Term',
    sublabel: '⌃`',
    icon: 'Terminal',
    color: 'amber',
    actionType: 'shortcut',
    payload: 'antigravity.toggleTerminal',
  },
  {
    id: 'ag-voice-prompt',
    profileId: 'antigravity',
    label: 'Voice Prompt',
    sublabel: 'Auto-Paste',
    icon: 'Mic',
    color: 'cyan',
    actionType: 'voice',
    payload: 'autoPaste',
  },
  {
    id: 'ag-new-agent',
    profileId: 'antigravity',
    label: 'New Agent',
    sublabel: '⇧⌘L',
    icon: 'Sparkles',
    color: 'violet',
    actionType: 'shortcut',
    payload: 'antigravity.newAgent',
  },
  {
    id: 'ag-cmd-palette',
    profileId: 'antigravity',
    label: 'Cmd Palette',
    sublabel: '⇧⌘P',
    icon: 'Command',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'antigravity.commandPalette',
  },
  {
    id: 'ag-stream-typecheck',
    profileId: 'antigravity',
    label: 'Stream Check',
    sublabel: 'PWA Logs',
    icon: 'Play',
    color: 'emerald',
    actionType: 'stream',
    payload: 'preset-typecheck',
  },

  // VS Code profile
  {
    id: 'vscode-format',
    profileId: 'vscode',
    label: 'Format Doc',
    sublabel: '⇧⌥F',
    icon: 'Wand2',
    color: 'cyan',
    actionType: 'shortcut',
    payload: 'vscode.format',
  },
  {
    id: 'vscode-terminal',
    profileId: 'vscode',
    label: 'Toggle Term',
    sublabel: '⌃`',
    icon: 'Terminal',
    color: 'emerald',
    actionType: 'shortcut',
    payload: 'vscode.toggleTerminal',
  },
  {
    id: 'vscode-palette',
    profileId: 'vscode',
    label: 'Cmd Palette',
    sublabel: '⇧⌘P',
    icon: 'Command',
    color: 'violet',
    actionType: 'shortcut',
    payload: 'vscode.commandPalette',
  },
  {
    id: 'vscode-git-pull',
    profileId: 'vscode',
    label: 'Git Pull',
    sublabel: 'origin',
    icon: 'GitPullRequest',
    color: 'amber',
    actionType: 'shell',
    payload: 'git pull --ff-only',
  },
  {
    id: 'vscode-save-all',
    profileId: 'vscode',
    label: 'Save All',
    sublabel: '⌥⌘S',
    icon: 'Save',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'vscode.saveAll',
  },
  {
    id: 'vscode-run-build',
    profileId: 'vscode',
    label: 'Typecheck',
    sublabel: 'npm',
    icon: 'Play',
    color: 'emerald',
    actionType: 'shell',
    payload: 'npm run typecheck',
  },
  {
    id: 'vscode-quick-open',
    profileId: 'vscode',
    label: 'Quick Open',
    sublabel: '⌘P',
    icon: 'Search',
    color: 'cyan',
    actionType: 'shortcut',
    payload: 'vscode.quickOpen',
  },
  {
    id: 'vscode-sidebar',
    profileId: 'vscode',
    label: 'Sidebar',
    sublabel: '⌘B',
    icon: 'PanelLeft',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'vscode.toggleSidebar',
  },

  // Chrome / Browser profile
  {
    id: 'chrome-hard-reload',
    profileId: 'chrome',
    label: 'Hard Reload',
    sublabel: '⇧⌘R',
    icon: 'RefreshCw',
    color: 'amber',
    actionType: 'shortcut',
    payload: 'chrome.hardReload',
  },
  {
    id: 'chrome-devtools',
    profileId: 'chrome',
    label: 'DevTools',
    sublabel: '⌥⌘I',
    icon: 'Code2',
    color: 'cyan',
    actionType: 'shortcut',
    payload: 'chrome.devTools',
  },
  {
    id: 'chrome-responsive',
    profileId: 'chrome',
    label: 'Device Mode',
    sublabel: '⇧⌘M',
    icon: 'Smartphone',
    color: 'violet',
    actionType: 'shortcut',
    payload: 'chrome.responsiveToggle',
  },
  {
    id: 'chrome-new-tab',
    profileId: 'chrome',
    label: 'New Tab',
    sublabel: '⌘T',
    icon: 'Plus',
    color: 'emerald',
    actionType: 'shortcut',
    payload: 'chrome.newTab',
  },
  {
    id: 'chrome-close-tab',
    profileId: 'chrome',
    label: 'Close Tab',
    sublabel: '⌘W',
    icon: 'X',
    color: 'crimson',
    actionType: 'shortcut',
    payload: 'chrome.closeTab',
  },
  {
    id: 'chrome-console',
    profileId: 'chrome',
    label: 'JS Console',
    sublabel: '⌥⌘J',
    icon: 'TerminalSquare',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'chrome.console',
  },

  // Terminal profile (supports both PWA background streaming AND active macOS Terminal AppleScript)
  {
    id: 'term-stream-check',
    profileId: 'terminal',
    label: 'Stream Check',
    sublabel: 'PWA Stream',
    icon: 'Radio',
    color: 'emerald',
    actionType: 'stream',
    payload: 'preset-typecheck',
  },
  {
    id: 'term-stream-demo',
    profileId: 'terminal',
    label: 'Stream Logs',
    sublabel: 'PWA Stream',
    icon: 'Activity',
    color: 'cyan',
    actionType: 'stream',
    payload: 'preset-heartbeat',
  },
  {
    id: 'term-send-git',
    profileId: 'terminal',
    label: 'Mac: git st',
    sublabel: 'Terminal.app',
    icon: 'GitBranch',
    color: 'amber',
    actionType: 'terminal',
    payload: 'git status -sb',
  },
  {
    id: 'term-send-dev',
    profileId: 'terminal',
    label: 'Mac: npm dev',
    sublabel: 'Terminal.app',
    icon: 'Send',
    color: 'violet',
    actionType: 'terminal',
    payload: 'npm run dev',
  },
  {
    id: 'term-clear',
    profileId: 'terminal',
    label: 'Clear',
    sublabel: '⌘K',
    icon: 'Eraser',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'terminal.clear',
  },
  {
    id: 'term-sigint',
    profileId: 'terminal',
    label: 'Kill Proc',
    sublabel: '⌃C',
    icon: 'OctagonX',
    color: 'crimson',
    actionType: 'shortcut',
    payload: 'terminal.killProcess',
  },
  {
    id: 'term-new-tab',
    profileId: 'terminal',
    label: 'New Tab',
    sublabel: '⌘T',
    icon: 'Plus',
    color: 'emerald',
    actionType: 'shortcut',
    payload: 'terminal.newTab',
  },
  {
    id: 'term-restart-hint',
    profileId: 'terminal',
    label: 'Repeat Last',
    sublabel: '↑ ↵',
    icon: 'RotateCcw',
    color: 'amber',
    actionType: 'shortcut',
    payload: 'terminal.repeatLast',
  },

  // General profile
  {
    id: 'gen-screenshot',
    profileId: 'general',
    label: 'Screenshot',
    sublabel: '⇧⌘4',
    icon: 'Camera',
    color: 'cyan',
    actionType: 'shortcut',
    payload: 'system.screenshotSelection',
  },
  {
    id: 'gen-spotlight',
    profileId: 'general',
    label: 'Spotlight',
    sublabel: '⌘Space',
    icon: 'Search',
    color: 'violet',
    actionType: 'shortcut',
    payload: 'system.spotlight',
  },
  {
    id: 'gen-copy',
    profileId: 'general',
    label: 'Copy',
    sublabel: '⌘C',
    icon: 'Copy',
    color: 'slate',
    actionType: 'shortcut',
    payload: 'system.copy',
  },
  {
    id: 'gen-paste',
    profileId: 'general',
    label: 'Paste',
    sublabel: '⌘V',
    icon: 'ClipboardPaste',
    color: 'emerald',
    actionType: 'shortcut',
    payload: 'system.paste',
  },
  {
    id: 'gen-mute',
    profileId: 'general',
    label: 'Mute Mac',
    sublabel: 'Audio',
    icon: 'VolumeX',
    color: 'amber',
    actionType: 'shortcut',
    payload: 'system.toggleMute',
  },
  {
    id: 'gen-lock',
    profileId: 'general',
    label: 'Lock Mac',
    sublabel: 'Sleep',
    icon: 'Lock',
    color: 'crimson',
    actionType: 'shortcut',
    payload: 'system.lockScreen',
  },
];

const DEFAULT_SNIPPETS: SnippetItem[] = [
  {
    id: 'snip-uuid',
    label: 'Random UUID v4',
    category: 'test-data',
    value: '{{uuid}}',
    autoPaste: true,
  },
  {
    id: 'snip-email',
    label: 'Dummy Dev Email',
    category: 'test-data',
    value: '{{email}}',
    autoPaste: true,
  },
  {
    id: 'snip-card',
    label: 'Stripe Test Card',
    category: 'test-data',
    value: '4242 4242 4242 4242',
    autoPaste: true,
  },
  {
    id: 'snip-lorem',
    label: 'Lorem Paragraph',
    category: 'test-data',
    value:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    autoPaste: true,
  },
  {
    id: 'snip-iso',
    label: 'ISO Timestamp',
    category: 'test-data',
    value: '{{iso}}',
    autoPaste: true,
  },
  {
    id: 'snip-console',
    label: 'Console JSON Log',
    category: 'code',
    value: 'console.log(JSON.stringify(data, null, 2));',
    autoPaste: true,
  },
];

const DEFAULT_LOG_PRESETS: LogPreset[] = [
  {
    id: 'preset-typecheck',
    label: 'Monorepo Typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
  },
  {
    id: 'preset-build-bridge',
    label: 'Build Bridge',
    command: 'npm',
    args: ['run', 'build', '-w', 'mac-bridge'],
  },
  {
    id: 'preset-git-log',
    label: 'Git Log (20)',
    command: 'git',
    args: ['log', '--oneline', '-n', '20'],
  },
  {
    id: 'preset-heartbeat',
    label: 'Dev Log Demo',
    command: 'node',
    args: [
      '-e',
      "let i=0; const t=setInterval(()=>{i++; if(i===3) console.error('ERROR: Simulated compile failure in src/app.ts'); else if(i===5) console.log('SUCCESS: Build compiled cleanly in 142ms'); else console.log('[devdeck] tick', i, new Date().toISOString()); if(i>=8) clearInterval(t);}, 1200);",
    ],
  },
];

export class ConfigStore {
  private config: PersistedConfig;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DEFAULT_SCANS_DIR, { recursive: true });
    this.config = this.loadOrInit();
  }

  private loadOrInit(): PersistedConfig {
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedConfig>;

        // Ensure newly added default profiles (e.g. antigravity) are merged cleanly
        const existingProfiles = parsed.profiles?.length ? [...parsed.profiles] : [];
        const addMusic = !existingProfiles.some((p) => p.id === 'music');
        for (const defProfile of DEFAULT_PROFILES) {
          if (!existingProfiles.some((p) => p.id === defProfile.id)) {
            if (defProfile.id === 'antigravity') existingProfiles.unshift(defProfile);
            else existingProfiles.push(defProfile);
          }
        }

        // Ensure Antigravity and new Terminal stream/AppleScript default macros exist if profile has none
        const existingMacros = parsed.macros?.length ? [...parsed.macros] : [...DEFAULT_MACROS];
        if (addMusic)
          existingMacros.push(
            ...DEFAULT_MACROS.filter(
              (m) =>
                (m.profileId === 'music' || m.id === 'morning-setup') &&
                !existingMacros.some((e) => e.id === m.id),
            ),
          );
        if (!existingMacros.some((m) => m.profileId === 'antigravity')) {
          existingMacros.unshift(...DEFAULT_MACROS.filter((m) => m.profileId === 'antigravity'));
        }
        if (!existingMacros.some((m) => m.profileId === 'terminal' && m.actionType === 'terminal')) {
          existingMacros.push(
            ...DEFAULT_MACROS.filter(
              (m) =>
                m.profileId === 'terminal' &&
                (m.actionType === 'terminal' || m.actionType === 'stream') &&
                !existingMacros.some((e) => e.id === m.id),
            ),
          );
        }

        const merged: PersistedConfig = {
          token: parsed.token || crypto.randomBytes(24).toString('hex'),
          profiles: existingProfiles,
          macros: existingMacros,
          snippets: parsed.snippets?.length ? parsed.snippets : DEFAULT_SNIPPETS,
          logPresets: parsed.logPresets?.length ? parsed.logPresets : DEFAULT_LOG_PRESETS,
          projectDir: parsed.projectDir || process.env.DEVDECK_PROJECT_DIR || DEFAULT_PROJECT_DIR,
          scansDir: parsed.scansDir || DEFAULT_SCANS_DIR,
          deployCommand: parsed.deployCommand || 'git push',
          previewUrl: parsed.previewUrl || 'http://localhost:3000',
        };
        this.save(merged);
        return merged;
      } catch {
        // Fall through to fresh config if JSON is corrupted
      }
    }

    const fresh: PersistedConfig = {
      token: crypto.randomBytes(24).toString('hex'),
      profiles: DEFAULT_PROFILES,
      macros: DEFAULT_MACROS,
      snippets: DEFAULT_SNIPPETS,
      logPresets: DEFAULT_LOG_PRESETS,
      projectDir: process.env.DEVDECK_PROJECT_DIR || DEFAULT_PROJECT_DIR,
      scansDir: DEFAULT_SCANS_DIR,
      deployCommand: 'git push',
      previewUrl: 'http://localhost:3000',
    };
    this.save(fresh);
    return fresh;
  }

  private save(cfg: PersistedConfig): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  }

  getAll(): PersistedConfig {
    return this.config;
  }

  getPublic(): DevDeckPublicConfig {
    const { token: _token, ...pub } = this.config;
    return pub;
  }

  getToken(): string {
    return this.config.token;
  }

  upsertMacro(macro: MacroButton): MacroButton {
    const idx = this.config.macros.findIndex((m) => m.id === macro.id);
    if (idx >= 0) {
      this.config.macros[idx] = macro;
    } else {
      this.config.macros.push(macro);
    }
    this.save(this.config);
    return macro;
  }

  deleteMacro(macroId: string): boolean {
    const before = this.config.macros.length;
    this.config.macros = this.config.macros.filter((m) => m.id !== macroId);
    if (this.config.macros.length !== before) {
      this.save(this.config);
      return true;
    }
    return false;
  }

  upsertSnippet(snippet: SnippetItem): SnippetItem {
    const idx = this.config.snippets.findIndex((s) => s.id === snippet.id);
    if (idx >= 0) {
      this.config.snippets[idx] = snippet;
    } else {
      this.config.snippets.push(snippet);
    }
    this.save(this.config);
    return snippet;
  }

  deleteSnippet(snippetId: string): boolean {
    const before = this.config.snippets.length;
    this.config.snippets = this.config.snippets.filter((s) => s.id !== snippetId);
    if (this.config.snippets.length !== before) {
      this.save(this.config);
      return true;
    }
    return false;
  }

  updateSettings(
    patch: Partial<Pick<DevDeckPublicConfig, 'projectDir' | 'deployCommand' | 'previewUrl'>>,
  ): DevDeckPublicConfig {
    if (patch.projectDir && fs.existsSync(patch.projectDir)) {
      this.config.projectDir = patch.projectDir;
    }
    if (typeof patch.deployCommand === 'string' && patch.deployCommand.trim()) {
      this.config.deployCommand = patch.deployCommand.trim();
    }
    if (typeof patch.previewUrl === 'string' && /^https?:\/\//i.test(patch.previewUrl.trim())) {
      this.config.previewUrl = patch.previewUrl.trim();
    }
    this.save(this.config);
    return this.getPublic();
  }
}
