import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WindowSnapPosition = 'left' | 'right' | 'maximize' | 'center' | 'top' | 'bottom';

export async function snapFrontmostWindow(position: WindowSnapPosition): Promise<string> {
  // Get primary display desktop bounds via Finder, then resize/position frontmost window via System Events
  const script = `
    tell application "Finder"
      set screenBounds to bounds of window of desktop
    end tell
    set sx to item 1 of screenBounds
    set sy to item 2 of screenBounds
    set sw to item 3 of screenBounds
    set sh to item 4 of screenBounds
    set menuBar to 28
    set usableH to sh - menuBar

    if "${position}" is "left" then
      set tx to sx
      set ty to menuBar
      set tw to round (sw / 2)
      set th to usableH
    else if "${position}" is "right" then
      set tx to sx + (round (sw / 2))
      set ty to menuBar
      set tw to round (sw / 2)
      set th to usableH
    else if "${position}" is "maximize" then
      set tx to sx
      set ty to menuBar
      set tw to sw
      set th to usableH
    else if "${position}" is "center" then
      set tw to round (sw * 0.8)
      set th to round (usableH * 0.84)
      set tx to sx + (round ((sw - tw) / 2))
      set ty to menuBar + (round ((usableH - th) / 2))
    else if "${position}" is "top" then
      set tx to sx
      set ty to menuBar
      set tw to sw
      set th to round (usableH / 2)
    else
      set tx to sx
      set ty to menuBar + (round (usableH / 2))
      set tw to sw
      set th to round (usableH / 2)
    end if

    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      tell frontApp
        if (count of windows) > 0 then
          set position of window 1 to {tx, ty}
          set size of window 1 to {tw, th}
          return (name of frontApp) & " snapped to ${position}"
        else
          return "No active window to snap"
        end if
      end tell
    end tell
  `;

  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2500 });
  return stdout.trim() || `Snapped window to ${position}`;
}
