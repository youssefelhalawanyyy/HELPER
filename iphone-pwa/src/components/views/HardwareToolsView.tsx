'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Delete,
  Flame,
  Gamepad2,
  LayoutGrid,
  Loader2,
  Lock,
  MousePointer2,
  Play,
  Presentation,
  RotateCcw,
  ScrollText,
  Sliders,
  Smartphone,
  Sun,
  Unlock,
  Volume2,
  X,
} from 'lucide-react';
import { BrushedDial, DECK_SPRING, HardwareTile } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimer, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { WindowSnapPosition } from '@/types/protocol';

type DialMode = 'volume' | 'brightness' | 'scroll';
type HardwareTab = 'controls' | 'remote';
type TrackpadPreset = 'smooth' | 'macbook' | 'turbo';

/**
 * Industry-standard One-Euro Filter (Casiez et al.) for adaptive touchpad smoothing:
 * heavy jitter rejection at low speed, near-zero phase lag at high speed.
 */
class OneEuro1D {
  private prevX: number | null = null;
  private prevDx = 0;

  reset() {
    this.prevX = null;
    this.prevDx = 0;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(0.001, dt));
  }

  filter(x: number, dt: number, minCutoff: number, beta: number): number {
    if (this.prevX === null) {
      this.prevX = x;
      this.prevDx = 0;
      return x;
    }
    const dx = (x - this.prevX) / Math.max(0.004, dt);
    const aD = this.alpha(1.0, dt);
    const edX = aD * dx + (1 - aD) * this.prevDx;
    this.prevDx = edX;

    const cutoff = minCutoff + beta * Math.abs(edX);
    const a = this.alpha(cutoff, dt);
    const out = a * x + (1 - a) * this.prevX;
    this.prevX = out;
    return out;
  }
}

async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

const SNAP_OPTIONS: Array<{ id: WindowSnapPosition; label: string }> = [
  { id: 'left', label: 'Left ½' },
  { id: 'right', label: 'Right ½' },
  { id: 'maximize', label: 'Full' },
  { id: 'center', label: 'Center' },
  { id: 'top', label: 'Top ½' },
  { id: 'bottom', label: 'Bot ½' },
];

