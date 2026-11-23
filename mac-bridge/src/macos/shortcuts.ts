import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureSelectionToClipboard, lockMacScreen, toggleMacMute } from './hardware.js';

const execFileAsync = promisify(execFile);

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
    return 'Screenshot selection active → will copy to Mac clipboard';
  }
  if (shortcutId === 'system.toggleMute') {
    const muted = await toggleMacMute();
    return muted ? 'Mac muted' : 'Mac unmuted';
  }
  if (shortcutId === 'system.lockScreen') {
    await lockMacScreen();
    return 'Display locked';
  }

  const script = APPLESCRIPT_SHORTCUTS[shortcutId];
  if (!script) {
    throw new Error(`Unknown shortcut identifier: ${shortcutId}`);
  }

  await execFileAsync('osascript', ['-e', script], { timeout: 2500 });
  return `Triggered ${shortcutId}`;
}
