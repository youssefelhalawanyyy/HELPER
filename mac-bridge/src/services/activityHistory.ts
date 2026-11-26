import { randomUUID } from 'node:crypto';
import type { Activity, ActivityWindow, Reading } from '../../../shared/activity.js';
import type { HeavyProcess, PowerThermalState, SystemStats } from '../types/protocol.js';
import { loadLocal, saveLocal } from './localStore.js';

const history = loadLocal<ActivityWindow>('activity.json', { events: [], readings: [] });
let lastSave = 0;
let hot = false;
let workload = '';
let stats: SystemStats | undefined;
let apps: HeavyProcess[] = [];
let appsAt = 0;
export function recordWorkload(name: string) { workload = name; }
export function recordLoad(value: SystemStats) { stats = value; }
export function recordApps(value: HeavyProcess[]) { apps = value; appsAt = Date.now(); }

function persist() {
  lastSave = Date.now();
  saveLocal('activity.json', history);
}
export function recordActivity(kind: Activity['kind'], title: string, ts = Date.now()) {
  history.events.push({ kind, title: title.slice(0, 200), ts, id: randomUUID() });
  history.events = history.events.slice(-1500);
  persist();
}
export function recordReading(state: PowerThermalState) {
  const ts = state.updatedAt;
  if (!ts || ts <= (history.readings.at(-1)?.ts || 0)) return;
  const danger = (state.cpuTempC !== null && state.cpuTempC >= state.overheatTempC)
    || (state.gpuTempC !== null && state.gpuTempC >= state.overheatTempC)
    || (state.batteryTempC !== null && state.batteryTempC >= 45) || state.thermalPressure === 'Critical';
  if (!danger || !hot || ts - (history.readings.at(-1)?.ts || 0) >= 4000) {
    if (ts - (history.readings.at(-1)?.ts || 0) >= 4000 || danger !== hot) {
      history.readings.push({ ts, heat: state.cpuTempC, rpm: state.fanRpm.length ? Math.max(...state.fanRpm) : null,
        cpu: stats && ts - stats.ts < 16000 ? stats.cpuPct : null,
        apps: ts - appsAt < 20000 ? apps.slice(0,3).map(p => p.name + ' ' + p.cpuPct + '%') : [],
        battery: state.hasBattery ? state.batteryPct : null, onBattery: state.hasBattery && !state.acConnected && !state.isCharging,
        minutes: state.timeRemainingMin, workload });
      // Keep the last hour and a two-minute window for recent incidents.
      const incidents = history.events.filter(e => e.kind === 'heat').slice(-24);
      history.readings = history.readings.filter(r => ts-r.ts <= 3600000 || incidents.some(e => Math.abs(r.ts-e.ts)<=60000));
    }
  }
  if (danger && !hot) recordActivity('heat', 'Heat alert · CPU ' + (state.cpuTempC ?? '—') + ' °C · GPU ' + (state.gpuTempC ?? '—') + ' °C · battery ' + (state.batteryTempC ?? '—') + ' °C', ts);
  hot = danger;
  if (ts-lastSave > 30000) persist();
}
export function activityWindow(center?: number, minutes = 10): ActivityWindow {
  const now = Date.now();
  const from = center ? center - 60000 : now - minutes * 60000;
  const to = center ? center + 60000 : now;
  return { events: history.events.filter(e => e.ts >= from && e.ts <= to),
    readings: history.readings.filter(r => r.ts >= from && r.ts <= to) };
}
export function recentIncidents() { return history.events.filter(e => e.kind === 'heat').slice(-24).reverse(); }
