import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_WIN, sendWinKeystroke, sendWinVirtualKey } from '../platform/win32.js';
import { captureSelectionToClipboard, lockMacScreen, toggleMacMute } from './hardware.js';
import { sendNativeMacKey } from './remoteControl.js';

const execFileAsync = promisify(execFile);

// Instant (<0.1ms) macOS CoreGraphics virtual keycodes + modifier mask (1=Cmd, 2=Shift, 4=Opt, 8=Ctrl)
const MAC_NATIVE_KEYS: Record<string, [number, number]> = {
  'nav.back': [33, 1], // Cmd+[
  'nav.forward': [30, 1], // Cmd+]
  'nav.switchApp': [48, 1], // Cmd+Tab
  'nav.missionControl': [126, 8], // Ctrl+Up
  'nav.up': [126, 0],
  'nav.down': [125, 0],
  'nav.left': [123, 0],
  'nav.right': [124, 0],
  'nav.enter': [36, 0],
  'nav.escape': [53, 0],
  'nav.space': [49, 0],
  'nav.backspace': [51, 0],
  'system.copy': [8, 1], // Cmd+C
  'system.paste': [9, 1], // Cmd+V
  'system.undo': [6, 1], // Cmd+Z
  'chrome.newTab': [17, 1], // Cmd+T
  'chrome.closeTab': [13, 1], // Cmd+W
};

const APPLESCRIPT_SHORTCUTS: Record<string, string> = {
  // Antigravity IDE
  'antigravity.agentChat': 'tell application "System Events" to keystroke "l" using {command down}',
  'antigravity.newAgent': 'tell application "System Events" to keystroke "l" using {shift down, command down}',
  'antigravity.acceptChanges': 'tell application "System Events" to key code 36 using {command down}',
  'antigravity.rejectChanges': 'tell application "System Events" to key code 51 using {command down}',
  'antigravity.toggleTerminal': 'tell application "System Events" to keystroke "`" using {control down}',
  'antigravity.commandPalette': 'tell application "System Events" to keystroke "p" using {shift down, command down}',

  // VS Code / Cursor
  'vscode.format': 'tell application "System Events" to keystroke "f" using {shift down, option down}',
  'vscode.toggleTerminal': 'tell application "System Events" to keystroke "`" using {control down}',
  'vscode.commandPalette': 'tell application "System Events" to keystroke "p" using {shift down, command down}',
  'vscode.saveAll': 'tell application "System Events" to keystroke "s" using {option down, command down}',
  'vscode.quickOpen': 'tell application "System Events" to keystroke "p" using {command down}',
  'vscode.toggleSidebar': 'tell application "System Events" to keystroke "b" using {command down}',

  // Chrome / Browser
  'chrome.hardReload': 'tell application "System Events" to keystroke "r" using {shift down, command down}',
  'chrome.devTools': 'tell application "System Events" to keystroke "i" using {option down, command down}',
  'chrome.responsiveToggle': 'tell application "System Events" to keystroke "m" using {shift down, command down}',
  'chrome.newTab': 'tell application "System Events" to keystroke "t" using {command down}',
  'chrome.closeTab': 'tell application "System Events" to keystroke "w" using {command down}',
  'chrome.console': 'tell application "System Events" to keystroke "j" using {option down, command down}',

  // Terminal
  'terminal.clear': 'tell application "System Events" to keystroke "k" using {command down}',
  'terminal.killProcess': 'tell application "System Events" to keystroke "c" using {control down}',
  'terminal.newTab': 'tell application "System Events" to keystroke "t" using {command down}',
  'terminal.repeatLast':
    'tell application "System Events" to key code 126\ndelay 0.05\ntell application "System Events" to key code 36',

  // General macOS
  'system.screenshotSelection':
    'tell application "System Events" to keystroke "4" using {shift down, command down}',
  'system.spotlight': 'tell application "System Events" to key code 49 using {command down}',
  'system.copy': 'tell application "System Events" to keystroke "c" using {command down}',
  'system.paste': 'tell application "System Events" to keystroke "v" using {command down}',
  'system.undo': 'tell application "System Events" to keystroke "z" using {command down}',

  // Game-Controller / Navigation Pad
  'nav.back': 'tell application "System Events" to keystroke "[" using {command down}',
  'nav.forward': 'tell application "System Events" to keystroke "]" using {command down}',
  'nav.switchApp': 'tell application "System Events" to key code 48 using {command down}',
  'nav.missionControl': 'tell application "System Events" to key code 126 using {control down}',
  'nav.up': 'tell application "System Events" to key code 126',
  'nav.down': 'tell application "System Events" to key code 125',
  'nav.left': 'tell application "System Events" to key code 123',
  'nav.right': 'tell application "System Events" to key code 124',
  'nav.enter': 'tell application "System Events" to key code 36',
  'nav.escape': 'tell application "System Events" to key code 53',
  'nav.space': 'tell application "System Events" to key code 49',
  'nav.backspace': 'tell application "System Events" to key code 51',
};

