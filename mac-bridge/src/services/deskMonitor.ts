import { checkSiteMonitor, type SiteMonitorResult } from './devSuiteService.js';
import { loadLocal, saveLocal } from './localStore.js';

interface Watch {
  url: string;
  result?: SiteMonitorResult;
  issue?: string;
  history: { up: boolean; ms: number; ts: number }[];
}
const sites = loadLocal<Watch[]>('sites.json', []);
let initialized = loadLocal('sites-initialized.json', false);
let running: Promise<void> | undefined;
let notify = (_issue: boolean, _message: string) => {};
function address(raw: string) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw Error('Enter an HTTP or HTTPS website');
  return u.href;
}
export function watchList() {
  return { initialized, sites };
}
export function editSites(action: string, urls: string[]) {
  if (action === 'initialize' && initialized) return watchList();
  if (!['initialize', 'add', 'remove'].includes(action) || !Array.isArray(urls) || urls.length > 64)
    throw Error('Invalid website list');
  const values = urls.map(address);
  if (action === 'remove') {
    for (const url of values) {
      const i = sites.findIndex((s) => s.url === url);
      if (i >= 0) sites.splice(i, 1);
    }
  } else {
    const added = [...new Set(values)].filter((url) => !sites.some((s) => s.url === url));
    if (sites.length + added.length > 64) throw Error('Maximum 64 monitored sites');
    sites.push(...added.map((url) => ({ url, history: [] })));
  }
  saveLocal('sites.json', sites);
  initialized = true;
  saveLocal('sites-initialized.json', true);
  return watchList();
}
export function checkWatched() {
  if (running) return running;
  running = Promise.all(
    sites.map(async (site) => {
      const result = await checkSiteMonitor(site.url);
      if (!sites.includes(site)) return;
      const issue = !result.up
        ? 'unreachable'
        : result.sslDaysLeft != null && result.sslDaysLeft <= 14
          ? 'certificate expires soon'
          : '';
      if (issue !== (site.issue || ''))
        notify(Boolean(issue), 'Website ' + new URL(site.url).hostname + ' ' + (issue || 'recovered'));
      site.result = result;
      site.issue = issue;
      site.history = [
        ...site.history.slice(-31),
        { up: result.up, ms: result.responseMs, ts: result.checkedAt },
      ];
    }),
  )
    .then(() => {
      if (sites.length) saveLocal('sites.json', sites);
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}
export function startWatch(alert: typeof notify) {
  notify = alert;
  const check = () => void checkWatched().catch((err) => console.warn('Website monitor:', err.message));
  check();
  setInterval(check, 60_000).unref();
}

export interface HealthDay {
  date: string;
  before?: number;
  score?: number;
  battery?: number;
}
export const healthDays = loadLocal<HealthDay[]>('health.json', []);
export function recordHealth(values: Omit<HealthDay, 'date'>, ts = Date.now()) {
  const date = new Date(ts).toISOString().slice(0, 10);
  let point = healthDays.find((day) => day.date === date);
  if (point && Object.entries(values).every(([key, value]) => point![key as keyof HealthDay] === value))
    return;
  if (!point) {
    point = { date };
    healthDays.push(point);
  }
  Object.assign(point, values);
  healthDays.sort((a, b) => a.date.localeCompare(b.date));
  healthDays.splice(0, Math.max(0, healthDays.length - 90));
  saveLocal('health.json', healthDays);
}