export function HardwareToolsView({ deck }: { deck: DevDeckState }) {
  const [subTab, setSubTab] = useState<HardwareTab>('remote');
  const [remoteRightTab, setRemoteRightTab] = useState<'controller' | 'slides'>('controller');
  const [dialMode, setDialMode] = useState<DialMode>('volume');
  const [dialVal, setDialVal] = useState(deck.mediaState.volume);
  const [uploadingScan, setUploadingScan] = useState(false);
  const [lastScanFile, setLastScanFile] = useState<string | null>(null);
  const [flipEnabled, setFlipEnabled] = useState(false);
  const [flipAction, setFlipAction] = useState<'mute' | 'lock'>('mute');
  const [macLocked, setMacLocked] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSendRef = useRef(0);
  const faceDownTriggeredRef = useRef(false);

  // Trackpad pro filtering (One-Euro filter + Apple ballistic curve + 2-finger inertia scroll + drag lock)
  const [padPreset, setPadPreset] = useState<TrackpadPreset>('macbook');
  const [dragLock, setDragLock] = useState(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const twoFingerRef = useRef(false);
  const padFilterX = useRef(new OneEuro1D());
  const padFilterY = useRef(new OneEuro1D());
  const padLastTsRef = useRef(0);
  const padSubpixelRef = useRef({ rx: 0, ry: 0 });
  const padPendingRef = useRef({ dx: 0, dy: 0, sx: 0, sy: 0 });
  const padScrollVelRef = useRef({ vx: 0, vy: 0 });
  const padEmaVelRef = useRef({ vx: 0, vy: 0 });
  const padMovedDistRef = useRef(0);
  const padRafRef = useRef<number | null>(null);
  const padActiveRef = useRef(false);

  const fireShortcut = (shortcutId: string) => {
    soundEngine.playDetent();
    deck.sendEvent({ type: 'shortcut:trigger', payload: { shortcutId } });
  };

  useEffect(() => {
    return () => {
      if (padRafRef.current) cancelAnimationFrame(padRafRef.current);
    };
  }, []);

  const handleDialChange = (nextVal: number, delta: number) => {
    setDialVal(nextVal);
    if (deck.status === 'connected' && Date.now() - lastSendRef.current > 85) {
      lastSendRef.current = Date.now();
      deck.sendEvent({
        type: 'hardware:dial',
        payload: {
          mode: dialMode,
          delta: dialMode === 'scroll' ? Math.round(delta * -1.2) : Math.round(delta),
          value: dialMode === 'volume' ? Math.round(nextVal) : undefined,
        },
      });
    }
  };

  const handleScanSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !deck.bridgeBaseUrl || !deck.pairing) return;
    setUploadingScan(true);
    try {
      const imageBase64 = await compressImageFile(file);
      const res = await fetch(`${deck.bridgeBaseUrl}/api/scans`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deck.pairing.token}`,
        },
        body: JSON.stringify({ imageBase64 }),
      });
      const data = (await res.json()) as { ok: boolean; filename?: string; error?: string };
      if (res.ok && data.ok) {
        setLastScanFile(data.filename || 'Saved');
        deck.showToast(true, `Scan saved: ${data.filename}`);
        soundEngine.playSuccessChime();
      } else {
        deck.showToast(false, data.error || 'Upload failed');
      }
    } catch {
      deck.showToast(false, 'Could not upload scan');
    } finally {
      setUploadingScan(false);
    }
  };

  const toggleFlip = useCallback(async () => {
    if (flipEnabled) {
      setFlipEnabled(false);
      return;
    }
    const DevOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DevOrient?.requestPermission === 'function') {
      try {
        const perm = await DevOrient.requestPermission();
        if (perm !== 'granted') {
          deck.showToast(false, 'Motion permission denied');
          return;
        }
      } catch {
        deck.showToast(false, 'Motion sensor requires HTTPS on iOS');
        return;
      }
    }
    setFlipEnabled(true);
    deck.showToast(true, `Flip face-down to ${flipAction} armed`);
  }, [deck, flipAction, flipEnabled]);

  useEffect(() => {
    if (!flipEnabled) return;
    const onOrient = (ev: DeviceOrientationEvent) => {
      const beta = ev.beta ?? 0;
      const faceDown = Math.abs(beta) > 152;
      if (faceDown && !faceDownTriggeredRef.current) {
        faceDownTriggeredRef.current = true;
        if (flipAction === 'mute') {
          deck.sendEvent({
            type: 'hardware:mute',
            payload: { requestId: makeRequestId(), muted: true },
          });
        } else {
          setMacLocked(true);
          deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } });
        }
      } else if (!faceDown && Math.abs(beta) < 120) {
        faceDownTriggeredRef.current = false;
      }
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [deck, flipAction, flipEnabled]);

  const dialAccent =
    dialMode === 'volume' ? '#fbbf24' : dialMode === 'brightness' ? '#22d3ee' : '#a78bfa';

  // --- Wireless Trackpad + Presentation Remote Mode ---
  if (subTab === 'remote') {
    return (
      <div className="screen-grid layout-trackpad">
        {/* Left: Smooth Multi-Touch Wireless Trackpad */}
        <div className="tile flex flex-col gap-2 p-3">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <MousePointer2 className="h-4 w-4 text-[#22d3ee]" />
              <span className="disp text-[22px]">Trackpad</span>
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  ['smooth', 'Smooth'],
                  ['macbook', 'MacBook'],
                  ['turbo', 'Turbo'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setPadPreset(id);
                  }}
                  className="rounded-full px-2 py-0.5 text-console-micro font-extrabold uppercase"
                  style={{
                    background: padPreset === id ? '#22d3ee' : 'rgba(255,255,255,0.06)',
                    color: padPreset === id ? '#041317' : '#7c8190',
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setSubTab('controls');
                }}
                className="ml-1 flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-console-caption font-bold text-zinc-200"
              >
                <Sliders className="h-3 w-3 text-[#fbbf24]" />
                Dial
              </button>
            </div>
          </div>

          <div
            data-no-swipe="true"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

              if (pointersRef.current.size >= 2) {
                twoFingerRef.current = true;
              } else {
                twoFingerRef.current = false;
                padMovedDistRef.current = 0;
                padFilterX.current.reset();
                padFilterY.current.reset();
                padSubpixelRef.current = { rx: 0, ry: 0 };
                padEmaVelRef.current = { vx: 0, vy: 0 };
                padPendingRef.current = { dx: 0, dy: 0, sx: 0, sy: 0 };
                padLastTsRef.current = performance.now();
              }

              padActiveRef.current = true;

              const flushLoop = () => {
                if (!padActiveRef.current) {
                  padRafRef.current = null;
                  return;
                }
                const { dx, dy, sx, sy } = padPendingRef.current;
                padPendingRef.current = { dx: 0, dy: 0, sx: 0, sy: 0 };

                if (sx !== 0 || sy !== 0) {
                  deck.sendEvent({
                    type: 'trackpad:scroll',
                    payload: { dx: Math.round(sx), dy: Math.round(sy) },
                  });
                } else if (dx !== 0 || dy !== 0) {
                  const totalX = dx + padSubpixelRef.current.rx;
                  const totalY = dy + padSubpixelRef.current.ry;
                  const outX = Math.trunc(totalX * 10) / 10;
                  const outY = Math.trunc(totalY * 10) / 10;
                  padSubpixelRef.current = { rx: totalX - outX, ry: totalY - outY };
                  if (Math.abs(outX) >= 0.15 || Math.abs(outY) >= 0.15) {
                    deck.sendEvent({
                      type: 'trackpad:move',
                      payload: { dx: outX, dy: outY, drag: dragLock },
                    });
                  }
                }
                padRafRef.current = requestAnimationFrame(flushLoop);
              };
              if (!padRafRef.current) padRafRef.current = requestAnimationFrame(flushLoop);
            }}
            onPointerMove={(e) => {
              const prev = pointersRef.current.get(e.pointerId);
              if (!prev) return;

              const rawDx = e.clientX - prev.x;
              const rawDy = e.clientY - prev.y;
              pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              const dist = Math.hypot(rawDx, rawDy);
              padMovedDistRef.current += dist;

              // Two-finger smooth scroll with momentum velocity capture
              if (pointersRef.current.size >= 2) {
                const sdx = rawDx * 1.45;
                const sdy = rawDy * 1.7;
                padPendingRef.current.sx += sdx;
                padPendingRef.current.sy += sdy;
                padScrollVelRef.current = {
                  vx: padScrollVelRef.current.vx * 0.45 + sdx * 0.55,
                  vy: padScrollVelRef.current.vy * 0.45 + sdy * 0.55,
                };
                return;
              }

              // Ultra-fine micro-tremor deadzone when resting fingertip
              if (dist < 0.12) return;

              const now = performance.now();
              const dt = Math.max(0.004, Math.min(0.05, (now - padLastTsRef.current) / 1000));
              padLastTsRef.current = now;

              // Stage 1: Outlier digitizer spike clamp (prevents sudden cursor jumps)
              const maxJump = 68;
              const clampedDx = Math.max(-maxJump, Math.min(maxJump, rawDx));
              const clampedDy = Math.max(-maxJump, Math.min(maxJump, rawDy));

              // Stage 2: One-Euro Adaptive Filter (faster, silkier laptop-grade response)
              const cfg =
                padPreset === 'smooth'
                  ? { minCutoff: 1.5, beta: 0.065, baseGain: 1.45, accel: 0.58, maxGain: 5.2, ema: 0.58 }
                  : padPreset === 'turbo'
                    ? { minCutoff: 4.2, beta: 0.22, baseGain: 2.35, accel: 0.95, maxGain: 9.5, ema: 0.82 }
                    : { minCutoff: 2.8, beta: 0.14, baseGain: 1.85, accel: 0.78, maxGain: 7.4, ema: 0.72 };

              const fx = padFilterX.current.filter(clampedDx, dt, cfg.minCutoff, cfg.beta);
              const fy = padFilterY.current.filter(clampedDy, dt, cfg.minCutoff, cfg.beta);

              // Stage 3: Velocity-Adaptive EMA Polish (removes 60Hz stair-stepping)
              const px = cfg.ema * fx + (1 - cfg.ema) * padEmaVelRef.current.vx;
              const py = cfg.ema * fy + (1 - cfg.ema) * padEmaVelRef.current.vy;
              padEmaVelRef.current = { vx: px, vy: py };

              // Stage 4: MacBook Pro ballistic velocity acceleration curve
              const velocityPxPerSec = Math.hypot(px, py) / dt;
              const speedNorm = Math.min(30, velocityPxPerSec / 90);
              const gain = Math.min(
                cfg.maxGain,
                cfg.baseGain + Math.pow(speedNorm, 1.2) * cfg.accel,
              );

              padPendingRef.current.dx += px * gain;
              padPendingRef.current.dy += py * gain;
            }}
            onPointerUp={(e) => {
              pointersRef.current.delete(e.pointerId);
              if (pointersRef.current.size === 0) {
                padActiveRef.current = false;
                if (padRafRef.current) {
                  cancelAnimationFrame(padRafRef.current);
                  padRafRef.current = null;
                }
                if (padMovedDistRef.current < 8) {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'trackpad:click',
                    payload: { button: twoFingerRef.current ? 'right' : 'left' },
                  });
                } else if (twoFingerRef.current) {
                  // Smooth MacBook-style 2-finger inertia scroll glide on release
                  let { vx, vy } = padScrollVelRef.current;
                  const glide = () => {
                    if (padActiveRef.current || (Math.abs(vx) < 0.7 && Math.abs(vy) < 0.7)) {
                      return;
                    }
                    deck.sendEvent({
                      type: 'trackpad:scroll',
                      payload: { dx: Math.round(vx), dy: Math.round(vy) },
                    });
                    vx *= 0.84;
                    vy *= 0.84;
                    padRafRef.current = requestAnimationFrame(glide);
                  };
                  if (Math.abs(vx) >= 1.5 || Math.abs(vy) >= 1.5) {
                    padRafRef.current = requestAnimationFrame(glide);
                  }
                }
                padScrollVelRef.current = { vx: 0, vy: 0 };
                twoFingerRef.current = false;
              }
            }}
            onPointerCancel={(e) => {
              pointersRef.current.delete(e.pointerId);
              if (pointersRef.current.size === 0) {
                padActiveRef.current = false;
              }
            }}
            className="grid flex-1 touch-none place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.09),rgba(0,0,0,0.88))]"
          >
            <div className="pointer-events-none text-center">
              <div className="sub">1-Finger Move &amp; Tap · 2-Finger Scroll &amp; Right-Click</div>
              <div className="mt-0.5 text-console-caption text-[#22d3ee]/70">
                One-Euro Filter · 120Hz Native CoreGraphics Interpolation
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'trackpad:click', payload: { button: 'left' } });
              }}
              className="rounded-xl border border-white/10 bg-white/[0.06] py-2 text-console-caption font-extrabold text-white"
            >
              LEFT CLICK
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                soundEngine.playClick();
                const next = !dragLock;
                setDragLock(next);
                deck.sendEvent({ type: 'trackpad:drag', payload: { down: next } });
              }}
              className="rounded-xl border py-2 text-console-caption font-extrabold"
              style={{
                background: dragLock ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.06)',
                borderColor: dragLock ? '#34d399' : 'rgba(255,255,255,0.1)',
                color: dragLock ? '#34d399' : '#fbbf24',
              }}
            >
              {dragLock ? 'DRAGGING…' : 'DRAG HOLD'}
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'trackpad:click', payload: { button: 'right' } });
              }}
              className="rounded-xl border border-white/10 bg-white/[0.06] py-2 text-console-caption font-extrabold text-[#22d3ee]"
            >
              RIGHT CLICK
            </motion.button>
          </div>
        </div>

        {/* Right: Game-Controller Action Pad & Slide Clicker */}
        <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-gradient-to-r from-[#a78bfa] to-[#34d399]" />

          {/* Header Switcher: Controller vs Slide Clicker */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex rounded-full bg-black/75 p-0.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteRightTab('controller');
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: remoteRightTab === 'controller' ? '#1f222c' : 'transparent',
                  color: remoteRightTab === 'controller' ? '#a78bfa' : '#7c8190',
                }}
              >
                <Gamepad2 className="h-3 w-3" />
                Controller
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteRightTab('slides');
                }}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: remoteRightTab === 'slides' ? '#1f222c' : 'transparent',
                  color: remoteRightTab === 'slides' ? '#34d399' : '#7c8190',
                }}
              >
                <Presentation className="h-3 w-3" />
                Slides
              </button>
            </div>
            <span className="font-mono-tech text-console-micro text-zinc-500 uppercase">L1 / D-PAD</span>
          </div>

          {remoteRightTab === 'controller' ? (
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-1.5">
              {/* Top Shoulder Bumpers (Back / Forward / Switch App / Mission Control) */}
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'nav.back', label: '← BACK', color: '#22d3ee' },
                    { id: 'nav.forward', label: 'FWD →', color: '#22d3ee' },
                    { id: 'nav.switchApp', label: 'SWITCH', color: '#a78bfa' },
                    { id: 'nav.missionControl', label: 'EXPOSE', color: '#fbbf24' },
                  ] as const
                ).map((b) => (
                  <motion.button
                    key={b.id}
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => fireShortcut(b.id)}
                    className="h-7 rounded-xl border border-white/[0.08] bg-white/[0.05] text-console-micro font-extrabold whitespace-nowrap"
                    style={{ color: b.color }}
                  >
                    {b.label}
                  </motion.button>
                ))}
              </div>

              {/* Center Ergonomic Cross D-Pad + Face Action Buttons */}
              <div className="grid min-h-0 flex-1 grid-cols-12 gap-2">
                {/* 3x3 Cross D-Pad */}
                <div className="col-span-7 grid grid-cols-3 grid-rows-3 gap-1">
                  <div />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fireShortcut('nav.up')}
                    aria-label="Up"
                    className="hw-key grid place-items-center rounded-xl text-white"
                  >
                    <ArrowUp className="h-4 w-4 text-[#22d3ee]" />
                  </motion.button>
                  <div />

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fireShortcut('nav.left')}
                    aria-label="Left"
                    className="hw-key grid place-items-center rounded-xl text-white"
                  >
                    <ArrowLeft className="h-4 w-4 text-[#22d3ee]" />
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fireShortcut('nav.enter')}
                    aria-label="Enter / OK"
                    className="grid place-items-center rounded-xl bg-[#34d399] text-[#04130c]"
                    style={{ boxShadow: '0 2px 0 #14664a' }}
                  >
                    <CornerDownLeft className="h-4 w-4" />
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fireShortcut('nav.right')}
                    aria-label="Right"
                    className="hw-key grid place-items-center rounded-xl text-white"
                  >
                    <ArrowRight className="h-4 w-4 text-[#22d3ee]" />
                  </motion.button>

                  <div />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fireShortcut('nav.down')}
                    aria-label="Down"
                    className="hw-key grid place-items-center rounded-xl text-white"
                  >
                    <ArrowDown className="h-4 w-4 text-[#22d3ee]" />
                  </motion.button>
                  <div />
                </div>

                {/* Right 2x2 Face Buttons (A / B / X / Y style) */}
                <div className="col-span-5 grid grid-cols-2 grid-rows-2 gap-1.5">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => fireShortcut('nav.escape')}
                    className="flex flex-col items-center justify-center rounded-xl border border-[#ff5d6c]/40 bg-[#ff5d6c]/15 text-console-micro font-extrabold text-[#ff5d6c]"
                  >
                    <X className="h-3.5 w-3.5" />
                    ESC
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => fireShortcut('nav.space')}
                    className="flex flex-col items-center justify-center rounded-xl border border-[#34d399]/40 bg-[#34d399]/15 text-console-micro font-extrabold text-[#34d399]"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    SPACE
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => fireShortcut('nav.backspace')}
                    className="flex flex-col items-center justify-center rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/15 text-console-micro font-extrabold text-[#fbbf24]"
                  >
                    <Delete className="h-3.5 w-3.5" />
                    DEL
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={() => fireShortcut('system.undo')}
                    className="flex flex-col items-center justify-center rounded-xl border border-[#a78bfa]/40 bg-[#a78bfa]/15 text-console-micro font-extrabold text-[#c4b5fd]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    UNDO
                  </motion.button>
                </div>
              </div>

              {/* Bottom Quick Action Bar (Copy / Paste / New Tab / Close Tab) */}
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'system.copy', label: 'COPY' },
                    { id: 'system.paste', label: 'PASTE' },
                    { id: 'chrome.newTab', label: '+ TAB' },
                    { id: 'chrome.closeTab', label: '✕ TAB' },
                  ] as const
                ).map((b) => (
                  <motion.button
                    key={b.id}
                    type="button"
                    whileTap={{ scale: 0.93 }}
                    onClick={() => fireShortcut(b.id)}
                    className="h-7 rounded-xl border border-white/[0.08] bg-white/[0.05] text-console-micro font-extrabold whitespace-nowrap text-zinc-200"
                  >
                    {b.label}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="grid flex-1 grid-cols-2 gap-2">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={DECK_SPRING}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'presentation:key',
                      payload: { requestId: makeRequestId(), action: 'prev' },
                    });
                  }}
                  className="hw-key flex flex-col items-center justify-center rounded-2xl text-zinc-200"
                >
                  <ChevronLeft className="h-8 w-8 text-[#fbbf24]" />
                  <span className="sub mt-1">PREV SLIDE</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={DECK_SPRING}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'presentation:key',
                      payload: { requestId: makeRequestId(), action: 'next' },
                    });
                  }}
                  className="flex flex-col items-center justify-center rounded-2xl bg-[#34d399] text-[#04130c]"
                  style={{ boxShadow: '0 4px 0 #14664a' }}
                >
                  <ChevronRight className="h-8 w-8" />
                  <span className="mt-1 text-console-caption font-extrabold uppercase tracking-wider">
                    NEXT SLIDE
                  </span>
                </motion.button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'presentation:key',
                      payload: { requestId: makeRequestId(), action: 'start' },
                    });
                  }}
                  className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 text-console-caption font-bold text-[#34d399]"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Present
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'presentation:key',
                      payload: { requestId: makeRequestId(), action: 'escape' },
                    });
                  }}
                  className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 text-console-caption font-bold text-[#ff5d6c]"
                >
                  <X className="h-3 w-3" />
                  Exit (Esc)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="screen-grid layout-hardware"
    >
      {/* Left Spanning Rotary Smart Dial + Remote Switch */}
      <div
        className="tile flex flex-col items-center justify-between p-3"
      >
        <div
          className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full"
          style={{ background: dialAccent }}
        />
        <div className="flex w-full items-center justify-between">
          <span className="disp text-[22px]">Dial</span>
          <div className="flex gap-1">
            {(
              [
                ['volume', Volume2],
                ['brightness', Sun],
                ['scroll', ScrollText],
              ] as const
            ).map(([m, Icon]) => (
              <button
                key={m}
                type="button"
                aria-label={m}
                onClick={() => {
                  soundEngine.playClick();
                  setDialMode(m);
                }}
                className="grid h-6 w-6 place-items-center rounded-lg"
                style={{
                  background: dialMode === m ? `${dialAccent}28` : 'rgba(255,255,255,.05)',
                  color: dialMode === m ? dialAccent : '#7c8190',
                }}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>

        <BrushedDial
          value={dialVal}
          onChange={handleDialChange}
          accent={dialAccent}
          size={122}
          label={`Mac ${dialMode} dial`}
        />

        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            setSubTab('remote');
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#22d3ee]/35 bg-[#22d3ee]/10 py-1.5 text-console-caption font-extrabold text-[#22d3ee]"
        >
          <MousePointer2 className="h-3 w-3" />
          TRACKPAD &amp; SLIDES
        </button>
      </div>

      {/* Top-Middle: Window Tiling Snap Pad */}
      <div className="tile flex flex-col justify-between p-3">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
        <div className="flex items-center justify-between">
          <span className="disp text-[20px]">Window Snap</span>
          <LayoutGrid className="h-4 w-4 text-[#22d3ee]" />
        </div>
        <div className="my-1 grid grid-cols-3 gap-1.5">
          {SNAP_OPTIONS.map((opt) => (
            <motion.button
              key={opt.id}
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={DECK_SPRING}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({
                  type: 'window:snap',
                  payload: { requestId: makeRequestId(), position: opt.id },
                });
              }}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] py-1.5 text-console-caption font-extrabold text-zinc-200 hover:border-[#22d3ee]/50 hover:text-[#22d3ee]"
            >
              {opt.label}
            </motion.button>
          ))}
        </div>
        <div className="sub">Snap active Mac window</div>
      </div>

      {/* Top-Right: Deep Work Focus */}
      <HardwareTile
        accent="#fbbf24"
        title={'Deep\nFocus'}
        icon={<Flame className="h-5 w-5" />}
        active={deck.focusState.active}
        onClick={() => {
          if (deck.focusState.active) {
            deck.sendEvent({ type: 'focus:stop', payload: { requestId: makeRequestId() } });
          } else {
            deck.sendEvent({
              type: 'focus:start',
              payload: { requestId: makeRequestId(), durationMin: 25 },
            });
          }
        }}
        sub={deck.focusState.active ? 'DND active · tap to stop' : '25m Pomodoro + macOS DND'}
      >
        {deck.focusState.active && (
          <div className="num text-[22px] font-extrabold text-[#fbbf24]">
            {formatTimer(deck.focusState.remainingSec)}
          </div>
        )}
      </HardwareTile>

      {/* Bottom-Middle: Desk Scan + Flip Sensor */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleScanSelected}
        className="hidden"
      />
      <div className="grid grid-cols-2 gap-2">
        <HardwareTile
          accent="#34d399"
          title={'Desk\nScan'}
          icon={
            uploadingScan ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )
          }
          active={uploadingScan}
          onClick={() => fileInputRef.current?.click()}
          sub={lastScanFile ? lastScanFile : '→ /scans'}
          className="!p-2.5"
        />

        <HardwareTile
          accent="#a78bfa"
          title={'Flip\nMode'}
          icon={<Smartphone className="h-4 w-4" />}
          active={flipEnabled}
          onClick={() => void toggleFlip()}
          sub={flipEnabled ? `Armed (${flipAction})` : 'Face-down'}
          className="!p-2.5"
        >
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {(['mute', 'lock'] as const).map((a) => (
              <span
                key={a}
                role="button"
                tabIndex={0}
                onClick={() => setFlipAction(a)}
                className="rounded-full px-1.5 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: flipAction === a ? '#a78bfa' : 'rgba(255,255,255,.07)',
                  color: flipAction === a ? '#090612' : '#7c8190',
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </HardwareTile>
      </div>

      {/* Bottom-Right: Lock Mac -> flips to Open / Wake Mac */}
      <HardwareTile
        accent={macLocked ? '#34d399' : '#ff5d6c'}
        title={macLocked ? 'Open\nMac' : 'Lock\nMac'}
        icon={macLocked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        active={macLocked}
        onClick={() => {
          if (macLocked) {
            setMacLocked(false);
            deck.sendEvent({ type: 'hardware:wake', payload: { requestId: makeRequestId() } });
          } else {
            setMacLocked(true);
            deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } });
          }
        }}
        sub={macLocked ? 'Tap to wake Mac display' : 'Sleep display · flips to Open Mac'}
      />
    </div>
  );
}
