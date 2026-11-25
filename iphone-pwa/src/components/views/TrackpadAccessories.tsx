'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  CornerDownLeft,
  Delete,
  Eye,
  EyeOff,
  Keyboard,
  Pause,
  Play,
  Send,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { bridgeRequest } from '@/lib/bridgeRequest';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export type GyroSensitivity = 'low' | 'med' | 'high';

interface TrackpadAccessoriesProps {
  deck: DevDeckState;
  airActive: boolean;
  onAirActiveChange: (active: boolean) => void;
  onAirReticleMove?: (normX: number, normY: number) => void;
  clickFreezeUntilRef: React.RefObject<number>;
  airPausedRef: React.RefObject<boolean>;
}

function getScreenAngleDeg(): number {
  if (typeof window === 'undefined') return 0;
  const scr = window.screen?.orientation?.angle;
  if (typeof scr === 'number') return ((scr % 360) + 360) % 360;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  if (typeof legacy === 'number') return ((legacy % 360) + 360) % 360;
  return window.innerWidth > window.innerHeight ? 90 : 0;
}

function wrapDeltaDeg(curr: number, prev: number): number {
  let d = curr - prev;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function TrackpadAccessories({
  deck,
  airActive,
  onAirActiveChange,
  onAirReticleMove,
  clickFreezeUntilRef,
  airPausedRef,
}: TrackpadAccessoriesProps) {
  const [kbdOpen, setKbdOpen] = useState(false);
  const [masked, setMasked] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [gyroSens, setGyroSens] = useState<GyroSensitivity>('med');
  const [clutchHeld, setClutchHeld] = useState(false);
  const [clutchMode, setClutchMode] = useState(false);

  const sensRef = useRef<GyroSensitivity>('med');
  sensRef.current = gyroSens;
  const clutchModeRef = useRef(false);
  clutchModeRef.current = clutchMode;
  const clutchHeldRef = useRef(false);
  clutchHeldRef.current = clutchHeld;

  const cleanupRef = useRef<(() => void) | null>(null);
  const reticleRef = useRef({ x: 0, y: 0 });
  const connected = deck.status === 'connected';

  const stopAirMouse = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    onAirActiveChange(false);
    reticleRef.current = { x: 0, y: 0 };
    onAirReticleMove?.(0, 0);
  }, [onAirActiveChange, onAirReticleMove]);

  useEffect(() => {
    if (!connected && airActive) {
      stopAirMouse();
    }
  }, [connected, airActive, stopAirMouse]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const toggleAirMouse = () => {
    soundEngine.playClick();
    if (airActive) {
      stopAirMouse();
      return;
    }

    if (typeof window === 'undefined') return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      deck.showToast(false, 'Air Mouse requires HTTPS (open the Vercel link or tunnel)');
      return;
    }

    // CRITICAL FOR iOS SAFARI: Invoke requestPermission() synchronously inside the click gesture BEFORE any await!
    const DevMotion = window.DeviceMotionEvent as unknown as
      | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> })
      | undefined;
    const DevOrient = window.DeviceOrientationEvent as unknown as
      | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> })
      | undefined;

    if (!DevMotion && !DevOrient) {
      deck.showToast(false, 'Motion & Gyroscope sensors are not available on this device');
      return;
    }

    const permPromise: Promise<'granted' | 'denied'> =
      typeof DevMotion?.requestPermission === 'function'
        ? DevMotion.requestPermission()
        : typeof DevOrient?.requestPermission === 'function'
          ? DevOrient.requestPermission()
          : Promise.resolve('granted');

    void permPromise
      .then((state) => {
        if (state !== 'granted') {
          deck.showToast(false, 'Motion access denied — allow Motion & Orientation in Safari Settings');
          return;
        }

        cleanupRef.current?.();

        let hasGyroSample = false;
        let lastMotionTs = 0;
        let smoothVx = 0;
        let smoothVy = 0;
        let subRx = 0;
        let subRy = 0;
        let prevOrient: { alpha: number; beta: number; gamma: number; ts: number } | null = null;

        const emitDelta = (rawDx: number, rawDy: number) => {
          if (performance.now() < (clickFreezeUntilRef.current ?? 0)) return;
          if (airPausedRef.current) return;
          if (clutchModeRef.current && !clutchHeldRef.current) return;

          const totalX = rawDx + subRx;
          const totalY = rawDy + subRy;
          const sendX = Math.trunc(totalX * 10) / 10;
          const sendY = Math.trunc(totalY * 10) / 10;
          subRx = totalX - sendX;
          subRy = totalY - sendY;

          if (Math.abs(sendX) >= 0.15 || Math.abs(sendY) >= 0.15) {
            deck.sendEvent({
              type: 'trackpad:move',
              payload: { dx: sendX, dy: sendY, drag: false },
            });
            reticleRef.current = {
              x: Math.max(-1, Math.min(1, reticleRef.current.x * 0.92 + sendX * 0.018)),
              y: Math.max(-1, Math.min(1, reticleRef.current.y * 0.92 + sendY * 0.018)),
            };
            onAirReticleMove?.(reticleRef.current.x, reticleRef.current.y);
          }
        };

        // Primary 60Hz 3-Axis MEMS Gyroscope handler (gimbal-lock-free in Portrait & Landscape!)
        const onMotion = (e: DeviceMotionEvent) => {
          const rr = e.rotationRate;
          if (!rr || (rr.alpha === null && rr.beta === null && rr.gamma === null)) return;
          hasGyroSample = true;

          const now = performance.now();
          const dt =
            lastMotionTs > 0
              ? Math.max(0.004, Math.min(0.05, (now - lastMotionTs) / 1000))
              : typeof e.interval === 'number' && e.interval > 1
                ? e.interval / 1000
                : 0.016;
          lastMotionTs = now;

          const alpha = rr.alpha ?? 0; // Z-axis (out of screen) deg/s
          const beta = rr.beta ?? 0; // X-axis (short screen axis) deg/s
          const gamma = rr.gamma ?? 0; // Y-axis (long screen axis) deg/s

          // Orientation-compensated laser-pointer projection (0°, 90°, 180°, 270°)
          const angle = getScreenAngleDeg();
          let yawDegPerSec = 0;
          let pitchDegPerSec = 0;

          if (angle >= 45 && angle < 135) {
            // Landscape-Left (90°, top of phone on left)
            yawDegPerSec = -(alpha * 0.72 + beta * 0.72);
            pitchDegPerSec = gamma;
          } else if (angle >= 225 && angle < 315) {
            // Landscape-Right (270° / -90°, top of phone on right)
            yawDegPerSec = -(alpha * 0.72 - beta * 0.72);
            pitchDegPerSec = -gamma;
          } else if (angle >= 135 && angle < 225) {
            // Upside-down portrait (180°)
            yawDegPerSec = -(alpha * 0.72 - gamma * 0.72);
            pitchDegPerSec = beta;
          } else {
            // Portrait (0°)
            yawDegPerSec = -(alpha * 0.72 + gamma * 0.72);
            pitchDegPerSec = -beta;
          }

          // Micro-tremor deadzone so holding phone steady keeps cursor 100% still
          const mag = Math.hypot(yawDegPerSec, pitchDegPerSec);
          if (mag < 0.85) {
            smoothVx *= 0.5;
            smoothVy *= 0.5;
            return;
          }

          // Smooth low-latency EMA + ballistic pointer acceleration
          smoothVx = smoothVx * 0.32 + yawDegPerSec * 0.68;
          smoothVy = smoothVy * 0.32 + pitchDegPerSec * 0.68;

          const basePxPerDeg =
            sensRef.current === 'low' ? 14 : sensRef.current === 'high' ? 31 : 22;
          const speedBoost = 1 + Math.min(1.6, Math.hypot(smoothVx, smoothVy) / 110);
          const gain = basePxPerDeg * speedBoost;

          emitDelta(smoothVx * dt * gain, smoothVy * dt * gain);
        };

        // Fallback handler for devices without a hardware gyroscope (orientation Euler deltas)
        const onOrientFallback = (e: DeviceOrientationEvent) => {
          if (hasGyroSample) return;
          if (e.alpha === null && e.beta === null && e.gamma === null) return;
          const now = performance.now();
          const a = e.alpha ?? 0;
          const b = e.beta ?? 0;
          const g = e.gamma ?? 0;

          if (prevOrient && now - prevOrient.ts >= 12 && now - prevOrient.ts < 250) {
            const dAlpha = wrapDeltaDeg(a, prevOrient.alpha);
            const dBeta = b - prevOrient.beta;
            const dGamma = g - prevOrient.gamma;
            const angle = getScreenAngleDeg();

            let dxDeg = 0;
            let dyDeg = 0;
            if (angle >= 45 && angle < 135) {
              dxDeg = -dAlpha * 0.8 + dBeta * 0.4;
              dyDeg = dGamma;
            } else if (angle >= 225 && angle < 315) {
              dxDeg = -dAlpha * 0.8 - dBeta * 0.4;
              dyDeg = -dGamma;
            } else {
              dxDeg = -dAlpha * 0.7 + dGamma * 0.5;
              dyDeg = -dBeta;
            }

            const mult = sensRef.current === 'low' ? 11 : sensRef.current === 'high' ? 24 : 17;
            if (Math.hypot(dxDeg, dyDeg) > 0.06 && Math.hypot(dxDeg, dyDeg) < 25) {
              emitDelta(dxDeg * mult, dyDeg * mult);
            }
          }
          prevOrient = { alpha: a, beta: b, gamma: g, ts: now };
        };

        window.addEventListener('devicemotion', onMotion, { passive: true });
        window.addEventListener('deviceorientation', onOrientFallback, { passive: true });

        cleanupRef.current = () => {
          window.removeEventListener('devicemotion', onMotion);
          window.removeEventListener('deviceorientation', onOrientFallback);
        };

        onAirActiveChange(true);
        deck.showToast(true, 'Air Mouse active — point your iPhone like a laser remote!');
      })
      .catch((err) => {
        deck.showToast(
          false,
          err instanceof Error ? err.message : 'Could not access iPhone gyroscope',
        );
      });
  };

  const sendDesktopText = async (payloadText: string) => {
    if (!payloadText || sending) return;
    setSending(true);
    try {
      await bridgeRequest(deck, 'type', { text: payloadText });
      setText('');
      soundEngine.playClick();
    } catch (err) {
      deck.showToast(false, (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const fireKey = (shortcutId: string) => {
    soundEngine.playDetent();
    deck.sendEvent({ type: 'shortcut:trigger', payload: { shortcutId } });
  };

  return (
    <div data-no-swipe="true" className="space-y-1.5">
      {/* Compact Desk Clock-themed Air Mouse & Keyboard Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 1-Tap Air Mouse Toggle (explicit onClick so iOS Safari Motion Permission ALWAYS works!) */}
          <button
            type="button"
            disabled={!connected}
            aria-pressed={airActive}
            onClick={toggleAirMouse}
            className="flex min-h-[30px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[10px] font-extrabold uppercase transition-colors disabled:opacity-40"
            style={{
              background: airActive ? '#88f1d1' : '#bcfff20d',
              borderColor: airActive ? '#88f1d1' : '#b3e5df36',
              color: airActive ? '#08221c' : '#effaf7',
            }}
          >
            <Compass className={`h-3.5 w-3.5 shrink-0 ${airActive ? 'animate-spin' : 'text-[#88f1d1]'}`} style={airActive ? { animationDuration: '6s' } : undefined} />
            {airActive ? 'Air Mouse ON' : 'Air Mouse'}
          </button>

          {/* Air Mouse Sensitivity & Clutch Controls when active */}
          {airActive && (
            <>
              <div className="flex items-center rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-0.5">
                {(
                  [
                    ['low', 'Low'],
                    ['med', 'Med'],
                    ['high', 'Fast'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setGyroSens(id);
                    }}
                    className="rounded-lg px-2 py-0.5 text-[9px] font-extrabold uppercase"
                    style={{
                      background: gyroSens === id ? '#153137' : 'transparent',
                      color: gyroSens === id ? '#88f1d1' : '#9cb4bb',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-pressed={clutchMode}
                onClick={() => {
                  soundEngine.playClick();
                  setClutchMode((v) => !v);
                }}
                className="flex min-h-[28px] items-center gap-1 rounded-xl border px-2 py-0.5 text-[9px] font-bold"
                style={{
                  background: clutchMode ? 'rgba(251,191,36,0.16)' : '#bcfff20d',
                  borderColor: clutchMode ? '#fbbf24' : '#b3e5df36',
                  color: clutchMode ? '#fbbf24' : '#9cb4bb',
                }}
              >
                {clutchMode ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
                {clutchMode ? 'Trigger Mode' : 'Free Move'}
              </button>

              {clutchMode && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setClutchHeld(true);
                  }}
                  onPointerUp={() => setClutchHeld(false)}
                  onPointerCancel={() => setClutchHeld(false)}
                  onLostPointerCapture={() => setClutchHeld(false)}
                  className="touch-none select-none rounded-xl border px-2.5 py-1 text-[9.5px] font-extrabold uppercase"
                  style={{
                    background: clutchHeld ? '#88f1d1' : 'rgba(136,241,209,0.15)',
                    borderColor: '#88f1d1',
                    color: clutchHeld ? '#08221c' : '#88f1d1',
                  }}
                >
                  {clutchHeld ? 'Moving…' : 'Hold to Point'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Remote Keyboard Drawer Toggle */}
        <button
          type="button"
          disabled={!connected}
          aria-expanded={kbdOpen}
          onClick={() => {
            soundEngine.playClick();
            setKbdOpen((v) => !v);
          }}
          className="flex min-h-[30px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[10px] font-bold transition-colors disabled:opacity-40"
          style={{
            background: kbdOpen ? 'rgba(136,241,209,0.18)' : '#bcfff20d',
            borderColor: kbdOpen ? '#88f1d1' : '#b3e5df36',
            color: kbdOpen ? '#88f1d1' : '#effaf7',
          }}
        >
          <Keyboard className="h-3.5 w-3.5 text-[#88f1d1]" />
          Keyboard
        </button>
      </div>

      {/* Expandable Live Desktop Keyboard Input Bar */}
      {kbdOpen && (
        <form
          className="flex items-center gap-1.5 rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void sendDesktopText(text);
          }}
        >
          <button
            type="button"
            onClick={() => setMasked((m) => !m)}
            aria-label={masked ? 'Show typed text' : 'Mask typed text for passwords'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] text-[#9cb4bb]"
          >
            {masked ? (
              <EyeOff aria-hidden="true" className="h-3.5 w-3.5 text-[#fbbf24]" />
            ) : (
              <Eye aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
            )}
          </button>

          <input
            autoFocus
            type={masked ? 'password' : 'text'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Type into active computer window"
            placeholder={masked ? 'Password mode (hidden)…' : 'Type text to send to your computer…'}
            maxLength={2048}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-[11px] text-[#effaf7] outline-none placeholder:text-[#78959e]"
          />

          <button
            type="button"
            onClick={() => fireKey('nav.backspace')}
            aria-label="Send Backspace"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] text-[#effaf7]"
          >
            <Delete aria-hidden="true" className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (text) {
                void sendDesktopText(text).then(() => {
                  deck.sendEvent({
                    type: 'shortcut:trigger',
                    payload: { shortcutId: 'nav.enter' },
                  });
                });
              } else {
                deck.sendEvent({
                  type: 'shortcut:trigger',
                  payload: { requestId: makeRequestId(), shortcutId: 'nav.enter' } as { shortcutId: string },
                });
              }
            }}
            aria-label="Send Enter"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] text-[#88f1d1]"
          >
            <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5" />
          </button>

          <button
            type="submit"
            disabled={!connected || sending || !text}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[#88f1d1] px-2.5 text-[10px] font-extrabold text-[#08221c] disabled:opacity-35"
          >
            <Send className="h-3 w-3" />
            Send
          </button>
        </form>
      )}
    </div>
  );
}
