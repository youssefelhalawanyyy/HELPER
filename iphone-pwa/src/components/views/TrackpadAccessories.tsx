'use client';
import { useEffect, useRef, useState } from 'react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { bridgeRequest } from '@/lib/bridgeRequest';

export function TrackpadAccessories({ deck }: { deck: DevDeckState }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(false);
  const session = useRef(0);
  const stop = useRef(() => {});
  const connected = deck.status === 'connected';
  useEffect(() => {
    const release = () => stop.current();
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('blur', release);
    };
  }, [connected]);
  const start = async () => {
    const api = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined;
    if (!api) {
      deck.showToast(false, 'Motion input requires a supported phone and secure connection');
      return;
    }
    let last: { x: number; y: number } | null = null;
    let lastTime = 0;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null || e.timeStamp - lastTime < 16) return;
      const x = e.gamma,
        y = e.beta;
      if (last) {
        const dx = x - last.x,
          dy = y - last.y;
        if (Math.abs(dx) < 30 && Math.abs(dy) < 30)
          deck.sendEvent({ type: 'trackpad:move', payload: { dx: dx * 8, dy: dy * 8 } });
      }
      last = { x, y };
      lastTime = e.timeStamp;
    };
    stop.current();
    const id = ++session.current;
    stop.current = () => {
      session.current++;
      setActive(false);
      window.removeEventListener('deviceorientation', onTilt);
    };
    try {
      if (api.requestPermission && (await api.requestPermission()) !== 'granted')
        throw Error('Motion access was declined');
      if (id === session.current) {
        setActive(true);
        window.addEventListener('deviceorientation', onTilt);
      }
    } catch (e) {
      if (id !== session.current) return;
      stop.current();
      deck.showToast(false, (e as Error).message);
    }
  };
  return (
    <div data-no-swipe="true" className="space-y-1 text-xs">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!connected}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setText('');
          }}
          className="rounded-lg border border-white/20 px-3 py-2"
        >
          Keyboard
        </button>
        <button
          disabled={!connected}
          onPointerDown={(e) => {
            if (!e.isPrimary) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            void start();
          }}
          onLostPointerCapture={() => stop.current()}
          onPointerUp={() => stop.current()}
          onPointerCancel={() => stop.current()}
          className="touch-none select-none rounded-lg border border-white/20 px-3 py-2"
        >
          {active ? 'Air mouse active' : 'Hold for air mouse'}
        </button>
      </div>
      {open && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text || sending) return;
            setSending(true);
            try {
              await bridgeRequest(deck, 'type', { text });
              setText('');
            } catch (err) {
              deck.showToast(false, (err as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          <input
            autoFocus
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Text for desktop"
            placeholder="Type into the active desktop field"
            maxLength={2048}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 rounded-lg bg-black p-2"
          />
          <button disabled={!connected || sending || !text}>Type</button>
        </form>
      )}
    </div>
  );
}
