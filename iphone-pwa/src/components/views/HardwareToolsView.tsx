'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Flame,
  LayoutGrid,
  Loader2,
  Lock,
  MousePointer2,
  Play,
  Presentation,
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
  const [subTab, setSubTab] = useState<HardwareTab>('controls');
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

  // Trackpad pointer tracking
  const padLastRef = useRef<{ x: number; y: number } | null>(null);
  const padMovedRef = useRef(false);
  const padAccumRef = useRef({ dx: 0, dy: 0 });
  const padLastEmitRef = useRef(0);

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
      <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        {/* Left: Smooth Multi-Touch Wireless Trackpad */}
        <div className="tile flex flex-col gap-2 p-3">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#22d3ee]" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <MousePointer2 className="h-4 w-4 text-[#22d3ee]" />
              <span className="disp text-[22px]">Trackpad</span>
            </div>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setSubTab('controls');
              }}
              className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-[9.5px] font-bold text-zinc-200"
            >
              <Sliders className="h-3 w-3 text-[#fbbf24]" />
              Dial &amp; Snap
            </button>
          </div>

          <div
            data-no-swipe="true"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              padLastRef.current = { x: e.clientX, y: e.clientY };
              padMovedRef.current = false;
              padAccumRef.current = { dx: 0, dy: 0 };
            }}
            onPointerMove={(e) => {
              if (!padLastRef.current) return;
              const dx = (e.clientX - padLastRef.current.x) * 2.1;
              const dy = (e.clientY - padLastRef.current.y) * 2.1;
              padLastRef.current = { x: e.clientX, y: e.clientY };
              if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) padMovedRef.current = true;
              padAccumRef.current.dx += dx;
              padAccumRef.current.dy += dy;

              if (Date.now() - padLastEmitRef.current > 40) {
                padLastEmitRef.current = Date.now();
                const sendX = Math.round(padAccumRef.current.dx);
                const sendY = Math.round(padAccumRef.current.dy);
                padAccumRef.current = { dx: 0, dy: 0 };
                if (sendX !== 0 || sendY !== 0) {
                  deck.sendEvent({ type: 'trackpad:move', payload: { dx: sendX, dy: sendY } });
                }
              }
            }}
            onPointerUp={() => {
              if (!padMovedRef.current) {
                soundEngine.playClick();
                deck.sendEvent({ type: 'trackpad:click', payload: { button: 'left' } });
              }
              padLastRef.current = null;
            }}
            className="grid flex-1 touch-none place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.08),rgba(0,0,0,0.85))]"
          >
            <span className="sub pointer-events-none">Drag to move cursor · tap to click</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'trackpad:click', payload: { button: 'left' } });
              }}
              className="rounded-xl border border-white/10 bg-white/[0.06] py-2 text-[10.5px] font-extrabold text-white"
            >
              LEFT CLICK
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({ type: 'trackpad:click', payload: { button: 'right' } });
              }}
              className="rounded-xl border border-white/10 bg-white/[0.06] py-2 text-[10.5px] font-extrabold text-[#22d3ee]"
            >
              RIGHT CLICK
            </motion.button>
          </div>
        </div>

        {/* Right: Presentation Slide Remote (Keynote / PowerPoint / Google Slides) */}
        <div className="tile flex flex-col justify-between gap-2 p-3.5">
          <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />
          <div className="flex items-center justify-between">
            <span className="disp text-[22px]">Slide Clicker</span>
            <Presentation className="h-4 w-4 text-[#34d399]" />
          </div>

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
              <span className="mt-1 text-[10px] font-extrabold uppercase tracking-wider">
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
              className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 text-[10px] font-bold text-[#34d399]"
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
              className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 text-[10px] font-bold text-[#ff5d6c]"
            >
              <X className="h-3 w-3" />
              Exit (Esc)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid h-full gap-2"
      style={{ gridTemplateColumns: '195px 1fr 1fr', gridTemplateRows: '1fr 1fr' }}
    >
      {/* Left Spanning Rotary Smart Dial + Remote Switch */}
      <div
        className="tile flex flex-col items-center justify-between p-3"
        style={{ gridRow: '1 / span 2', gridColumn: 1 }}
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
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#22d3ee]/35 bg-[#22d3ee]/10 py-1.5 text-[9.5px] font-extrabold text-[#22d3ee]"
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
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] py-1.5 text-[10px] font-extrabold text-zinc-200 hover:border-[#22d3ee]/50 hover:text-[#22d3ee]"
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
                className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase"
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
