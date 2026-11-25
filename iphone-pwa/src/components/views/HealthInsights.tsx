'use client';
import { useEffect, useState } from 'react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { bridgeRequest } from '@/lib/bridgeRequest';
import { makeRequestId } from '@/lib/formatters';

type Day = { date: string; before?: number; score?: number; battery?: number };
export function HealthInsights({ deck }: { deck: DevDeckState }) {
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState('');
  const { bridgeBaseUrl, pairing } = deck;
  useEffect(() => {
    if (deck.status !== 'connected') return;
    let live = true;
    bridgeRequest<Day[]>({ bridgeBaseUrl, pairing }, 'health-history')
      .then((rows) => {
        if (live) {
          setDays(rows);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [
    bridgeBaseUrl,
    pairing,
    deck.status,
    deck.doctorReport.scannedAt,
    deck.powerState.healthPct,
    deck.doctorReport.postReport?.generatedAt,
  ]);
  return (
    <section className="space-y-3 rounded-xl border border-white/10 p-3 text-console-caption">
      <h3 className="font-bold">Top CPU consumers</h3>
      {deck.processes.slice(0, 3).map((p) => (
        <div key={p.pid} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {p.name} · {p.cpuPct}%
          </span>
          {[false, true].map((force) => (
            <button
              key={String(force)}
              type="button"
              className={force ? 'text-rose-300' : 'text-cyan-300'}
              onClick={() => {
                if (window.confirm((force ? 'Force kill ' : 'Quit ') + p.name + ' (PID ' + p.pid + ')?'))
                  deck.sendEvent({
                    type: 'process:kill',
                    payload: { requestId: makeRequestId(), pid: p.pid, expectedName: p.name, force },
                  });
              }}
            >
              {force ? 'Force kill' : 'Quit'}
            </button>
          ))}
        </div>
      ))}
      {!deck.processes.length && <p>Waiting for a process sample</p>}
      <h3 className="font-bold">Health history</h3>
      <div className="flex gap-3 overflow-x-auto" aria-label="Daily health measurements">
        {days.slice(-28).map((d) => (
          <div key={d.date} className="min-w-16 space-y-1" title={d.date}>
            <span>{d.date.slice(5)}</span>
            {(
              [
                ['Before repair', d.before, '#fbbf24'],
                ['Doctor score', d.score, '#22d3ee'],
                ['Battery health', d.battery, '#34d399'],
              ] as const
            ).map(([label, n, color]) =>
              n == null ? null : (
                <div key={label} aria-label={label + ' ' + n}>
                  <div className="text-[10px]">
                    {label} {n}
                  </div>
                  <div style={{ background: color, width: n + '%', height: 3 }} />
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      {!days.length && <p>{error || 'Readings appear after a battery sample or Doctor scan.'}</p>}
    </section>
  );
}
