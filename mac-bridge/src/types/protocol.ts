export type ProfileId = 'antigravity' | 'vscode' | 'chrome' | 'terminal' | 'general';

export type MacroActionType = 'shortcut' | 'shell' | 'snippet' | 'terminal' | 'stream' | 'voice';

export interface MacroButton {
  id: string;
  profileId: ProfileId;
  label: string;
  sublabel?: string;
  icon: string;
  color: 'emerald' | 'crimson' | 'amber' | 'cyan' | 'violet' | 'slate';
  actionType: MacroActionType;
  /** Shortcut id, whitelisted shell cmd, terminal cmd, log preset id, snippet text, or 'autoPaste' */
  payload: string;
}

export interface DeckProfile {
  id: ProfileId;
  name: string;
  matchApps: string[];
  accent: 'emerald' | 'cyan' | 'amber' | 'violet';
}

export interface SnippetItem {
  id: string;
  label: string;
  category: 'test-data' | 'code' | 'custom';
  value: string;
  autoPaste: boolean;
}

export interface LogPreset {
  id: string;
  label: string;
  command: string;
  args: string[];
}

export interface DevDeckPublicConfig {
  profiles: DeckProfile[];
  macros: MacroButton[];
  snippets: SnippetItem[];
  logPresets: LogPreset[];
  projectDir: string;
  scansDir: string;
  deployCommand: string;
  previewUrl: string;
}

export interface SystemStats {
  cpuPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPct: number;
  netRxKBs: number;
  netTxKBs: number;
  ts: number;
}

export interface ActivePort {
  port: number;
  pid: number;
  process: string;
  address: string;
}

export interface LogLine {
  id: string;
  stream: 'stdout' | 'stderr';
  text: string;
  level: 'info' | 'warn' | 'error' | 'success';
  ts: number;
}

export interface LogStatus {
  running: boolean;
  presetId: string | null;
  command: string | null;
  pid: number | null;
  exitCode: number | null;
}

export interface GitStatus {
  isGitRepo: boolean;
  repoName: string;
  path: string;
  branch: string;
  uncommitted: number;
  ahead: number;
  behind: number;
  files: string[];
  lastUpdated: number;
}

export interface WebhookEvent {
  id: string;
  ts: number;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  statusCode: number;
  latencyMs: number;
}

export interface ClipboardItem {
  id: string;
  text: string;
  ts: number;
}

export interface FocusState {
  active: boolean;
  remainingSec: number;
  totalSec: number;
  dndEnabled: boolean;
}

export interface MediaState {
  volume: number;
  muted: boolean;
  brightness: number;
  playing: boolean;
  track: string;
  artist: string;
  player: string;
}

export interface BridgeHello {
  hostname: string;
  lanIp: string;
  bridgePort: number;
  pwaPort: number;
  projectDir: string;
  version: string;
}

export type AgentNotificationStatus = 'info' | 'success' | 'warning' | 'error' | 'approval';

export interface AgentNotification {
  id: string;
  title: string;
  message: string;
  status: AgentNotificationStatus;
  ts: number;
}

export type ServerEvent =
  | { type: 'hello'; payload: BridgeHello }
  | { type: 'config:sync'; payload: DevDeckPublicConfig }
  | { type: 'stats:update'; payload: SystemStats }
  | { type: 'app:active'; payload: { appName: string; profileId: ProfileId; ts: number } }
  | { type: 'ports:update'; payload: { ports: ActivePort[] } }
  | { type: 'logs:line'; payload: LogLine }
  | { type: 'logs:status'; payload: LogStatus }
  | { type: 'git:status'; payload: GitStatus }
  | { type: 'webhook:event'; payload: WebhookEvent }
  | { type: 'clipboard:update'; payload: { current: string; history: ClipboardItem[] } }
  | { type: 'focus:state'; payload: FocusState }
  | { type: 'media:state'; payload: MediaState }
  | { type: 'preview:url'; payload: { url: string; label: string } }
  | { type: 'alert:flash'; payload: { kind: 'success' | 'error' | 'warning'; message: string } }
  | { type: 'agent:notification'; payload: AgentNotification }
  | { type: 'action:result'; payload: { requestId: string; ok: boolean; message: string; data?: unknown } };

export type ClientEvent =
  | { type: 'macro:execute'; payload: { requestId: string; macroId: string } }
  | { type: 'macro:upsert'; payload: { requestId: string; macro: MacroButton } }
  | { type: 'macro:delete'; payload: { requestId: string; macroId: string } }
  | { type: 'snippet:inject'; payload: { requestId: string; text: string; autoPaste: boolean } }
  | { type: 'snippet:upsert'; payload: { requestId: string; snippet: SnippetItem } }
  | { type: 'snippet:delete'; payload: { requestId: string; snippetId: string } }
  | { type: 'port:kill'; payload: { requestId: string; pid: number; port: number } }
  | { type: 'ports:refresh'; payload: { requestId: string } }
  | { type: 'logs:start'; payload: { requestId: string; presetId: string } }
  | { type: 'logs:stop'; payload: { requestId: string } }
  | { type: 'git:refresh'; payload: { requestId: string } }
  | { type: 'git:deploy'; payload: { requestId: string; action: 'push' | 'deploy' } }
  | { type: 'webhook:replay'; payload: { requestId: string; eventId: string; targetBaseUrl?: string } }
  | { type: 'webhook:copy'; payload: { requestId: string; eventId: string } }
  | { type: 'hardware:dial'; payload: { mode: 'volume' | 'brightness' | 'scroll'; delta: number; value?: number } }
  | { type: 'hardware:mute'; payload: { requestId: string; muted: boolean } }
  | { type: 'hardware:lock'; payload: { requestId: string } }
  | { type: 'voice:transcript'; payload: { requestId: string; text: string; autoPaste: boolean } }
  | { type: 'focus:start'; payload: { requestId: string; durationMin: number } }
  | { type: 'focus:stop'; payload: { requestId: string } }
  | { type: 'clipboard:copy'; payload: { requestId: string; text: string; autoPaste?: boolean } }
  | { type: 'media:control'; payload: { requestId: string; action: 'playpause' | 'next' | 'prev' } }
  | { type: 'preview:set'; payload: { requestId: string; url: string } };
