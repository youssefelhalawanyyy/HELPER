'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CornerDownLeft,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  ZoomIn,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

type QualityMode = 'turbo' | 'balanced' | 'hd';

interface TapRipple {
  id: number;
  xPct: number;
  yPct: number;
  kind: 'left' | 'right' | 'double';
}

export function LiveScreenPreview({
  deck,
  onShortcut,
}: {
  deck: DevDeckState;
  onShortcut: (shortcutId: string) => void;
}) {
  const [quality, setQuality] = useState<QualityMode>('turbo');
  const [paused, setPaused] = useState(false);
  const [clickMode, setClickMode] = useState<'left' | 'right'>('left');
  const [zoom, setZoom] = useState<1 | 1.75 | 2.5>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [streamNonce, setStreamNonce] = useState(() => Date.now());
  const [streamReady, setStreamReady] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [ripples, setRipples] = useState<TapRipple[]>([]);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastTapRef = useRef<{ ts: number; nx: number; ny: number }>({ ts: 0, nx: 0, ny: 0 });
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
  const rafMoveRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ nx: number; ny: number } | null>(null);

  const isConnected =
    deck.status === 'connected' && Boolean(deck.bridgeBaseUrl && deck.pairing?.token);

  const streamUrl =
    isConnected && !paused
      ? `${deck.bridgeBaseUrl}/api/screen/stream?q=${quality}&token=${encodeURIComponent(deck.pairing!.token)}&s=${streamNonce}`
      : isConnected && paused
        ? `${deck.bridgeBaseUrl}/api/screen/peek?w=960&token=${encodeURIComponent(deck.pairing!.token)}&t=${streamNonce}`
        : '';

  useEffect(() => {
    setStreamReady(false);
    setStreamError(false);
  }, [quality, paused, streamNonce, deck.bridgeBaseUrl]);

  useEffect(() => {
    return () => {
      if (rafMoveRef.current) cancelAnimationFrame(rafMoveRef.current);
    };
  }, []);

  // Compute exact normalized (0..1, 0..1) screen coordinates accounting for object-contain letterboxing & zoom/pan
  const clientToScreenNorm = useCallback(
    (clientX: number, clientY: number): { nx: number; ny: number; xPct: number; yPct: number } | null => {
      const img = imgRef.current;
      const stage = stageRef.current;
      if (!img || !stage) return null;

      const rect = img.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const natW = img.naturalWidth || 16;
      const natH = img.naturalHeight || 9;
      const imgAspect = natW / natH;
      const boxAspect = rect.width / rect.height;

      let renderW = rect.width;
      let renderH = rect.height;
      let offsetX = 0;
      let offsetY = 0;

      if (boxAspect > imgAspect) {
        renderH = rect.height;
        renderW = renderH * imgAspect;
        offsetX = (rect.width - renderW) / 2;
      } else {
        renderW = rect.width;
        renderH = renderW / imgAspect;
        offsetY = (rect.height - renderH) / 2;
      }

      const relX = clientX - rect.left - offsetX;
      const relY = clientY - rect.top - offsetY;
      const nx = Math.max(0, Math.min(1, relX / Math.max(1, renderW)));
      const ny = Math.max(0, Math.min(1, relY / Math.max(1, renderH)));

      const sRect = stage.getBoundingClientRect();
      const xPct = Math.max(2, Math.min(98, ((clientX - sRect.left) / Math.max(1, sRect.width)) * 100));
      const yPct = Math.max(2, Math.min(98, ((clientY - sRect.top) / Math.max(1, sRect.height)) * 100));

      return { nx, ny, xPct, yPct };
    },
    [],
  );

  const pushRipple = useCallback((xPct: number, yPct: number, kind: 'left' | 'right' | 'double') => {
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev.slice(-3), { id, xPct, yPct, kind }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 420);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isConnected) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !isConnected) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 6) {
      dragRef.current.moved = true;
    }

    if (zoom > 1 && dragRef.current.moved) {
      const maxPan = (zoom - 1) * 48;
      setPan({
        x: Math.max(-maxPan, Math.min(maxPan, dragRef.current.startPanX + dx * 0.25)),
        y: Math.max(-maxPan, Math.min(maxPan, dragRef.current.startPanY + dy * 0.25)),
      });
      return;
    }

    if (dragRef.current.moved) {
      const pos = clientToScreenNorm(e.clientX, e.clientY);
      if (pos) {
        pendingMoveRef.current = { nx: pos.nx, ny: pos.ny };
        if (!rafMoveRef.current) {
          rafMoveRef.current = requestAnimationFrame(() => {
            rafMoveRef.current = null;
            const p = pendingMoveRef.current;
            pendingMoveRef.current = null;
            if (p) {
              deck.sendEvent({
                type: 'trackpad:abs',
                payload: { nx: p.nx, ny: p.ny, action: 'move' },
              });
            }
          });
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    dragRef.current.moved = false;
    if (!isConnected || wasMoved) return;

    const pos = clientToScreenNorm(e.clientX, e.clientY);
    if (!pos) return;

    const now = performance.now();
    const isDouble =
      clickMode === 'left' &&
      now - lastTapRef.current.ts < 300 &&
      Math.hypot(pos.nx - lastTapRef.current.nx, pos.ny - lastTapRef.current.ny) < 0.04;

    lastTapRef.current = { ts: isDouble ? 0 : now, nx: pos.nx, ny: pos.ny };
    const action = isDouble ? 'double' : clickMode;

    soundEngine.playClick();
    pushRipple(pos.xPct, pos.yPct, action);
    deck.sendEvent({
      type: 'trackpad:abs',
      payload: { nx: pos.nx, ny: pos.ny, action },
    });
  };

  const cycleZoom = () => {
    soundEngine.playClick();
    setZoom((z) => {
      const next = z === 1 ? 1.75 : z === 1.75 ? 2.5 : 1;
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const saveSnapshot = () => {
    if (!isConnected) return;
    soundEngine.playClick();
    const url = `${deck.bridgeBaseUrl}/api/screen/peek?w=1280&token=${encodeURIComponent(deck.pairing!.token)}&t=${Date.now()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `devdeck-screen-${Date.now()}.jpg`;
    a.target = '_blank';
    a.click();
    deck.showToast(true, 'Screen snapshot captured');
  };

  const stageBody = (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-[90] flex flex-col gap-2 bg-[#040c11]/98 p-2.5 backdrop-blur-xl'
          : 'flex min-h-0 flex-1 flex-col gap-1.5'
      }
      data-no-swipe="true"
    >
      {/* Top Pro Controls Strip */}
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono-tech text-[8px] font-extrabold uppercase"
            style={{
              background:
                isConnected && !paused && streamReady
                  ? 'rgba(52,211,153,0.18)'
                  : 'rgba(251,191,36,0.16)',
              color: isConnected && !paused && streamReady ? '#34d399' : '#fbbf24',
            }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected && !paused && streamReady ? 'animate-pulse bg-[#34d399]' : 'bg-[#fbbf24]'
              }`}
            />
            {!isConnected ? 'OFFLINE' : paused ? 'PAUSED' : streamReady ? 'LIVE' : 'SYNC…'}
          </span>

          {/* Quality / Speed Switcher */}
          <div className="flex rounded-lg border border-[#98c8ce29] bg-[#071117] p-0.5">
            {(
              [
                ['turbo', 'TURBO'],
                ['balanced', 'BAL'],
                ['hd', 'HD'],
              ] as const
            ).map(([q, lbl]) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setQuality(q);
                }}
                className="rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase"
                style={{
                  background: quality === q ? '#153137' : 'transparent',
                  color: quality === q ? '#88f1d1' : '#8aa2a9',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Toggle Left vs Right Click on tap"
            onClick={() => {
              soundEngine.playClick();
              setClickMode((m) => (m === 'left' ? 'right' : 'left'));
            }}
            className="flex h-6 items-center gap-0.5 rounded-lg border px-1.5 text-[8px] font-extrabold uppercase"
            style={{
              borderColor: clickMode === 'right' ? '#fbbf24' : 'rgba(179,229,223,0.22)',
              background: clickMode === 'right' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.05)',
              color: clickMode === 'right' ? '#fbbf24' : '#88f1d1',
            }}
          >
            <MousePointerClick className="h-2.5 w-2.5" />
            {clickMode === 'right' ? 'R-TAP' : 'L-TAP'}
          </button>

          <button
            type="button"
            title="Zoom Preview"
            onClick={cycleZoom}
            className="flex h-6 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.05] px-1.5 font-mono-tech text-[8px] font-extrabold text-[#effaf7]"
          >
            <ZoomIn className="h-2.5 w-2.5 text-[#7dd3fc]" />
            {zoom}x
          </button>

          <button
            type="button"
            aria-label={paused ? 'Resume live stream' : 'Pause live stream'}
            onClick={() => {
              soundEngine.playClick();
              setPaused((p) => !p);
              setStreamNonce(Date.now());
            }}
            className="grid h-6 w-6 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-[#effaf7]"
          >
            {paused ? <Play className="h-3 w-3 text-[#34d399]" /> : <Pause className="h-3 w-3" />}
          </button>

          <button
            type="button"
            aria-label="Reconnect screen stream"
            onClick={() => {
              soundEngine.playClick();
              setPaused(false);
              setStreamNonce(Date.now());
            }}
            className="grid h-6 w-6 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-[#9cb4bb] hover:text-white"
          >
            <RefreshCw className="h-3 w-3" />
          </button>

          <button
            type="button"
            aria-label={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen screen preview'}
            onClick={() => {
              soundEngine.playClick();
              setFullscreen((f) => !f);
            }}
            className="grid h-6 w-6 place-items-center rounded-lg border border-[#88f1d1]/40 bg-[#88f1d1]/15 text-[#88f1d1]"
          >
            {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Live Interactive Screen Viewport */}
      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current.active = false;
          dragRef.current.moved = false;
        }}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden rounded-xl border border-[#88f1d1]/25 bg-[#03090d]"
      >
        {isConnected && streamUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              key={`${quality}-${paused}-${streamNonce}`}
              src={streamUrl}
              alt="Live Computer Screen Preview"
              draggable={false}
              onLoad={() => {
                setStreamReady(true);
                setStreamError(false);
              }}
              onError={() => setStreamError(true)}
              className="h-full w-full object-contain transition-transform duration-100"
              style={{
                transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
              }}
            />

            {!streamReady && !streamError && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55">
                <Monitor className="h-5 w-5 animate-pulse text-[#88f1d1]" />
                <span className="font-mono-tech text-[9px] font-bold text-[#88f1d1]">
                  CONNECTING LIVE STREAM…
                </span>
              </div>
            )}

            {streamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/80 p-3 text-center">
                <span className="text-[10px] font-bold text-[#fbbf24]">
                  Screen stream needs Screen Recording permission or bridge reconnect
                </span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setStreamError(false);
                    setStreamNonce(Date.now());
                  }}
                  className="rounded-lg bg-[#88f1d1] px-3 py-1 text-[9px] font-extrabold text-[#061c17]"
                >
                  RETRY LIVE STREAM
                </button>
              </div>
            )}

            {/* Instant Tap Ripple Feedback */}
            {ripples.map((r) => (
              <span
                key={r.id}
                aria-hidden="true"
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2"
                style={{
                  left: `${r.xPct}%`,
                  top: `${r.yPct}%`,
                  width: r.kind === 'double' ? 28 : 20,
                  height: r.kind === 'double' ? 28 : 20,
                  borderColor: r.kind === 'right' ? '#fbbf24' : '#88f1d1',
                }}
              />
            ))}

            {/* Subtle Corner Hint */}
            <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono-tech text-[7.5px] font-bold text-[#cbd5e1]">
              Tap screen to click · Drag to aim · 2x tap to open
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-center text-[#9cb4bb]">
            <Monitor className="h-6 w-6 opacity-50" />
            <span className="text-[10px] font-bold">Connect Mac / PC Bridge for Live Screen</span>
          </div>
        )}
      </div>

      {/* Bottom Instant Shortcut & Snapshot Bar */}
      <div className="grid grid-cols-5 gap-1">
        {(
          [
            ['nav.escape', 'ESC'],
            ['nav.switchApp', '⌘TAB'],
            ['nav.space', 'SPACE'],
            ['nav.enter', 'ENTER'],
          ] as const
        ).map(([id, lbl]) => (
          <button
            key={id}
            type="button"
            onClick={() => onShortcut(id)}
            className="flex h-6 items-center justify-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-[8.5px] font-extrabold text-zinc-200 active:bg-[#88f1d1]/20"
          >
            {id === 'nav.enter' && <CornerDownLeft className="h-2.5 w-2.5 text-[#34d399]" />}
            {lbl}
          </button>
        ))}
        <button
          type="button"
          onClick={saveSnapshot}
          disabled={!isConnected}
          className="flex h-6 items-center justify-center gap-0.5 rounded-lg border border-[#88f1d1]/30 bg-[#88f1d1]/12 text-[8.5px] font-extrabold text-[#88f1d1] disabled:opacity-40"
        >
          <Camera className="h-2.5 w-2.5" />
          SNAP
        </button>
      </div>
    </div>
  );

  return stageBody;
}
