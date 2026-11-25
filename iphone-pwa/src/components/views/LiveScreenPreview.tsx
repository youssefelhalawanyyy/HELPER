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
  ShieldAlert,
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
  const [retryTick, setRetryTick] = useState(0);
  const [streamReady, setStreamReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [displays, setDisplays] = useState<Array<{ index: number; label: string }>>([
    { index: 0, label: 'Display 1' },
  ]);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [dragSelectMode, setDragSelectMode] = useState(false);
  const [ripples, setRipples] = useState<TapRipple[]>([]);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const twoFingerYRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgSizeRef = useRef({ w: 16, h: 9 });
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

  // Fetch available monitors (Display 1 / Display 2 / External)
  useEffect(() => {
    if (!isConnected || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    void fetch(
      `${deck.bridgeBaseUrl}/api/screen/displays?token=${encodeURIComponent(deck.pairing.token)}`,
    )
      .then((r) => r.json())
      .then((d: { ok?: boolean; displays?: Array<{ index: number; label: string }> }) => {
        if (d.ok && Array.isArray(d.displays) && d.displays.length > 0) {
          setDisplays(d.displays);
        }
      })
      .catch(() => {});
  }, [isConnected, deck.bridgeBaseUrl, deck.pairing?.token]);

  // Zero-flicker, Cloudflare-tunnel & iOS-Safari proof live canvas streaming loop
  useEffect(() => {
    if (!isConnected || paused || !deck.bridgeBaseUrl || !deck.pairing?.token) return;

    let cancelled = false;
    let seq = 0;
    let frameTimes: number[] = [];
    const controller = new AbortController();

    const pump = async () => {
      while (!cancelled) {
        const t0 = performance.now();
        try {
          const url = `${deck.bridgeBaseUrl}/api/screen/frame?q=${quality}&display=${displayIdx}&seq=${seq}&token=${encodeURIComponent(deck.pairing!.token)}`;
          const res = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal,
          });

          if (cancelled) break;

          if (res.status === 403) {
            setPermissionDenied(true);
            setStreamReady(false);
            setFps(0);
            // Poll permission gently every 2s so it auto-starts the instant user grants it on Mac!
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          if (res.status === 204 || !res.ok) {
            await new Promise((r) => setTimeout(r, 120));
            continue;
          }

          const nextSeq = Number(res.headers.get('x-screen-seq') || 0);
          if (nextSeq > 0) seq = nextSeq;

          const blob = await res.blob();
          if (cancelled || blob.size < 100) continue;

          const canvas = canvasRef.current;
          if (!canvas) continue;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) continue;

          if (typeof createImageBitmap === 'function') {
            const bmp = await createImageBitmap(blob);
            if (!cancelled) {
              if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
                canvas.width = bmp.width;
                canvas.height = bmp.height;
                imgSizeRef.current = { w: bmp.width, h: bmp.height };
              }
              ctx.drawImage(bmp, 0, 0);
            }
            bmp.close();
          } else {
            const objUrl = URL.createObjectURL(blob);
            await new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                if (!cancelled) {
                  if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    imgSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
                  }
                  ctx.drawImage(img, 0, 0);
                }
                URL.revokeObjectURL(objUrl);
                resolve();
              };
              img.onerror = () => {
                URL.revokeObjectURL(objUrl);
                resolve();
              };
              img.src = objUrl;
            });
          }

          setPermissionDenied(false);
          setStreamReady(true);

          const now = performance.now();
          frameTimes.push(now);
          frameTimes = frameTimes.filter((t) => now - t <= 1000);
          setFps(frameTimes.length);
          setLatencyMs(Math.max(1, Math.round(now - t0)));

          // Tiny yield to keep touch & scroll events 100% immediate
          const elapsed = now - t0;
          const minFrameMs = quality === 'turbo' ? 38 : quality === 'balanced' ? 55 : 80;
          if (elapsed < minFrameMs) {
            await new Promise((r) => setTimeout(r, minFrameMs - elapsed));
          }
        } catch {
          if (cancelled) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    };

    void pump();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isConnected, paused, quality, displayIdx, retryTick, deck.bridgeBaseUrl, deck.pairing]);

  useEffect(() => {
    return () => {
      if (rafMoveRef.current) cancelAnimationFrame(rafMoveRef.current);
    };
  }, []);

  const handleRequestPermission = async () => {
    if (!isConnected || !deck.bridgeBaseUrl || !deck.pairing?.token) return;
    soundEngine.playClick();
    setRequestingPerm(true);
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/screen/request-permission`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deck.pairing.token}`,
        },
      });
      const data = (await res.json()) as { granted?: boolean; message?: string };
      deck.showToast(true, data.message || 'Opened Mac Screen Recording Settings');
      if (data.granted) {
        setPermissionDenied(false);
        setRetryTick((t) => t + 1);
      }
    } catch {
      deck.showToast(false, 'Could not open Mac settings');
    } finally {
      setRequestingPerm(false);
    }
  };

  // Compute exact normalized (0..1, 0..1) screen coordinates accounting for object-contain letterboxing & zoom/pan
  const clientToScreenNorm = useCallback(
    (clientX: number, clientY: number): { nx: number; ny: number; xPct: number; yPct: number } | null => {
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (!canvas || !stage) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const natW = imgSizeRef.current.w || 16;
      const natH = imgSizeRef.current.h || 9;
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
    }, 380);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isConnected || permissionDenied) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      twoFingerYRef.current = (pts[0].y + pts[1].y) / 2;
      dragRef.current.active = false;
      return;
    }

    if (dragSelectMode) {
      const pos = clientToScreenNorm(e.clientX, e.clientY);
      if (pos) {
        deck.sendEvent({ type: 'trackpad:abs', payload: { nx: pos.nx, ny: pos.ny, action: 'move' } });
        deck.sendEvent({ type: 'trackpad:drag', payload: { down: true } });
      }
    }

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
    if (!isConnected || permissionDenied) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 2-Finger Direct Scroll right on the Live Screen!
    if (pointersRef.current.size >= 2) {
      const pts = Array.from(pointersRef.current.values());
      const avgY = (pts[0].y + pts[1].y) / 2;
      const deltaY = avgY - twoFingerYRef.current;
      twoFingerYRef.current = avgY;
      if (Math.abs(deltaY) >= 1.5) {
        deck.sendEvent({
          type: 'trackpad:scroll',
          payload: { dx: 0, dy: Math.round(deltaY * 2.2) },
        });
      }
      return;
    }

    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 6) {
      dragRef.current.moved = true;
    }

    if (zoom > 1 && !dragSelectMode && dragRef.current.moved) {
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
    pointersRef.current.delete(e.pointerId);
    if (dragSelectMode) {
      deck.sendEvent({ type: 'trackpad:drag', payload: { down: false } });
    }
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    dragRef.current.moved = false;
    if (!isConnected || permissionDenied || wasMoved || pointersRef.current.size > 0) return;

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
    const canvas = canvasRef.current;
    if (!canvas || !streamReady) return;
    soundEngine.playClick();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.92);
    a.download = `devdeck-screen-${Date.now()}.jpg`;
    a.click();
    deck.showToast(true, 'Screen snapshot saved');
  };

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-[90] flex flex-col gap-2 bg-[#040c11] p-2.5'
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
                isConnected && !paused && streamReady && !permissionDenied
                  ? 'rgba(52,211,153,0.18)'
                  : permissionDenied
                    ? 'rgba(255,93,108,0.18)'
                    : 'rgba(251,191,36,0.16)',
              color:
                isConnected && !paused && streamReady && !permissionDenied
                  ? '#34d399'
                  : permissionDenied
                    ? '#ff5d6c'
                    : '#fbbf24',
            }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected && !paused && streamReady && !permissionDenied
                  ? 'animate-pulse bg-[#34d399]'
                  : permissionDenied
                    ? 'bg-[#ff5d6c]'
                    : 'bg-[#fbbf24]'
              }`}
            />
            {!isConnected
              ? 'OFFLINE'
              : permissionDenied
                ? 'PERM'
                : paused
                  ? 'PAUSED'
                  : streamReady
                    ? `${fps > 0 ? `${fps} FPS` : 'LIVE'}${latencyMs > 0 ? ` · ${latencyMs}ms` : ''}`
                    : 'SYNC…'}
          </span>

          {/* Multi-Monitor Switcher (when 2+ displays detected) */}
          {displays.length > 1 && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setDisplayIdx((i) => (i + 1) % displays.length);
              }}
              className="rounded-lg border border-[#7dd3fc]/35 bg-[#7dd3fc]/15 px-1.5 py-0.5 font-mono-tech text-[8px] font-extrabold text-[#7dd3fc]"
            >
              D{displayIdx + 1}/{displays.length}
            </button>
          )}

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
            title="Toggle Drag-to-Select / Window Drag directly on screen"
            onClick={() => {
              soundEngine.playClick();
              setDragSelectMode((d) => !d);
            }}
            className="flex h-6 items-center gap-0.5 rounded-lg border px-1.5 text-[8px] font-extrabold uppercase"
            style={{
              borderColor: dragSelectMode ? '#a78bfa' : 'rgba(179,229,223,0.22)',
              background: dragSelectMode ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)',
              color: dragSelectMode ? '#c4b5fd' : '#9cb4bb',
            }}
          >
            DRAG
          </button>

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
              setPermissionDenied(false);
              setRetryTick((t) => t + 1);
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
        {isConnected ? (
          <>
            <canvas
              ref={canvasRef}
              className="h-full w-full object-contain transition-transform duration-100"
              style={{
                transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
              }}
            />

            {!streamReady && !permissionDenied && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55">
                <Monitor className="h-5 w-5 animate-pulse text-[#88f1d1]" />
                <span className="font-mono-tech text-[9px] font-bold text-[#88f1d1]">
                  STARTING LIVE SCREEN…
                </span>
              </div>
            )}

            {permissionDenied && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#040c11]/95 p-3 text-center">
                <ShieldAlert className="h-6 w-6 text-[#fbbf24]" />
                <div className="text-[11px] font-extrabold text-white">
                  Enable macOS Screen Recording (1-Time)
                </div>
                <p className="max-w-[260px] text-[9px] leading-relaxed text-[#9cb4bb]">
                  macOS blocks screen capture until you flip the toggle ON for Terminal / Antigravity
                  in <b>System Settings → Privacy &amp; Security → Screen Recording</b>.
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={() => void handleRequestPermission()}
                    className="rounded-xl bg-[#88f1d1] px-3 py-1.5 text-[9.5px] font-extrabold text-[#061c17]"
                  >
                    {requestingPerm ? 'OPENING…' : 'OPEN MAC SETTINGS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setPermissionDenied(false);
                      setRetryTick((t) => t + 1);
                    }}
                    className="rounded-xl border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[9.5px] font-bold text-white"
                  >
                    RETRY
                  </button>
                </div>
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

            {streamReady && !permissionDenied && (
              <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono-tech text-[7.5px] font-bold text-[#cbd5e1]">
                Tap screen to click · Drag to aim · 2x tap to open
              </div>
            )}
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
          disabled={!streamReady}
          className="flex h-6 items-center justify-center gap-0.5 rounded-lg border border-[#88f1d1]/30 bg-[#88f1d1]/12 text-[8.5px] font-extrabold text-[#88f1d1] disabled:opacity-40"
        >
          <Camera className="h-2.5 w-2.5" />
          SNAP
        </button>
      </div>
    </div>
  );
}
