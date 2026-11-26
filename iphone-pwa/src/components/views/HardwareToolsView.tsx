'use client';

import {bridgeRequest} from '@/lib/bridgeRequest';
import { TrackpadAccessories } from './TrackpadAccessories';
import { LiveScreenPreview } from './LiveScreenPreview';
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
  Keyboard,
  LayoutGrid,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
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
  const [remoteRightTab, setRemoteRightTab] = useState<'controller' | 'slides' | 'preview'>('controller');
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

  // Trackpad pro filtering (One-Euro filter + Apple ballistic curve + 2-finger inertia scroll + double-tap drag + edge scroll + Air Mouse)
  const [padPreset, setPadPreset] = useState<TrackpadPreset>('macbook');
  const [dragLock, setDragLock] = useState(false);
  const [padExpanded, setPadExpanded] = useState(false);
  const [airMouseActive, setAirMouseActive] = useState(false);
  const [screenPeekOn, setScreenPeekOn] = useState(false);
  const [screenPeekTick, setScreenPeekTick] = useState(0);
  const [remoteKbdOpen, setRemoteKbdOpen] = useState(false);
  const [kbdInput, setKbdInput] = useState('');

  useEffect(() => {
    if (!screenPeekOn || deck.status !== 'connected') return;
    setScreenPeekTick(Date.now());
  }, [screenPeekOn, deck.status]);

  const sendSpecialKey = (
    key:
      | 'esc'
      | 'tab'
      | 'enter'
      | 'backspace'
      | 'up'
      | 'down'
      | 'left'
      | 'right'
      | 'undo'
      | 'copy'
      | 'paste'
      | 'selectAll'
      | 'spotlight',
  ) => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'hardware:key', payload: { requestId: makeRequestId(), key } });
  };
  const [touchVisual, setTouchVisual] = useState<{
    active: boolean;
    xPct: number;
    yPct: number;
    mode: 'move' | 'scroll' | 'drag' | 'air';
  }>({ active: false, xPct: 50, yPct: 50, mode: 'move' });

  const gesture = useRef<{ mode: 'pending' | 'scroll' | 'edge-scroll' | 'zoom' | 'spaces' | 'done'; span: number; x: number; y: number }>({
    mode: 'pending',
    span: 0,
    x: 0,
    y: 0,
  });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [precision,setPrecision]=useState(false),[lens,setLens]=useState('');
  const precisionOn=useRef(false), precisionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const primaryTouch=useRef(-1);
  function releasePrecision(){clearTimeout(precisionTimer.current);const active=precisionOn.current;precisionOn.current=false;setPrecision(false);return active;}
  useEffect(()=>()=>clearTimeout(precisionTimer.current),[]);
  const {bridgeBaseUrl,pairing}=deck;
  useEffect(()=>{if(!precision)return;const ctrl=new AbortController();let timer:ReturnType<typeof setTimeout>;setLens('');
    async function sample(){try{const r=await bridgeRequest<{image:string}>({bridgeBaseUrl,pairing},'cursor-lens',undefined,ctrl.signal);
      if(!ctrl.signal.aborted){setLens(r.image);timer=setTimeout(sample,250);}
    }catch{if(!ctrl.signal.aborted)setLens('unavailable');}}
    void sample();return ()=>{ctrl.abort();clearTimeout(timer);};
  },[precision,bridgeBaseUrl,pairing]);
  const maxFingersRef = useRef(1);
  const lastSingleTapTsRef = useRef(0);
  const tempTapDragRef = useRef(false);
  const clickFreezeUntilRef = useRef(0);
  const airPausedByTouchRef = useRef(false);
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

  const handleAirReticleMove = useCallback((normX: number, normY: number) => {
    setTouchVisual({
      active: true,
      xPct: Math.round(50 + normX * 38),
      yPct: Math.round(50 + normY * 34),
      mode: 'air',
    });
  }, []);

  const performStabilizedClick = (button: 'left' | 'right') => {
    // Freeze gyro cursor for 150ms so thumb click pressure never nudges cursor off target
    clickFreezeUntilRef.current = performance.now() + 150;
    soundEngine.playClick();
    deck.sendEvent({ type: 'trackpad:click', payload: { button } });
  };

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

  // --- Wireless Pro Glass Trackpad + Air Mouse + Presentation Remote ---
  if (subTab === 'remote') {
    return (
      <div className="screen-grid layout-trackpad" data-expanded={padExpanded ? 'true' : 'false'}>
        {/* Left / Full: Precision Multi-Touch Glass Trackpad & Air Mouse */}
        <div className="tile flex min-h-0 flex-col gap-2 p-3">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#88f1d1]" />

          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-2">
              <MousePointer2 className="h-4 w-4 text-[#88f1d1]" />
              <span className="disp text-[20px]">Pro Trackpad</span>
              {airMouseActive && (
                <span className="font-mono-tech rounded-full bg-[#88f1d1]/18 px-2 py-0.5 text-[8px] font-extrabold text-[#88f1d1]">
                  GYRO 60HZ
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <div className="flex rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-0.5">
                {(
                  [
                    ['smooth', 'Precision'],
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
                    className="rounded-lg px-2 py-0.5 text-console-micro font-extrabold uppercase transition-colors"
                    style={{
                      background: padPreset === id ? '#153137' : 'transparent',
                      color: padPreset === id ? '#88f1d1' : '#9cb4bb',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-label={padExpanded ? 'Show Controller & Slides' : 'Expand Trackpad full screen'}
                aria-pressed={padExpanded}
                onClick={() => {
                  soundEngine.playClick();
                  setPadExpanded((v) => !v);
                }}
                className="grid h-7 w-7 place-items-center rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[#effaf7]"
              >
                {padExpanded ? (
                  <Minimize2 aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
                ) : (
                  <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                type="button"
                aria-label="Toggle live screen peek"
                title="Live Screen Peek"
                onClick={() => {
                  soundEngine.playClick();
                  setScreenPeekOn((v) => !v);
                }}
                className="flex h-7 items-center gap-1 rounded-xl border px-2 text-[9.5px] font-extrabold uppercase"
                style={{
                  borderColor: screenPeekOn ? '#88f1d1' : 'rgba(179,229,223,0.22)',
                  background: screenPeekOn ? 'rgba(136,241,209,0.2)' : 'rgba(188,255,242,0.05)',
                  color: screenPeekOn ? '#88f1d1' : '#effaf7',
                }}
              >
                <Monitor aria-hidden="true" className="h-3 w-3" />
                Peek
              </button>

              <button
                type="button"
                aria-label="Toggle remote keyboard"
                title="Remote Keyboard & Shortcuts"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteKbdOpen((v) => !v);
                }}
                className="flex h-7 items-center gap-1 rounded-xl border px-2 text-[9.5px] font-extrabold uppercase"
                style={{
                  borderColor: remoteKbdOpen ? '#7dd3fc' : 'rgba(179,229,223,0.22)',
                  background: remoteKbdOpen ? 'rgba(125,211,252,0.2)' : 'rgba(188,255,242,0.05)',
                  color: remoteKbdOpen ? '#7dd3fc' : '#effaf7',
                }}
              >
                <Keyboard aria-hidden="true" className="h-3 w-3" />
                Keys
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setSubTab('controls');
                }}
                className="flex h-7 items-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 text-console-caption font-bold text-[#effaf7]"
              >
                <Sliders className="h-3 w-3 text-[#88f1d1]" />
                Tools
              </button>
            </div>
          </div>

          {/* Pop-Up Remote Keyboard + Emoji / Shortcut Bar */}
          {remoteKbdOpen && (
            <div
              data-no-swipe="true"
              className="space-y-1.5 rounded-xl border border-[#7dd3fc]/35 bg-[#08151d] p-2"
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!kbdInput) return;
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'hardware:type',
                    payload: { requestId: makeRequestId(), text: kbdInput, enter: true },
                  });
                  setKbdInput('');
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={kbdInput}
                  onChange={(e) => setKbdInput(e.target.value)}
                  placeholder="Type text or emoji to send to Mac/PC…"
                  className="font-mono-tech h-7 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/75 px-2.5 text-[11px] text-white outline-none focus:border-[#7dd3fc]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!kbdInput) return;
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'hardware:type',
                      payload: { requestId: makeRequestId(), text: kbdInput, enter: false },
                    });
                    setKbdInput('');
                  }}
                  className="h-7 rounded-lg bg-white/[0.1] px-2 text-[9.5px] font-extrabold text-white"
                >
                  TYPE
                </button>
                <button
                  type="submit"
                  className="h-7 rounded-lg bg-[#7dd3fc] px-2.5 text-[9.5px] font-extrabold text-[#04141c]"
                >
                  SEND ↵
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
                    ['selectAll', 'ALL'],
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
                    className="font-mono-tech rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[9px] font-extrabold text-[#effaf7] active:bg-[#7dd3fc]/25"
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}

          <TrackpadAccessories
            deck={deck}
            airActive={airMouseActive}
            onAirActiveChange={(on) => {
              setAirMouseActive(on);
              if (!on) setTouchVisual((v) => ({ ...v, active: false }));
            }}
            onAirReticleMove={handleAirReticleMove}
            clickFreezeUntilRef={clickFreezeUntilRef}
            airPausedRef={airPausedByTouchRef}
          />

          {/* Tactile Glass Surface + Dedicated Right-Edge 1-Finger Scroll Strip */}
          <div
            data-no-swipe="true"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              e.currentTarget.setPointerCapture(e.pointerId);
              pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              airPausedByTouchRef.current = true;

              const count = pointersRef.current.size;
              maxFingersRef.current = Math.max(maxFingersRef.current, count);
              const relX = e.clientX - rect.left;
              const relY = e.clientY - rect.top;
              const inRightScrollStrip = count === 1 && !dragLock && relX >= rect.width - 30;

              const fingers = Array.from(pointersRef.current.values());
              if (count === 1) {
                primaryTouch.current=e.pointerId;
                maxFingersRef.current = 1;
                if (padRafRef.current !== null) cancelAnimationFrame(padRafRef.current);
                padRafRef.current = null;
                padMovedDistRef.current = 0;
                padFilterX.current.reset();
                padFilterY.current.reset();
                padSubpixelRef.current = { rx: 0, ry: 0 };
                padEmaVelRef.current = { vx: 0, vy: 0 };
                padPendingRef.current = { dx: 0, dy: 0, sx: 0, sy: 0 };
                padLastTsRef.current = performance.now();

                // Check double-tap-and-hold drag (tap then press within 260ms)
                const now = performance.now();
                if (!inRightScrollStrip && now - lastSingleTapTsRef.current < 260) {
                  tempTapDragRef.current = true;
                  deck.sendEvent({ type: 'trackpad:drag', payload: { down: true } });
                }

                gesture.current = {
                  mode: inRightScrollStrip ? 'edge-scroll' : 'pending',
                  span: 0,
                  x: e.clientX,
                  y: e.clientY,
                };
              } else if (count === 2) {
                if (tempTapDragRef.current) {
                  tempTapDragRef.current = false;
                  deck.sendEvent({ type: 'trackpad:drag', payload: { down: false } });
                }
                const [a, b] = fingers;
                gesture.current = {
                  mode: 'pending',
                  span: Math.hypot(a.x - b.x, a.y - b.y),
                  x: (a.x + b.x) / 2,
                  y: (a.y + b.y) / 2,
                };
                clearTimeout(precisionTimer.current);
                precisionTimer.current=setTimeout(()=>{if(pointersRef.current.size===2&&gesture.current.mode==='pending'){precisionOn.current=true;setPrecision(true);}},320);
              } else if (count >= 3) {
                releasePrecision();
                gesture.current = {
                  mode: 'spaces',
                  span: 0,
                  x: fingers.reduce((sum, p) => sum + p.x, 0) / fingers.length,
                  y: fingers.reduce((sum, p) => sum + p.y, 0) / fingers.length,
                };
                padPendingRef.current = { dx: 0, dy: 0, sx: 0, sy: 0 };
              }

              setTouchVisual({
                active: true,
                xPct: Math.max(4, Math.min(96, Math.round((relX / Math.max(1, rect.width)) * 100))),
                yPct: Math.max(6, Math.min(94, Math.round((relY / Math.max(1, rect.height)) * 100))),
                mode:
                  inRightScrollStrip || count >= 2
                    ? 'scroll'
                    : dragLock || tempTapDragRef.current
                      ? 'drag'
                      : 'move',
              });

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
                      payload: {
                        dx: outX,
                        dy: outY,
                        drag: dragLock || tempTapDragRef.current,
                      },
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

              const rect = e.currentTarget.getBoundingClientRect();
              const rawDx = e.clientX - prev.x;
              const rawDy = e.clientY - prev.y;
              pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              const dist = Math.hypot(rawDx, rawDy);
              padMovedDistRef.current += dist;

              setTouchVisual((v) => ({
                ...v,
                active: true,
                xPct: Math.max(4, Math.min(96, Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100))),
                yPct: Math.max(6, Math.min(94, Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100))),
              }));

              const fingers = Array.from(pointersRef.current.values());
              const g = gesture.current;

              if(precisionOn.current){
                if(primaryTouch.current===e.pointerId){padPendingRef.current.dx+=rawDx*.24;padPendingRef.current.dy+=rawDy*.24;}
                return;
              }
              // 3-Finger Desktop Switch (Left/Right) & Mission Control / Task View (Up)
              if (g.mode === 'spaces' || g.mode === 'done') {
                if (fingers.length >= 3 && g.mode === 'spaces') {
                  const avgX = fingers.reduce((sum, p) => sum + p.x, 0) / fingers.length;
                  const avgY = fingers.reduce((sum, p) => sum + p.y, 0) / fingers.length;
                  const dx3 = avgX - g.x;
                  const dy3 = avgY - g.y;
                  if (dy3 < -52 && Math.abs(dy3) > Math.abs(dx3)) {
                    soundEngine.playDetent();
                    deck.sendEvent({
                      type: 'shortcut:trigger',
                      payload: { shortcutId: 'nav.missionControl' },
                    });
                    g.mode = 'done';
                  } else if (Math.abs(dx3) > 52) {
                    soundEngine.playDetent();
                    deck.sendEvent({
                      type: 'shortcut:trigger',
                      payload: { shortcutId: dx3 < 0 ? 'space.next' : 'space.prev' },
                    });
                    g.mode = 'done';
                  }
                }
                return;
              }

              // Right-edge 1-finger precision scroll strip
              if (g.mode === 'edge-scroll') {
                const sdy = -rawDy * 2.1;
                padPendingRef.current.sy += sdy;
                padScrollVelRef.current = {
                  vx: 0,
                  vy: padScrollVelRef.current.vy * 0.45 + sdy * 0.55,
                };
                return;
              }

              // 2-Finger Scroll & Pinch Zoom
              if (fingers.length === 2) {
                const [a, b] = fingers;
                const span = Math.hypot(a.x - b.x, a.y - b.y);
                const delta = span - g.span;
                if (g.mode === 'pending') {
                  if (Math.abs(delta) > 16) g.mode = 'zoom';
                  else if (Math.hypot((a.x + b.x) / 2 - g.x, (a.y + b.y) / 2 - g.y) > 8) {
                    g.mode = 'scroll';
                    setTouchVisual((v) => ({ ...v, mode: 'scroll' }));
                  } else return;
                }
                if (g.mode === 'zoom') {
                  if (Math.abs(delta) > 22) {
                    deck.sendEvent({
                      type: 'shortcut:trigger',
                      payload: { shortcutId: delta > 0 ? 'zoom.in' : 'zoom.out' },
                    });
                    g.span = span;
                  }
                  return;
                }
              } else if (maxFingersRef.current >= 2) {
                return;
              }

              if (pointersRef.current.size >= 2) {
                const sdx = rawDx * 1.45;
                const sdy = rawDy * 1.75;
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

              const maxJump = 72;
              const clampedDx = Math.max(-maxJump, Math.min(maxJump, rawDx));
              const clampedDy = Math.max(-maxJump, Math.min(maxJump, rawDy));

              const cfg =
                padPreset === 'smooth'
                  ? { minCutoff: 1.5, beta: 0.065, baseGain: 1.45, accel: 0.58, maxGain: 5.2, ema: 0.58 }
                  : padPreset === 'turbo'
                    ? { minCutoff: 4.2, beta: 0.22, baseGain: 2.4, accel: 0.96, maxGain: 9.8, ema: 0.84 }
                    : { minCutoff: 2.8, beta: 0.14, baseGain: 1.9, accel: 0.8, maxGain: 7.6, ema: 0.74 };

              const fx = padFilterX.current.filter(clampedDx, dt, cfg.minCutoff, cfg.beta);
              const fy = padFilterY.current.filter(clampedDy, dt, cfg.minCutoff, cfg.beta);

              const px = cfg.ema * fx + (1 - cfg.ema) * padEmaVelRef.current.vx;
              const py = cfg.ema * fy + (1 - cfg.ema) * padEmaVelRef.current.vy;
              padEmaVelRef.current = { vx: px, vy: py };

              const velocityPxPerSec = Math.hypot(px, py) / dt;
              const speedNorm = Math.min(30, velocityPxPerSec / 90);
              const gain = Math.min(cfg.maxGain, cfg.baseGain + Math.pow(speedNorm, 1.2) * cfg.accel);

              padPendingRef.current.dx += px * gain;
              padPendingRef.current.dy += py * gain;
            }}
            onPointerUp={(e) => {
              if(releasePrecision()){maxFingersRef.current=1;gesture.current.mode='pending';padMovedDistRef.current=100;}
              pointersRef.current.delete(e.pointerId);
              if (pointersRef.current.size === 0) {
                padActiveRef.current = false;
                airPausedByTouchRef.current = false;
                if (padRafRef.current) {
                  cancelAnimationFrame(padRafRef.current);
                  padRafRef.current = null;
                }

                if (tempTapDragRef.current) {
                  tempTapDragRef.current = false;
                  deck.sendEvent({ type: 'trackpad:drag', payload: { down: false } });
                } else {
                  const wasTwoFinger = maxFingersRef.current === 2;
                  const tapThreshold = wasTwoFinger ? 18 : 9;
                  if (
                    maxFingersRef.current <= 2 &&
                    padMovedDistRef.current < tapThreshold &&
                    gesture.current.mode === 'pending'
                  ) {
                    if (!wasTwoFinger) {
                      lastSingleTapTsRef.current = performance.now();
                    }
                    performStabilizedClick(wasTwoFinger ? 'right' : 'left');
                  } else if (
                    gesture.current.mode === 'scroll' ||
                    gesture.current.mode === 'edge-scroll'
                  ) {
                    let { vx, vy } = padScrollVelRef.current;
                    const glide = () => {
                      if (padActiveRef.current || (Math.abs(vx) < 0.7 && Math.abs(vy) < 0.7)) {
                        padRafRef.current = null;
                        return;
                      }
                      deck.sendEvent({
                        type: 'trackpad:scroll',
                        payload: { dx: Math.round(vx), dy: Math.round(vy) },
                      });
                      vx *= 0.85;
                      vy *= 0.85;
                      padRafRef.current = requestAnimationFrame(glide);
                    };
                    if (Math.abs(vx) >= 1.5 || Math.abs(vy) >= 1.5) {
                      padRafRef.current = requestAnimationFrame(glide);
                    }
                  }
                }

                if (!airMouseActive) {
                  setTouchVisual((v) => ({ ...v, active: false }));
                }
                padScrollVelRef.current = { vx: 0, vy: 0 };
                maxFingersRef.current = 1;
              }
            }}
            onPointerCancel={(e) => {
              releasePrecision();
              gesture.current.mode = 'done';
              pointersRef.current.delete(e.pointerId);
              if (pointersRef.current.size === 0) {
                padActiveRef.current = false;
                airPausedByTouchRef.current = false;
                if (tempTapDragRef.current) {
                  tempTapDragRef.current = false;
                  deck.sendEvent({ type: 'trackpad:drag', payload: { down: false } });
                }
                if (!airMouseActive) setTouchVisual((v) => ({ ...v, active: false }));
                maxFingersRef.current = 1;
              }
            }}
            className="relative grid min-h-[120px] flex-1 touch-none select-none place-items-center overflow-hidden rounded-2xl border transition-colors"
            style={{
              borderColor: airMouseActive
                ? '#88f1d188'
                : dragLock
                  ? '#fbbf2488'
                  : '#98c8ce2e',
              background:
                'radial-gradient(ellipse at 50% 35%, rgba(35,85,85,0.34), rgba(9,19,25,0.96) 72%)',
            }}
          >
            <small className="precision-hint">Hold a second finger for precision</small>
            {/* Live Mini Screen Peek Overlay inside Trackpad Glass (Hardware MJPEG Stream) */}
            {screenPeekOn && deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`${deck.bridgeBaseUrl}/api/screen/stream?q=turbo&token=${encodeURIComponent(deck.pairing.token)}&s=${screenPeekTick}`}
                alt="Live desktop screen peek"
                className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-65"
              />
            )}

            {precision&&<div className="cursor-lens" style={{left:Math.min(82,Math.max(18,touchVisual.xPct))+'%',top:Math.min(78,Math.max(22,touchVisual.yPct-17))+'%'}}>{lens&&lens!=='unavailable'?<img alt="Magnified desktop cursor region" src={lens}/>:<small>{lens==='unavailable'?'Precision · screen unavailable':'Precision'}</small>}</div>}
            {/* Subtle Precision Corner Reticle Marks */}
            <span className="pointer-events-none absolute top-2.5 left-2.5 h-3 w-3 border-t border-l border-[#88f1d1]/30" />
            <span className="pointer-events-none absolute top-2.5 right-9 h-3 w-3 border-t border-r border-[#88f1d1]/30" />
            <span className="pointer-events-none absolute bottom-2.5 left-2.5 h-3 w-3 border-b border-l border-[#88f1d1]/30" />
            <span className="pointer-events-none absolute right-9 bottom-2.5 h-3 w-3 border-r border-b border-[#88f1d1]/30" />

            {/* Live Touch / Air-Gyro Halo Reticle */}
            {touchVisual.active && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150"
                style={{
                  left: `${touchVisual.xPct}%`,
                  top: `${touchVisual.yPct}%`,
                  width: touchVisual.mode === 'scroll' ? 38 : 30,
                  height: touchVisual.mode === 'scroll' ? 38 : 30,
                  border: `1.5px solid ${
                    touchVisual.mode === 'drag'
                      ? '#fbbf24'
                      : touchVisual.mode === 'scroll'
                        ? '#7dd3fc'
                        : '#88f1d1'
                  }`,
                  background:
                    touchVisual.mode === 'drag'
                      ? 'rgba(251,191,36,0.14)'
                      : 'rgba(136,241,209,0.12)',
                  boxShadow: `0 0 18px ${
                    touchVisual.mode === 'drag' ? 'rgba(251,191,36,0.35)' : 'rgba(136,241,209,0.35)'
                  }`,
                }}
              />
            )}

            {/* Center Watermark Guidance */}
            <div className="pointer-events-none px-8 text-center">
              <div className="text-[10.5px] font-bold tracking-wide text-[#effaf7]/75 uppercase">
                {airMouseActive
                  ? 'Air Mouse Live · Wave iPhone to move · Tap pad to click'
                  : dragLock
                    ? 'Drag Lock Active · Slide to move window or select text'
                    : '1-Finger Move & Tap · Double-Tap Hold to Drag · 2-Finger Scroll / Right-Click'}
              </div>
              <div className="mt-0.5 font-mono-tech text-[9px] text-[#9cb4bb]/80">
                3-Finger Swipe: Spaces &amp; Mission Control · Right Edge: 1-Thumb Scroll
              </div>
            </div>

            {/* Dedicated Right-Edge 1-Finger Scroll Strip */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-2 right-1.5 bottom-2 flex w-5 flex-col items-center justify-between rounded-full border border-[#98c8ce24] bg-[#0d1d25]/80 py-2"
            >
              <span className="text-[7px] font-bold text-[#88f1d1]/70">▲</span>
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="h-[1px] w-2 bg-[#9cb4bb]/40" />
                ))}
              </div>
              <span className="text-[7px] font-bold text-[#88f1d1]/70">▼</span>
            </div>
          </div>

          {/* Ergonomic Tactile Mouse Buttons (Stabilized for Air Mouse!) */}
          <div className="grid grid-cols-3 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => performStabilizedClick('left')}
              className="min-h-[38px] rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] py-2 text-console-caption font-extrabold text-[#effaf7]"
            >
              LEFT CLICK
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              aria-pressed={dragLock}
              onClick={() => {
                soundEngine.playClick();
                const next = !dragLock;
                setDragLock(next);
                deck.sendEvent({ type: 'trackpad:drag', payload: { down: next } });
              }}
              className="min-h-[38px] rounded-xl border py-2 text-console-caption font-extrabold"
              style={{
                background: dragLock ? 'rgba(251,191,36,0.2)' : '#bcfff20d',
                borderColor: dragLock ? '#fbbf24' : '#b3e5df36',
                color: dragLock ? '#fbbf24' : '#9cb4bb',
              }}
            >
              {dragLock ? 'DRAGGING…' : 'DRAG LOCK'}
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => performStabilizedClick('right')}
              className="min-h-[38px] rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] py-2 text-console-caption font-extrabold text-[#88f1d1]"
            >
              RIGHT CLICK
            </motion.button>
          </div>
        </div>

        {/* Right: Game-Controller Action Pad & Slide Clicker (Hidden when Full-Pad Expanded) */}
        {!padExpanded && (
        <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#88f1d1]" />

          {/* Header Switcher: Controller vs Slides vs Live Screen Preview */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-0.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteRightTab('controller');
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: remoteRightTab === 'controller' ? '#153137' : 'transparent',
                  color: remoteRightTab === 'controller' ? '#88f1d1' : '#9cb4bb',
                }}
              >
                <Gamepad2 aria-hidden="true" className="h-3 w-3" />
                Controller
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteRightTab('slides');
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: remoteRightTab === 'slides' ? '#153137' : 'transparent',
                  color: remoteRightTab === 'slides' ? '#88f1d1' : '#9cb4bb',
                }}
              >
                <Presentation aria-hidden="true" className="h-3 w-3" />
                Slides
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRemoteRightTab('preview');
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-console-micro font-extrabold uppercase"
                style={{
                  background: remoteRightTab === 'preview' ? '#153137' : 'transparent',
                  color: remoteRightTab === 'preview' ? '#88f1d1' : '#9cb4bb',
                }}
              >
                <Monitor aria-hidden="true" className="h-3 w-3" />
                Preview
              </button>
            </div>
            <span className="font-mono-tech text-console-micro text-[#9cb4bb] uppercase">
              {remoteRightTab === 'preview' ? 'LIVE HD' : remoteRightTab === 'slides' ? 'DECK' : 'L1 / D-PAD'}
            </span>
          </div>

          {remoteRightTab === 'preview' ? (
            <LiveScreenPreview deck={deck} onShortcut={fireShortcut} />
          ) : remoteRightTab === 'controller' ? (
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
        )}
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
