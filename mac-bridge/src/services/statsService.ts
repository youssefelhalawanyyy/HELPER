import si from 'systeminformation';
import type { SystemStats } from '../types/protocol.js';

export class StatsService {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private latest: SystemStats = {
    cpuPct: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    ramPct: 0,
    diskUsedGb: 0,
    diskTotalGb: 0,
    diskPct: 0,
    netRxKBs: 0,
    netTxKBs: 0,
    batteryPct: null,
    batteryCharging: false,
    ts: Date.now(),
  };

  constructor(private onStats: (stats: SystemStats) => void) {}

  getLatest(): SystemStats {
    return this.latest;
  }

  private async sample(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const [load, mem, disks, net, bat] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.battery(),
      ]);

      const primaryDisk =
        disks.find((d) => d.mount === '/' || d.mount === '/System/Volumes/Data') || disks[0];
      const ramUsed = mem.active || mem.used;
      const ramTotal = mem.total || 1;
      const diskUsed = primaryDisk ? primaryDisk.used : 0;
      const diskTotal = primaryDisk ? primaryDisk.size || 1 : 1;

      const rxSec = net.reduce((sum, iface) => sum + Math.max(0, iface.rx_sec || 0), 0);
      const txSec = net.reduce((sum, iface) => sum + Math.max(0, iface.tx_sec || 0), 0);

      this.latest = {
        cpuPct: Math.round(load.currentLoad || 0),
        ramUsedGb: Number((ramUsed / 1024 ** 3).toFixed(1)),
        ramTotalGb: Number((ramTotal / 1024 ** 3).toFixed(1)),
        ramPct: Math.round((ramUsed / ramTotal) * 100),
        diskUsedGb: Number((diskUsed / 1024 ** 3).toFixed(1)),
        diskTotalGb: Number((diskTotal / 1024 ** 3).toFixed(1)),
        diskPct: Math.round((diskUsed / diskTotal) * 100),
        netRxKBs: Math.round(rxSec / 1024),
        netTxKBs: Math.round(txSec / 1024),
        batteryPct: bat.hasBattery ? Math.round(bat.percent) : null,
        batteryCharging: Boolean(bat.isCharging || bat.acConnected),
        ts: Date.now(),
      };
      this.onStats(this.latest);
    } catch {
      // Ignore transient telemetry errors
    } finally {
      this.busy = false;
    }
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
