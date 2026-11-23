export function formatSpeed(kbs: number): string {
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)} MB/s`;
  return `${Math.max(0, Math.round(kbs))} KB/s`;
}

export function formatTimer(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
