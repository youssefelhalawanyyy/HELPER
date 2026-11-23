import { setMacFocusMode } from '../macos/dnd.js';
import type { FocusState } from '../types/protocol.js';

export class FocusService {
  private timer: NodeJS.Timeout | null = null;
  private state: FocusState = {
    active: false,
    remainingSec: 25 * 60,
    totalSec: 25 * 60,
    dndEnabled: false,
  };

  constructor(
    private onUpdate: (state: FocusState) => void,
    private onComplete: (message: string) => void,
  ) {}

  getState(): FocusState {
    return this.state;
  }

  async start(durationMin = 25): Promise<string> {
    this.clearTimer();
    const clampedMin = Math.max(1, Math.min(180, Math.round(durationMin)));
    const totalSec = clampedMin * 60;
    const focusRes = await setMacFocusMode(true);

    this.state = {
      active: true,
      remainingSec: totalSec,
      totalSec,
      dndEnabled: focusRes.dndEnabled,
    };
    this.onUpdate(this.state);

    this.timer = setInterval(() => {
      if (this.state.remainingSec <= 1) {
        void this.stop(true);
      } else {
        this.state = { ...this.state, remainingSec: this.state.remainingSec - 1 };
        this.onUpdate(this.state);
      }
    }, 1000);

    return focusRes.note;
  }

  async stop(completed = false): Promise<string> {
    this.clearTimer();
    const focusRes = await setMacFocusMode(false);
    this.state = {
      ...this.state,
      active: false,
      remainingSec: completed ? 0 : this.state.totalSec,
      dndEnabled: false,
    };
    this.onUpdate(this.state);
    if (completed) {
      this.onComplete('Deep Work Focus session complete!');
    }
    return focusRes.note;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