const WINDOWS_SHORTCUTS: Record<string, string> = {
  // Antigravity IDE (Windows uses Ctrl)
  'antigravity.agentChat': '^l',
  'antigravity.newAgent': '^+l',
  'antigravity.acceptChanges': '^{ENTER}',
  'antigravity.rejectChanges': '^{BACKSPACE}',
  'antigravity.toggleTerminal': '^`',
  'antigravity.commandPalette': '^+p',

  // VS Code / Cursor
  'vscode.format': '+%f',
  'vscode.toggleTerminal': '^`',
  'vscode.commandPalette': '^+p',
  'vscode.saveAll': '^ks',
  'vscode.quickOpen': '^p',
  'vscode.toggleSidebar': '^b',

  // Chrome / Edge
  'chrome.hardReload': '^+r',
  'chrome.devTools': '^+i',
  'chrome.responsiveToggle': '^+m',
  'chrome.newTab': '^t',
  'chrome.closeTab': '^w',
  'chrome.console': '^+j',

  // Terminal
  'terminal.clear': 'cls{ENTER}',
  'terminal.killProcess': '^c',
  'terminal.newTab': '^+t',
  'terminal.repeatLast': '{UP}{ENTER}',

  // General Windows
  'system.copy': '^c',
  'system.paste': '^v',
  'system.undo': '^z',

  // Game-Controller / Navigation Pad (Windows)
  'nav.back': '%{LEFT}',
  'nav.forward': '%{RIGHT}',
  'nav.switchApp': '%{TAB}',
  'nav.missionControl': '^{ESC}',
  'nav.up': '{UP}',
  'nav.down': '{DOWN}',
  'nav.left': '{LEFT}',
  'nav.right': '{RIGHT}',
  'nav.enter': '{ENTER}',
  'nav.escape': '{ESC}',
  'nav.space': ' ',
  'nav.backspace': '{BACKSPACE}',
};

export function isKnownShortcut(shortcutId: string): boolean {
  return (
    shortcutId in APPLESCRIPT_SHORTCUTS ||
    shortcutId === 'system.toggleMute' ||
    shortcutId === 'system.lockScreen'
  );
}

export async function runShortcut(shortcutId: string): Promise<string> {
  if (shortcutId === 'system.screenshotSelection') {
    captureSelectionToClipboard();
    return IS_WIN
      ? 'Windows Snipping Tool active → will copy to clipboard'
      : 'Screenshot selection active → will copy to Mac clipboard';
  }
  if (shortcutId === 'system.toggleMute') {
    const muted = await toggleMacMute();
    return muted ? 'Audio muted' : 'Audio unmuted';
  }
  if (shortcutId === 'system.lockScreen') {
    await lockMacScreen();
    return 'Display locked';
  }

  if (IS_WIN) {
    if (shortcutId === 'system.spotlight') {
      await sendWinVirtualKey('0x5B'); // VK_LWIN -> Start Search
      return 'Opened Windows Search';
    }
    const expr = WINDOWS_SHORTCUTS[shortcutId];
    if (!expr) {
      throw new Error(`Unknown shortcut identifier: ${shortcutId}`);
    }
    await sendWinKeystroke(expr);
    return `Triggered ${shortcutId}`;
  }

  // Fast path on macOS: <0.1ms native CoreGraphics daemon (zero osascript spawn delay!)
  const nativeSpec = MAC_NATIVE_KEYS[shortcutId];
  if (nativeSpec) {
    const sent = await sendNativeMacKey(nativeSpec[0], nativeSpec[1]);
    if (sent) return `Triggered ${shortcutId}`;
  }

  const script = APPLESCRIPT_SHORTCUTS[shortcutId];
  if (!script) {
    throw new Error(`Unknown shortcut identifier: ${shortcutId}`);
  }

  await execFileAsync('osascript', ['-e', script], { timeout: 2500 });
  return `Triggered ${shortcutId}`;
}
