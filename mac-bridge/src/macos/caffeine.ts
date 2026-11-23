import { type ChildProcess, spawn } from 'node:child_process';

export class CaffeineManager {
  private child: ChildProcess | null = null;

  constructor(private onChange: (active: boolean) => void) {}

  isActive(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  setActive(active: boolean): boolean {
    if (active) {
      if (!this.isActive()) {
        this.child = spawn('caffeinate', ['-di'], { stdio: 'ignore' });
        this.child.on('exit', () => {
          this.child = null;
          this.onChange(false);
        });
      }
      this.onChange(true);
      return true;
    }

    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    this.onChange(false);
    return false;
  }

  stop(): void {
    this.setActive(false);
  }
}
