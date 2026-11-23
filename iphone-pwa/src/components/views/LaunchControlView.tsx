'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileDiff,
  FolderGit2,
  GitBranch,
  RefreshCw,
  Repeat,
  Rocket,
  Webhook,
} from 'lucide-react';
import { HardwareDialog } from '@/components/shell/HardwareDialog';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimeShort, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { WebhookEvent } from '@/types/protocol';

const HOLD_DURATION_MS = 3000;

export function LaunchControlView({ deck }: { deck: DevDeckState }) {
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [deployMode, setDeployMode] = useState<'push' | 'deploy'>('push');
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookEvent | null>(null);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastTickStepRef = useRef<number>(-1);
  const triggeredRef = useRef(false);

  const cancelHold = useCallback(() => {
    setHolding(false);
    setHoldProgress(0);
    lastTickStepRef.current = -1;
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
    startTimeRef.current = performance.now();
    lastTickStepRef.current = -1;

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const p = Math.min(1, elapsed / HOLD_DURATION_MS);
      setHoldProgress(p);

      const step = Math.floor(p * 12);
      if (step > lastTickStepRef.current && step < 12) {
        lastTickStepRef.current = step;
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

  const { gitStatus } = deck;
  const ringRadius = 46;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - holdProgress);

  const webhookEndpoint = deck.hello
    ? `http://${deck.hello.lanIp}:${deck.hello.bridgePort}/hook/test`
    : 'http://localhost:4747/hook/test';

  return (
    <div className="grid h-full grid-cols-12 gap-2.5 p-3">
      {/* Left: Git Status HUD + 3s Hold-to-Deploy */}
      <div className="col-span-5 flex min-h-0 flex-col gap-2.5">
        <div className="hw-panel flex flex-col gap-2 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <FolderGit2 className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="truncate text-xs font-semibold text-white">{gitStatus.repoName}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'git:refresh', payload: { requestId: makeRequestId() } });
              }}
              aria-label="Refresh git status"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-white/[0.06] bg-black px-2 py-1.5">
              <div className="font-mono-tech flex items-center gap-1 text-[9px] uppercase text-zinc-500">
                <GitBranch className="h-2.5 w-2.5 text-cyan-400" />
                Branch
              </div>
              <div className="font-mono-tech mt-0.5 truncate text-[11px] font-semibold text-cyan-300">
                {gitStatus.branch}
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black px-2 py-1.5">
              <div className="font-mono-tech flex items-center gap-1 text-[9px] uppercase text-zinc-500">
                <FileDiff className="h-2.5 w-2.5 text-amber-400" />
                Dirty
              </div>
              <div className="font-mono-tech mt-0.5 text-[11px] font-semibold text-amber-300">
                {gitStatus.uncommitted} files
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black px-2 py-1.5">
              <div className="font-mono-tech text-[9px] uppercase text-zinc-500">Sync</div>
              <div className="font-mono-tech mt-0.5 flex items-center gap-2 text-[11px] font-semibold">
                <span className="flex items-center text-emerald-400">
                  <ArrowUp className="h-2.5 w-2.5" />
                  {gitStatus.ahead}
                </span>
                <span className="flex items-center text-red-400">
                  <ArrowDown className="h-2.5 w-2.5" />
                  {gitStatus.behind}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Hold 3s to Push/Deploy Hardware Switch */}
        <div className="hw-panel flex flex-1 flex-col items-center justify-between rounded-xl p-3">
          <div className="flex w-full items-center justify-between">
            <span className="font-mono-tech text-[10px] uppercase tracking-wider text-zinc-400">
              Safety Interlock
            </span>
            <div className="flex rounded-md border border-white/10 bg-black p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setDeployMode('push')}
                className={`rounded px-2 py-0.5 font-medium ${
                  deployMode === 'push' ? 'bg-amber-500 text-black' : 'text-zinc-400'
                }`}
              >
                Git Push
              </button>
              <button
                type="button"
                onClick={() => setDeployMode('deploy')}
                className={`rounded px-2 py-0.5 font-medium ${
                  deployMode === 'deploy' ? 'bg-emerald-500 text-black' : 'text-zinc-400'
                }`}
              >
                Deploy
              </button>
            </div>
          </div>

          <button
            type="button"
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            className="relative my-1 flex h-[112px] w-[112px] touch-none items-center justify-center rounded-full focus:outline-none"
          >
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 112 112">
              <circle
                cx="56"
                cy="56"
                r={ringRadius}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="6"
              />
              <circle
                cx="56"
                cy="56"
                r={ringRadius}
                fill="none"
                stroke={deployMode === 'push' ? '#F59E0B' : '#10B981'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringCirc}
                strokeDashoffset={ringOffset}
              />
            </svg>
            <div
              className={`hw-key flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full transition-transform ${
                holding ? 'scale-95 border-amber-400/60' : ''
              }`}
            >
              <Rocket
                className={`h-5 w-5 ${deployMode === 'push' ? 'text-amber-400' : 'text-emerald-400'}`}
              />
              <span className="font-mono-tech mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-200">
                {holding ? `${Math.ceil((1 - holdProgress) * 3)}s…` : 'Hold 3s'}
              </span>
            </div>
          </button>

          <span className="font-mono-tech truncate text-[10px] text-zinc-500">
            {deployMode === 'push' ? 'git push' : deck.config?.deployCommand || 'git push'}
          </span>
        </div>
      </div>

      {/* Right: Live Webhook & API Ticker */}
      <div className="hw-panel col-span-7 flex min-h-0 flex-col rounded-xl p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Webhook className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="text-xs font-semibold text-white">Webhook & API Ticker</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'clipboard:copy',
                payload: { requestId: makeRequestId(), text: webhookEndpoint },
              });
            }}
            className="font-mono-tech flex items-center gap-1 rounded-md border border-white/10 bg-black px-2 py-1 text-[10px] text-cyan-300 hover:border-cyan-400/40"
          >
            <Copy className="h-3 w-3" />
            /hook/*
          </button>
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
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#131318] px-2.5 py-2 text-left transition-colors hover:border-cyan-500/35"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`font-mono-tech rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    ev.method === 'POST'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : ev.method === 'DELETE'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-cyan-500/20 text-cyan-300'
                  }`}
                >
                  {ev.method}
                </span>
                <span className="font-mono-tech truncate text-[11px] text-zinc-200">{ev.path}</span>
              </div>

              <div className="font-mono-tech flex shrink-0 items-center gap-2 text-[10px] text-zinc-400">
                <span className="text-emerald-400">{ev.statusCode}</span>
                <span>{ev.latencyMs}ms</span>
                <span className="text-zinc-600">{formatTimeShort(ev.ts)}</span>
              </div>
            </button>
          ))}

          {deck.webhooks.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <span className="text-xs text-zinc-400">Listening for local HTTP requests</span>
              <code className="font-mono-tech rounded border border-white/10 bg-black px-2 py-1 text-[10px] text-cyan-300">
                curl -X POST {webhookEndpoint} -d &apos;&#123;&quot;ok&quot;:true&#125;&apos;
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Webhook Payload Inspector Modal (<dialog>) */}
      <HardwareDialog
        open={Boolean(selectedWebhook)}
        title={selectedWebhook ? `${selectedWebhook.method} ${selectedWebhook.path}` : 'Inspector'}
        onClose={() => setSelectedWebhook(null)}
      >
        {selectedWebhook && (
          <div className="flex flex-col gap-3">
            <div className="font-mono-tech flex items-center justify-between text-[11px] text-zinc-400">
              <span>Status: {selectedWebhook.statusCode}</span>
              <span>Latency: {selectedWebhook.latencyMs}ms</span>
              <span>{formatTimeShort(selectedWebhook.ts)}</span>
            </div>

            <pre className="deck-scroll font-mono-tech max-h-[180px] overflow-auto rounded-lg border border-white/10 bg-black p-3 text-[11px] text-emerald-300">
              {JSON.stringify(
                { query: selectedWebhook.query, body: selectedWebhook.body },
                null,
                2,
              )}
            </pre>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'webhook:copy',
                    payload: { requestId: makeRequestId(), eventId: selectedWebhook.id },
                  });
                }}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
              >
                <Copy className="h-3.5 w-3.5 text-cyan-400" />
                Copy to Mac
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'webhook:replay',
                    payload: { requestId: makeRequestId(), eventId: selectedWebhook.id },
                  });
                }}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black"
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
