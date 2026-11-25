'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Expand,
  Hand,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Shrink,
  X,
  ZoomIn,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
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
  const [dragSelectMode, setDragSelectMode] = useState(false);
  const [fillMode, setFillMode] = useState<'contain' | 'cover'>('contain');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [kbdOpen, setKbdOpen] = useState(false);
  const [kbdText, setKbdText] = useState('');
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
  const [ripples, setRipples] = useState<TapRipple[]>([]);
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgSizeRef = useRef({ w: 16, h: 9 });
  const lastTapRef = useRef<{ ts: number; nx: number; ny: number }>({ ts: 0, nx: 0, ny: 0 });
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ span: number; zoom: number; midX: number; midY: number } | null>(
    null,
  );
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
  const hudTimerRef = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  const isConnected =
    deck.status === 'connected' && Boolean(deck.bridgeBaseUrl && deck.pairing?.token);

  // Auto-hide floating HUD in Fullscreen Touchscreen Laptop Mode after 4s of inactivity
  const bumpHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    if (fullscreen && !kbdOpen) {
      hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 4000);
    }
  }, [fullscreen, kbdOpen]);

  useEffect(() => {
    if (fullscreen) {
      bumpHud();
      // Auto-upgrade to Crisp 1440p in fullscreen if user was on default
      setQuality((q) => (q === 'turbo' ? 'balanced' : q));
    } else {
      setHudVisible(true);
      setKbdOpen(false);
    }
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [fullscreen, bumpHud]);

  // Fetch available monitors (Display 1 / Display 2)
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

  // Ultra-fast zero-delay Retina canvas frame pump (works over LAN Wi-Fi + Cloudflare HTTPS + iOS Safari)
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
            await new Promise((r) => setTimeout(r, 1800));
            continue;
          }

          if (res.status === 204 || !res.ok) {
            await new Promise((r) => setTimeout(r, 80));
            continue;
          }

          const nextSeq = Number(res.headers.get('x-screen-seq') || 0);
          if (nextSeq > 0) seq = nextSeq;

          const blob = await res.blob();
          if (cancelled || blob.size < 100) continue;

          const canvas = canvasRef.current;
          if (!canvas) continue;
          const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          if (!ctx) continue;

          if (typeof createImageBitmap === 'function') {
            const bmp = await createImageBitmap(blob);
            if (!cancelled) {
              if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
                canvas.width = bmp.width;
                canvas.height = bmp.height;
                imgSizeRef.current = { w: bmp.width, h: bmp.height };
              }
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
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
                  ctx.imageSmoothingEnabled = true;
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
        } catch {
          if (cancelled) break;
          await new Promise((r) => setTimeout(r, 180));
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
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
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

  // Exact normalized (0..1, 0..1) screen mapping for both object-contain & object-cover + zoom/pan
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

      if (fillMode === 'contain') {
        if (boxAspect > imgAspect) {
          renderH = rect.height;
          renderW = renderH * imgAspect;
          offsetX = (rect.width - renderW) / 2;
        } else {
          renderW = rect.width;
          renderH = renderW / imgAspect;
          offsetY = (rect.height - renderH) / 2;
        }
      } else {
        if (boxAspect > imgAspect) {
          renderW = rect.width;
          renderH = renderW / imgAspect;
          offsetY = (rect.height - renderH) / 2;
        } else {
          renderH = rect.height;
          renderW = renderH * imgAspect;
          offsetX = (rect.width - renderW) / 2;
        }
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
    [fillMode],
  );

  const pushRipple = useCallback((xPct: number, yPct: number, kind: 'left' | 'right' | 'double') => {
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev.slice(-3), { id, xPct, yPct, kind }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 360);
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isConnected || permissionDenied) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 2-Finger Pinch-to-Zoom & Smooth 2-Finger Scroll
    if (pointersRef.current.size === 2) {
      clearLongPress();
      const pts = Array.from(pointersRef.current.values());
      const span = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartRef.current = {
        span: Math.max(20, span),
        zoom,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
      dragRef.current.active = false;
      return;
    }

    longPressFiredRef.current = false;
    const pos = clientToScreenNorm(e.clientX, e.clientY);

    if (dragSelectMode && pos) {
      deck.sendEvent({ type: 'trackpad:abs', payload: { nx: pos.nx, ny: pos.ny, action: 'move' } });
      deck.sendEvent({ type: 'trackpad:drag', payload: { down: true } });
    } else if (pos) {
      // 450ms Long-Press = Native Touchscreen Right-Click!
      clearLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        if (!dragRef.current.moved && pointersRef.current.size === 1) {
          longPressFiredRef.current = true;
          soundEngine.playDetent();
          pushRipple(pos.xPct, pos.yPct, 'right');
          deck.sendEvent({
            type: 'trackpad:abs',
            payload: { nx: pos.nx, ny: pos.ny, action: 'right' },
          });
        }
      }, 450);
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

    // 2-Finger Pinch-to-Zoom OR 2-Finger Direct Scroll on Screen
    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const span = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const scaleRatio = span / pinchStartRef.current.span;

      if (Math.abs(scaleRatio - 1) > 0.14) {
        const nextZoom = Math.max(1, Math.min(3, Number((pinchStartRef.current.zoom * scaleRatio).toFixed(2))));
        setZoom(nextZoom);
        if (nextZoom <= 1.02) setPan({ x: 0, y: 0 });
      } else {
        const dx = midX - pinchStartRef.current.midX;
        const dy = midY - pinchStartRef.current.midY;
        pinchStartRef.current.midX = midX;
        pinchStartRef.current.midY = midY;
        if (Math.abs(dx) >= 1.2 || Math.abs(dy) >= 1.2) {
          deck.sendEvent({
            type: 'trackpad:scroll',
            payload: { dx: Math.round(dx * 2.0), dy: Math.round(dy * 2.4) },
          });
        }
      }
      return;
    }

    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 6) {
      dragRef.current.moved = true;
      clearLongPress();
    }

    if (zoom > 1 && !dragSelectMode && dragRef.current.moved) {
      const maxPan = (zoom - 1) * 50;
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
    clearLongPress();
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (dragSelectMode) {
      deck.sendEvent({ type: 'trackpad:drag', payload: { down: false } });
    }
    const wasMoved = dragRef.current.moved;
    const wasLongPress = longPressFiredRef.current;
    dragRef.current.active = false;
    dragRef.current.moved = false;
    longPressFiredRef.current = false;

    if (!isConnected || permissionDenied || wasMoved || wasLongPress || pointersRef.current.size > 0) {
      return;
    }

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

  const toggleFullscreen = () => {
    soundEngine.playClick();
    setFullscreen((prev) => {
      const next = !prev;
      if (next) {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  };

  const cycleZoom = () => {
    soundEngine.playClick();
    setZoom((z) => {
      const next = z < 1.5 ? 1.75 : z < 2.2 ? 2.5 : 1;
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const saveSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas || !streamReady) return;
    soundEngine.playClick();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.94);
    a.download = `devdeck-screen-${Date.now()}.jpg`;
    a.click();
    deck.showToast(true, 'HD screen snapshot saved');
  };

  const sendSpecialKey = (
    key: 'esc' | 'tab' | 'enter' | 'backspace' | 'undo' | 'copy' | 'paste' | 'spotlight' | 'left' | 'up' | 'down' | 'right',
  ) => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'hardware:key', payload: { requestId: makeRequestId(), key } });
  };

  const controlsBar = (
    <div
      className={
        fullscreen
          ? 'flex flex-wrap items-center justify-between gap-1.5 rounded-2xl border border-[#88f1d1]/25 bg-[#061218]/92 px-2.5 py-1.5 shadow-2xl'
          : 'flex flex-wrap items-center justify-between gap-1'
      }
      onClick={() => bumpHud()}
    >
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

        <div className="flex rounded-lg border border-[#98c8ce29] bg-[#071117] p-0.5">
          {(
            [
              ['turbo', 'FAST'],
              ['balanced', 'CRISP'],
              ['hd', 'ULTRA'],
            ] as const
          ).map(([q, lbl]) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setQuality(q);
              }}
              className="rounded px-1.5 py-0.5 text-[7.5px] font-extrabold uppercase"
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
          title="Fit vs Fill entire iPhone screen"
          onClick={() => {
            soundEngine.playClick();
            setFillMode((m) => (m === 'contain' ? 'cover' : 'contain'));
          }}
          className="flex h-6 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.05] px-1.5 text-[8px] font-extrabold text-[#effaf7] uppercase"
        >
          {fillMode === 'cover' ? <Shrink className="h-2.5 w-2.5 text-[#88f1d1]" /> : <Expand className="h-2.5 w-2.5 text-[#7dd3fc]" />}
          {fillMode === 'cover' ? 'FILL' : 'FIT'}
        </button>

        <button
          type="button"
          title="Toggle Drag-to-Select / Window Drag"
          onClick={() => {
            soundEngine.playClick();
            setDragSelectMode((d) => !d);
          }}
          className="flex h-6 items-center gap-0.5 rounded-lg border px-1.5 text-[8px] font-extrabold uppercase"
          style={{
            borderColor: dragSelectMode ? '#a78bfa' : 'rgba(179,229,223,0.2)',
            background: dragSelectMode ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.05)',
            color: dragSelectMode ? '#c4b5fd' : '#9cb4bb',
          }}
        >
          <Hand className="h-2.5 w-2.5" />
          DRAG
        </button>

        <button
          type="button"
          title="Left vs Right Click on tap (or long-press anytime for right-click)"
          onClick={() => {
            soundEngine.playClick();
            setClickMode((m) => (m === 'left' ? 'right' : 'left'));
          }}
          className="flex h-6 items-center gap-0.5 rounded-lg border px-1.5 text-[8px] font-extrabold uppercase"
          style={{
            borderColor: clickMode === 'right' ? '#fbbf24' : 'rgba(179,229,223,0.2)',
            background: clickMode === 'right' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.05)',
            color: clickMode === 'right' ? '#fbbf24' : '#88f1d1',
          }}
        >
          <MousePointerClick className="h-2.5 w-2.5" />
          {clickMode === 'right' ? 'R-TAP' : 'L-TAP'}
        </button>

        <button
          type="button"
          title="Cycle Zoom (or 2-finger pinch)"
          onClick={cycleZoom}
          className="flex h-6 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.05] px-1.5 font-mono-tech text-[8px] font-extrabold text-[#effaf7]"
        >
          <ZoomIn className="h-2.5 w-2.5 text-[#7dd3fc]" />
          {zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}x
        </button>

        {fullscreen && (
          <button
            type="button"
            title="Touchscreen Laptop Keyboard"
            onClick={() => {
              soundEngine.playClick();
              setKbdOpen((v) => !v);
            }}
            className="flex h-6 items-center gap-0.5 rounded-lg border px-1.5 text-[8px] font-extrabold uppercase"
            style={{
              borderColor: kbdOpen ? '#7dd3fc' : 'rgba(255,255,255,0.12)',
              background: kbdOpen ? 'rgba(125,211,252,0.22)' : 'rgba(255,255,255,0.05)',
              color: kbdOpen ? '#7dd3fc' : '#effaf7',
            }}
          >
            <Keyboard className="h-3 w-3" />
            KEYS
          </button>
        )}

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
          aria-label={fullscreen ? 'Exit full mobile screen' : 'Full mobile touchscreen laptop mode'}
          onClick={toggleFullscreen}
          className="flex h-6 items-center gap-1 rounded-lg border border-[#88f1d1]/45 bg-[#88f1d1]/18 px-2 text-[8px] font-extrabold text-[#88f1d1] uppercase"
        >
          {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          {fullscreen ? 'EXIT' : 'FULL'}
        </button>
      </div>
    </div>
  );

  const stageElement = (
    <div
      ref={stageRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        clearLongPress();
        pointersRef.current.clear();
        pinchStartRef.current = null;
        dragRef.current.active = false;
        dragRef.current.moved = false;
      }}
      className={
        fullscreen
          ? 'relative flex h-full w-full flex-1 touch-none select-none items-center justify-center overflow-hidden bg-black'
          : 'relative flex min-h-[155px] flex-1 touch-none select-none items-center justify-center overflow-hidden rounded-xl border border-[#88f1d1]/30 bg-black shadow-inner'
      }
    >
      {isConnected ? (
        <>
          <canvas
            ref={canvasRef}
            className="h-full w-full transition-transform duration-75"
            style={{
              objectFit: fillMode,
              transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
            }}
          />

          {!streamReady && !permissionDenied && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/65">
              <Monitor className="h-6 w-6 animate-pulse text-[#88f1d1]" />
              <span className="font-mono-tech text-[9.5px] font-bold text-[#88f1d1]">
                STARTING RETINA SCREEN STREAM…
              </span>
            </div>
          )}

          {permissionDenied && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#040c11]/95 p-3 text-center">
              <ShieldAlert className="h-6 w-6 text-[#fbbf24]" />
              <div className="text-[11px] font-extrabold text-white">
                Enable macOS Screen Recording (1-Time)
              </div>
              <p className="max-w-[270px] text-[9px] leading-relaxed text-[#9cb4bb]">
                Flip ON Screen Recording for Terminal / Antigravity in{' '}
                <b>System Settings → Privacy &amp; Security → Screen Recording</b>.
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

          {/* Crisp Touchscreen Tap Ripples */}
          {ripples.map((r) => (
            <span
              key={r.id}
              aria-hidden="true"
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2"
              style={{
                left: `${r.xPct}%`,
                top: `${r.yPct}%`,
                width: r.kind === 'double' ? 30 : 22,
                height: r.kind === 'double' ? 30 : 22,
                borderColor: r.kind === 'right' ? '#fbbf24' : '#88f1d1',
              }}
            />
          ))}

          {!fullscreen && streamReady && !permissionDenied && (
            <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono-tech text-[7.5px] font-bold text-[#cbd5e1]">
              Tap: Click · Hold: Right-Click · 2-Finger: Scroll/Zoom
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
  );

  // TRUE 100% EDGE-TO-EDGE FULL MOBILE TOUCHSCREEN LAPTOP PORTAL
  if (fullscreen && mounted) {
    return createPortal(
      <div
        data-no-swipe="true"
        className="fixed inset-0 z-[9999] flex h-[100dvh] w-[100vw] flex-col overflow-hidden bg-black"
      >
        {/* Full Edge-to-Edge Live Laptop Screen */}
        {stageElement}

        {/* Floating Auto-Hiding Top Touchscreen Laptop HUD */}
        <div className="pointer-events-none fixed top-2 right-2 left-2 z-[10000] flex flex-col items-center gap-1.5">
          {hudVisible ? (
            <div className="pointer-events-auto flex w-full max-w-[96vw] items-center justify-center gap-1.5">
              {controlsBar}
              <button
                type="button"
                aria-label="Hide toolbar"
                onClick={() => setHudVisible(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 bg-[#061218]/90 text-[#9cb4bb]"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={bumpHud}
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-[#88f1d1]/30 bg-[#061218]/75 px-3 py-0.5 font-mono-tech text-[8.5px] font-extrabold text-[#88f1d1] shadow-lg"
            >
              <ChevronDown className="h-3 w-3" />
              {fps > 0 ? `${fps} FPS` : 'LIVE'} · CONTROLS
            </button>
          )}
        </div>

        {/* Floating On-Screen Laptop Keyboard & Shortcut Drawer */}
        {kbdOpen && (
          <div className="fixed right-2 bottom-2 left-2 z-[10001] mx-auto max-w-2xl space-y-1.5 rounded-2xl border border-[#7dd3fc]/40 bg-[#061218]/96 p-2 shadow-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!kbdText) return;
                soundEngine.playClick();
                deck.sendEvent({
                  type: 'hardware:type',
                  payload: { requestId: makeRequestId(), text: kbdText, enter: true },
                });
                setKbdText('');
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                autoFocus
                value={kbdText}
                onChange={(e) => setKbdText(e.target.value)}
                placeholder="Type directly onto your laptop screen…"
                className="font-mono-tech h-8 min-w-0 flex-1 rounded-xl border border-white/15 bg-black/80 px-2.5 text-xs text-white outline-none focus:border-[#7dd3fc]"
              />
              <button
                type="button"
                onClick={() => {
                  if (!kbdText) return;
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'hardware:type',
                    payload: { requestId: makeRequestId(), text: kbdText, enter: false },
                  });
                  setKbdText('');
                }}
                className="h-8 rounded-xl bg-white/10 px-2.5 text-[10px] font-extrabold text-white"
              >
                TYPE
              </button>
              <button
                type="submit"
                className="flex h-8 items-center gap-1 rounded-xl bg-[#7dd3fc] px-3 text-[10px] font-extrabold text-[#04141c]"
              >
                <Send className="h-3 w-3" />
                ↵
              </button>
              <button
                type="button"
                onClick={() => setKbdOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['esc', 'ESC'],
                  ['tab', 'TAB'],
                  ['undo', 'UNDO'],
                  ['copy', 'COPY'],
                  ['paste', 'PASTE'],
                  ['spotlight', 'SEARCH'],
                  ['left', '←'],
                  ['up', '↑'],
                  ['down', '↓'],
                  ['right', '→'],
                  ['backspace', '⌫'],
                  ['enter', '↵'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => sendSpecialKey(k)}
                  className="font-mono-tech rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[9.5px] font-extrabold text-[#effaf7] active:bg-[#7dd3fc]/25"
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1" data-no-swipe="true">
      {controlsBar}
      {stageElement}
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
