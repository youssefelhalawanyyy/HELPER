import { loadLocal, saveLocal } from './localStore.js';

export interface TimelineSample {
  ts: number;
  cpuPct: number;
  cpuTempC: number | null;
  fanRpm: number | null;
  ramPct: number;
  batteryPct: number | null;
  batteryWattage: number | null;
  charging: boolean;
  topApp: string;
  topAppCpu: number;
  activeApp: string;
}

export interface TimelineEvent {
  id: string;
  ts: number;
  kind:
    | 'heat_alert'
    | 'quit_app'
    | 'cooling_on'
    | 'build_ok'
    | 'build_fail'
    | 'macro_run'
    | 'perf_switch'
    | 'repair'
    | 'info';
  title: string;
  detail: string;
  targetView?: string;
}

export interface WorkspaceBookmark {
  id: string;
  name: string;
  projectDir: string;
  branch: string;
  activeApp: string;
  browserUrl: string;
  lastTask: string;
  savedAt: number;
}

const MAX_SAMPLES = 450; // 15 minutes @ 2s
const MAX_EVENTS = 120;

export class IncidentTimelineService {
  private samples: TimelineSample[] = [];
  private events: TimelineEvent[] = [];
  private bookmarks: WorkspaceBookmark[] = loadLocal<WorkspaceBookmark[]>('workspace-bookmarks.json', []);
  private lastHeatAlertTs = 0;

  recordSample(sample: TimelineSample): void {
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }

    // Auto-record a heat alert marker when CPU >= 82°C (debounced 2 minutes)
    if (
      sample.cpuTempC !== null &&
      sample.cpuTempC >= 82 &&
      sample.ts - this.lastHeatAlertTs > 120_000
    ) {
      this.lastHeatAlertTs = sample.ts;
      this.recordEvent({
        kind: 'heat_alert',
        title: `Heat Spike (${sample.cpuTempC.toFixed(1)}°C)`,
        detail: `${sample.topApp || 'System'} at ${Math.round(sample.cpuPct)}% CPU`,
        targetView: 'power',
      });
    }
  }

  recordEvent(ev: Omit<TimelineEvent, 'id' | 'ts'> & { ts?: number }): TimelineEvent {
    const entry: TimelineEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: ev.ts ?? Date.now(),
      kind: ev.kind,
      title: ev.title,
      detail: ev.detail,
      targetView: ev.targetView,
    };
    this.events.push(entry);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    return entry;
  }

  getIncidentReplay(centerTs?: number): {
    centerTs: number;
    samples: TimelineSample[];
    events: TimelineEvent[];
    heatAlerts: TimelineEvent[];
  } {
    const heatAlerts = this.events.filter((e) => e.kind === 'heat_alert').slice(-10).reverse();
    const target = centerTs || heatAlerts[0]?.ts || Date.now();
    const from = target - 65_000;
    const to = target + 65_000;
    const samples = this.samples.filter((s) => s.ts >= from && s.ts <= to);
    const events = this.events.filter((e) => e.ts >= from && e.ts <= to);
    return {
      centerTs: target,
      samples: samples.length > 0 ? samples : this.samples.slice(-60),
      events,
      heatAlerts,
    };
  }

  getGaugeHistory(): {
    samples: TimelineSample[];
    events: TimelineEvent[];
    batteryInsights: {
      estimateText: string;
      codingWatts: number;
      callsWatts: number;
      idleWatts: number;
    };
  } {
    const recent = this.samples.slice(-90);
    const latest = recent[recent.length - 1];
    const wattsList = recent
      .map((s) => s.batteryWattage)
      .filter((w): w is number => typeof w === 'number' && w > 0.5);
    const avgW = wattsList.length
      ? wattsList.reduce((a, b) => a + b, 0) / wattsList.length
      : 9.5;

    // Estimate battery runtime range on a typical 52Wh laptop battery
    let estimateText = 'Plugged in';
    if (latest && !latest.charging && latest.batteryPct !== null) {
      const remWh = (latest.batteryPct / 100) * 52.6;
      const hrs = remWh / Math.max(4, avgW);
      const loMin = Math.max(15, Math.round(hrs * 60 * 0.85));
      const hiMin = Math.max(loMin + 15, Math.round(hrs * 60 * 1.15));
      const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
      estimateText =
        wattsList.length >= 4
          ? `About ${fmt(Math.round(hrs * 60))} at this workload`
          : `${fmt(loMin)} – ${fmt(hiMin)} estimated`;
    } else if (latest?.charging && latest.batteryPct !== null) {
      estimateText = `Charging · ${latest.batteryPct}%`;
    }

    return {
      samples: recent,
      events: this.events.slice(-12),
      batteryInsights: {
        estimateText,
        codingWatts: Number((avgW * 1.15).toFixed(1)),
        callsWatts: Number((avgW * 1.45).toFixed(1)),
        idleWatts: Number(Math.max(3.2, avgW * 0.45).toFixed(1)),
      },
    };
  }

  getSummary(minutes = 10): {
    minutes: number;
    summaryText: string;
    events: TimelineEvent[];
    peakTempC: number | null;
    peakCpuPct: number;
    topApp: string;
  } {
    const cutoff = Date.now() - minutes * 60_000;
    const recentSamples = this.samples.filter((s) => s.ts >= cutoff);
    const recentEvents = this.events.filter((e) => e.ts >= cutoff).slice(-12).reverse();

    let peakTempC: number | null = null;
    let peakCpuPct = 0;
    let topApp = 'None';
    for (const s of recentSamples) {
      if (s.cpuTempC !== null && (peakTempC === null || s.cpuTempC > peakTempC)) {
        peakTempC = s.cpuTempC;
      }
      if (s.cpuPct > peakCpuPct) {
        peakCpuPct = Math.round(s.cpuPct);
        if (s.topApp) topApp = s.topApp;
      }
    }

    const parts: string[] = [];
    if (recentEvents.length > 0) {
      parts.push(`${recentEvents.length} key event(s): ${recentEvents.slice(0, 3).map((e) => e.title).join(', ')}.`);
    } else {
      parts.push(`Quiet last ${minutes}m with no alerts.`);
    }
    if (peakTempC !== null) {
      parts.push(`Peak heat ${peakTempC.toFixed(1)}°C, peak CPU ${peakCpuPct}% (${topApp}).`);
    }

    return {
      minutes,
      summaryText: parts.join(' '),
      events: recentEvents,
      peakTempC,
      peakCpuPct,
      topApp,
    };
  }

  listBookmarks(): WorkspaceBookmark[] {
    return [...this.bookmarks];
  }

  saveBookmark(bm: Omit<WorkspaceBookmark, 'id' | 'savedAt'>): WorkspaceBookmark {
    const entry: WorkspaceBookmark = {
      ...bm,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
    };
    this.bookmarks = [entry, ...this.bookmarks.filter((b) => b.name !== entry.name)].slice(0, 16);
    saveLocal('workspace-bookmarks.json', this.bookmarks);
    return entry;
  }

  deleteBookmark(id: string): WorkspaceBookmark[] {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    saveLocal('workspace-bookmarks.json', this.bookmarks);
    return [...this.bookmarks];
  }
}
