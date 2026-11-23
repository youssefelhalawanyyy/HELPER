'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GitBranch, RefreshCw, Repeat, Rocket } from 'lucide-react';
import { HardwareDialog } from '@/components/shell/HardwareDialog';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimeShort, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { WebhookEvent } from '@/types/protocol';

const HOLD_MS = 3000;

export function LaunchControlView({ deck }: { deck: DevDeckState }) {
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [deployMode, setDeployMode] = useState<'push' | 'deploy'>('push');
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookEvent | null>(null);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastStepRef = useRef(-1);
  const triggeredRef = useRef(false);

  const cancelHold = useCallback(() => {
    setHolding(false);
    setHoldProgress(0);
    lastStepRef.current = -1;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const triggerDeploy = useCallback(() => {
    triggeredRef.current = true;
    soundEngine.playSuccessChime();
    deck.sendEvent({
      type: 'git:deploy',
      payload: { requestId: makeRequestId(), action: deployMode },
    });
    cancelHold();
  }, [cancelHold, deck, deployMode]);

  const startHold = () => {
    if (holding) return;
    triggeredRef.current = false;
    setHolding(true);
    startRef.current = performance.now();
    lastStepRef.current = -1;

    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      setHoldProgress(p);
      const step = Math.floor(p * 12);
      if (step > lastStepRef.current && step < 12) {
        lastStepRef.current = step;
        soundEngine.playHoldTick(p);
      }
      if (p >= 1) {
        if (!triggeredRef.current) triggerDeploy();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelHold(), [cancelHold]);

  const R = 44;
  const C = 2 * Math.PI * R;
  const { gitStatus } = deck;

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
      {/* Left: Git HUD + 3s Hold-to-Deploy */}
      <div className="tile flex flex-col justify-between p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#fbbf24]" />

        <div className="flex items-start justify-between">
          <div>
            <div className="disp text-[26px]">Launch</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-bold">
              <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[#22d3ee]">
                <GitBranch className="h-3 w-3" />
                {gitStatus.branch || 'main'}
              </span>
              <span className="num text-[#fbbf24]">{gitStatus.uncommitted} dirty</span>
              <span className="num flex items-center text-[#34d399]">
                <ArrowUp className="h-3 w-3" />
                {gitStatus.ahead}
              </span>
              <span className="num flex items-center text-[#ff5d6c]">
                <ArrowDown className="h-3 w-3" />
                {gitStatus.behind}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({ type: 'git:refresh', payload: { requestId: makeRequestId() } });
            }}
            aria-label="Refresh git"
            className="text-[#7c8190] hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tactile 3s Hold Ring */}
        <div className="flex items-center justify-center py-1">
          <button
            type="button"
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            className="relative flex h-[112px] w-[112px] touch-none items-center justify-center rounded-full"
          >
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 104 104">
              <circle cx="52" cy="52" r={R} fill="none" stroke="#23252d" strokeWidth="6" />
              <circle
                cx="52"
                cy="52"
                r={R}
                fill="none"
                stroke={deployMode === 'push' ? '#fbbf24' : '#34d399'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - holdProgress)}
              />
            </svg>
            <div
              className="hw-key flex h-[82px] w-[82px] flex-col items-center justify-center rounded-full transition-transform"
              style={{ transform: holding ? 'scale(0.94)' : 'scale(1)' }}
            >
              <Rocket
                className="h-5 w-5"
                style={{ color: deployMode === 'push' ? '#fbbf24' : '#34d399' }}
              />
              <span className="mt-1 text-[10px] font-extrabold uppercase tracking-wider">
                {holding ? `${Math.ceil((1 - holdProgress) * 3)}s…` : 'Hold 3s'}
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="sub">Safety interlock</span>
          <div className="flex gap-1 rounded-full bg-black/60 p-0.5 text-[9.5px] font-bold">
            <button
              type="button"
              onClick={() => setDeployMode('push')}
              className={`rounded-full px-2.5 py-0.5 ${
                deployMode === 'push' ? 'bg-[#fbbf24] text-black' : 'text-[#7c8190]'
              }`}
            >
              GIT PUSH
            </button>
            <button
              type="button"
              onClick={() => setDeployMode('deploy')}
              className={`rounded-full px-2.5 py-0.5 ${
                deployMode === 'deploy' ? 'bg-[#34d399] text-black' : 'text-[#7c8190]'
              }`}
            >
              DEPLOY
            </button>
          </div>
        </div>
      </div>

      {/* Right: Webhook & API Ticker */}
      <div className="tile flex min-h-0 flex-col p-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="mb-2 flex items-center justify-between">
          <div className="disp text-[26px]">Webhooks</div>
          <span className="sub !text-[#22d3ee]">/hook/* live</span>
        </div>

        <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {deck.webhooks.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setSelectedWebhook(ev);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-left hover:border-[#22d3ee]/40"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-extrabold"
                  style={{
                    background: ev.method === 'POST' ? 'rgba(52,211,153,.18)' : 'rgba(34,211,238,.18)',
                    color: ev.method === 'POST' ? '#34d399' : '#22d3ee',
                  }}
                >
                  {ev.method}
                </span>
                <span className="font-mono-tech truncate text-[11px]">{ev.path}</span>
              </div>
              <span className="num sub shrink-0 !text-[#34d399]">
                {ev.statusCode} · {ev.latencyMs}ms
              </span>
            </button>
          ))}

          {deck.webhooks.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <span className="sub">Waiting for HTTP requests</span>
              <code className="font-mono-tech rounded-lg bg-black/70 px-2.5 py-1 text-[10px] text-[#22d3ee]">
                POST :4747/hook/test
              </code>
            </div>
          )}
        </div>
      </div>

      <HardwareDialog
        open={Boolean(selectedWebhook)}
        title={selectedWebhook ? `${selectedWebhook.method} ${selectedWebhook.path}` : 'Webhook'}
        onClose={() => setSelectedWebhook(null)}
      >
        {selectedWebhook && (
          <div className="flex flex-col gap-3">
            <div className="sub flex justify-between">
              <span>Status {selectedWebhook.statusCode}</span>
              <span>{selectedWebhook.latencyMs}ms</span>
              <span>{formatTimeShort(selectedWebhook.ts)}</span>
            </div>
            <pre className="deck-scroll font-mono-tech max-h-[160px] overflow-auto rounded-xl bg-black p-3 text-[11px] text-[#34d399]">
              {JSON.stringify({ query: selectedWebhook.query, body: selectedWebhook.body }, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  deck.sendEvent({
                    type: 'webhook:copy',
                    payload: { requestId: makeRequestId(), eventId: selectedWebhook.id },
                  })
                }
                className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold"
              >
                <Copy className="h-3.5 w-3.5 text-[#22d3ee]" />
                Copy to Mac
              </button>
              <button
                type="button"
                onClick={() =>
                  deck.sendEvent({
                    type: 'webhook:replay',
                    payload: { requestId: makeRequestId(), eventId: selectedWebhook.id },
                  })
                }
                className="flex items-center gap-1 rounded-full bg-[#34d399] px-3.5 py-1.5 text-xs font-extrabold text-[#04130c]"
              >
                <Repeat className="h-3.5 w-3.5" />
                Replay
              </button>
            </div>
          </div>
        )}
      </HardwareDialog>
    </div>
  );
}
