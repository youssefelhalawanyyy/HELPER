import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WindowSnapPosition = 'left' | 'right' | 'maximize' | 'center' | 'top' | 'bottom';

export async function snapFrontmostWindow(position: WindowSnapPosition): Promise<string> {
  // Uses AppKit NSScreen.visibleFrame (instant, zero Finder dependency, respects Menu Bar + Dock)
  const jxa = `
    ObjC.import('AppKit');
    const screen = $.NSScreen.mainScreen;
    const frame = screen.frame;
    const vis = screen.visibleFrame;
    const sx = Math.round(vis.origin.x);
    const sy = Math.round(frame.size.height - (vis.origin.y + vis.size.height));
    const sw = Math.round(vis.size.width);
    const sh = Math.round(vis.size.height);

    let tx = sx, ty = sy, tw = sw, th = sh;
    const pos = "${position}";
    if (pos === "left") {
      tw = Math.round(sw / 2);
    } else if (pos === "right") {
      tw = Math.round(sw / 2);
      tx = sx + tw;
    } else if (pos === "center") {
      tw = Math.round(sw * 0.8);
      th = Math.round(sh * 0.86);
      tx = sx + Math.round((sw - tw) / 2);
      ty = sy + Math.round((sh - th) / 2);
    } else if (pos === "top") {
      th = Math.round(sh / 2);
    } else if (pos === "bottom") {
      th = Math.round(sh / 2);
      ty = sy + th;
    }

    const se = Application('System Events');
    const procs = se.applicationProcesses.whose({ frontmost: true });
    if (procs.length === 0) {
      "No active app";
    } else {
      const frontApp = procs[0];
      const appName = frontApp.name();
      const wins = frontApp.windows();
      if (wins.length === 0) {
        appName + " has no resizable window";
      } else {
        const w = wins[0];
        w.position = [tx, ty];
        w.size = [tw, th];
        appName + " snapped to " + pos;
      }
    }
  `;

  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxa], {
      timeout: 6000,
    });
    return stdout.trim() || `Snapped window to ${position}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not allowed assistive access|1002|accessibility/i.test(msg)) {
      throw new Error('Enable Accessibility for Terminal in System Settings → Privacy & Security');
    }
    throw new Error(`Window snap failed: ${msg.slice(0, 100)}`);
  }
}
