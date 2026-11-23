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
  batteryPct: number | null;
  batteryCharging: boolean;
  ts: number;
}

export interface HeavyProcess {
  pid: number;
  name: string;
  cpuPct: number;
  memPct: number;
}

export interface DockerContainer {
  id: string;
  name: string;
  status: string;
  state: string;
}

export type WindowSnapPosition = 'left' | 'right' | 'maximize' | 'center' | 'top' | 'bottom';

export interface BluetoothDeviceInfo {
  name: string;
  connected: boolean;
  batteryPct: number | null;
}

export interface RecentFileInfo {
  name: string;
  folder: 'Downloads' | 'Desktop';
  sizeKb: number;
  mtime: number;
}

export interface ProjectScriptInfo {
  name: string;
  command: string;
}

export interface MacDeepTelemetry {
  // 1. Hardware, Power & Peripherals
  batteryHealthPct: number | null;
  batteryCycles: number | null;
  batteryTimeRemaining: string;
  batteryWattage: number | null;
  cpuCores: number[];
  uptimeSec: number;
  displays: string[];
  bluetoothDevices: BluetoothDeviceInfo[];
  // 2. Network & Connectivity
  wifiSsid: string;
  wifiSignalDbm: number | null;
  pingMs: number | null;
  vpnActive: boolean;
  lanIp: string;
  // 3. Active App, Browser & File Context
  activeWindowTitle: string;
  activeBrowserUrl: string;
  activeBrowserTitle: string;
  runningApps: string[];
  recentFiles: RecentFileInfo[];
  projectScripts: ProjectScriptInfo[];
  // 4. Audio, Display & System State
  micInputPct: number;
  micMuted: boolean;
  audioOutputDevice: string;
  darkMode: boolean;
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

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  ts: number;
}

export interface AgentProgress {
  title: string;
  step: string;
  percent: number;
  active: boolean;
  ts: number;
}

export interface GitDiffFile {
  file: string;
  added: number;
  removed: number;
}

export interface AntigravityStepItem {
  title: string;
  status: string;
}

export interface AntigravityFeedEvent {
  id: string;
  kind: 'user' | 'tool' | 'agent';
  label: string;
  detail: string;
  ts: number;
}

export interface AntigravityToolItem {
  name: string;
  summary: string;
  detail: string;
}

export interface AntigravityChatTurn {
  id: string;
  role: 'user' | 'agent';
  text: string;
  thinking?: string;
  tools: AntigravityToolItem[];
  model?: string;
  tokens?: number;
  ts: number;
}

export interface AntigravityTerminalRun {
  id: string;
  command: string;
  summary: string;
  status: 'running' | 'done' | 'error';
  exitCode?: number;
  output: string;
  ts: number;
}

export interface AntigravitySessionSummary {
  id: string;
  title: string;
  lastActivityTs: number;
  hasPlan: boolean;
}

export interface AntigravityFileDiff {
  file: string;
  patch: string;
  added: number;
  removed: number;
  ts: number;
}

export interface AntigravityLiveState {
  active: boolean;
  statusLabel: 'WORKING' | 'WAITING' | 'IDLE';
  lastActivityTs: number;
  conversationId: string;
  pinnedSessionId: string | null;
  sessions: AntigravitySessionSummary[];
  model: string;
  stepCount: number;
  contextTokens: number;
  currentFocus: string;
  lastUserPrompt: string;
  steps: AntigravityStepItem[];
  recentEvents: AntigravityFeedEvent[];
  chatTurns: AntigravityChatTurn[];
  terminalRuns: AntigravityTerminalRun[];
  artifactName: string;
  artifactPreview: string;
  diffFiles: GitDiffFile[];
  totalAdded: number;
  totalRemoved: number;
}

export interface SpeedTestState {
  running: boolean;
  downMbps: number | null;
  upMbps: number | null;
  pingMs: number | null;
  error?: string;
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
  | { type: 'agent:question'; payload: AgentQuestion | null }
  | { type: 'agent:progress'; payload: AgentProgress }
  | { type: 'antigravity:state'; payload: AntigravityLiveState }
  | { type: 'antigravity:diff'; payload: AntigravityFileDiff }
  | { type: 'speedtest:state'; payload: SpeedTestState }
  | { type: 'caffeine:state'; payload: { active: boolean } }
  | { type: 'processes:update'; payload: { processes: HeavyProcess[] } }
  | { type: 'docker:update'; payload: { available: boolean; containers: DockerContainer[] } }
  | { type: 'mac:telemetry'; payload: MacDeepTelemetry }
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
  | { type: 'hardware:wake'; payload: { requestId: string } }
  | { type: 'hardware:caffeine'; payload: { requestId: string; active: boolean } }
  | { type: 'window:snap'; payload: { requestId: string; position: WindowSnapPosition } }
  | { type: 'process:kill'; payload: { requestId: string; pid: number } }
  | { type: 'processes:refresh'; payload: { requestId: string } }
  | { type: 'docker:action'; payload: { requestId: string; id: string; action: 'start' | 'stop' | 'restart' } }
  | { type: 'docker:refresh'; payload: { requestId: string } }
  | { type: 'app:focus'; payload: { requestId: string; appName: string } }
  | { type: 'trackpad:move'; payload: { dx: number; dy: number; drag?: boolean } }
  | { type: 'trackpad:click'; payload: { button: 'left' | 'right' } }
  | { type: 'trackpad:drag'; payload: { down: boolean } }
  | { type: 'trackpad:scroll'; payload: { dx: number; dy: number } }
  | { type: 'presentation:key'; payload: { requestId: string; action: 'next' | 'prev' | 'start' | 'escape' } }
  | { type: 'system:toggleDarkMode'; payload: { requestId: string } }
  | { type: 'system:toggleMic'; payload: { requestId: string } }
  | { type: 'script:run'; payload: { requestId: string; scriptName: string } }
  | { type: 'telemetry:refresh'; payload: { requestId: string } }
  | { type: 'voice:transcript'; payload: { requestId: string; text: string; autoPaste: boolean } }
  | { type: 'focus:start'; payload: { requestId: string; durationMin: number } }
  | { type: 'focus:stop'; payload: { requestId: string } }
  | { type: 'clipboard:copy'; payload: { requestId: string; text: string; autoPaste?: boolean } }
  | { type: 'media:control'; payload: { requestId: string; action: 'playpause' | 'next' | 'prev' } }
  | { type: 'preview:set'; payload: { requestId: string; url: string } }
  | { type: 'agent:answer'; payload: { requestId: string; questionId: string; answer: string } }
  | { type: 'antigravity:slash'; payload: { requestId: string; command: string } }
  | { type: 'antigravity:prompt'; payload: { requestId: string; text: string; submit?: boolean } }
  | { type: 'antigravity:selectSession'; payload: { requestId: string; conversationId: string | null } }
  | { type: 'antigravity:diffFile'; payload: { requestId: string; file: string } }
  | { type: 'speedtest:run'; payload: { requestId: string } };
