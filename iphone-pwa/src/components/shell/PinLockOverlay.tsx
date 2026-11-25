'use client';

import { useState } from 'react';
import { Lock, ShieldCheck, Unlock, X } from 'lucide-react';
import { soundEngine } from '@/lib/soundEngine';

export const PIN_STORAGE_KEY = 'devdeck.pinLock.v1';

export function PinLockOverlay({
  mode,
  savedPin,
  onUnlock,
  onSetPin,
  onClearPin,
  onClose,
}: {
  mode: 'unlock' | 'setup';
  savedPin: string;
  onUnlock: () => void;
  onSetPin: (pin: string) => void;
  onClearPin: () => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');

  const handleDigit = (d: string) => {
    soundEngine.playClick();
    setError('');
    const next = (digits + d).slice(0, 4);
    setDigits(next);
    if (next.length === 4) {
      if (mode === 'setup') {
        onSetPin(next);
      } else if (next === savedPin) {
        soundEngine.playSuccessChime();
        onUnlock();
      } else {
        soundEngine.playErrorThud();
        setError('Wrong 4-digit PIN');
        setTimeout(() => setDigits(''), 250);
      }
    }
  };

  return (
    <div
      data-no-swipe="true"
      className="fixed inset-0 z-[98] flex items-center justify-center bg-[#040c11]/95 p-4"
    >
      <div className="relative flex w-full max-w-[280px] flex-col items-center gap-3 rounded-2xl border border-[#88f1d1]/35 bg-[#0a1820] p-4 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close PIN dialog"
          className="absolute top-3 right-3 text-zinc-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#88f1d1]/15 text-[#88f1d1]">
          {mode === 'setup' ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </div>

        <div className="text-center">
          <div className="text-sm font-extrabold text-white">
            {mode === 'setup' ? 'Set 4-Digit DevDeck PIN' : 'Enter DevDeck PIN'}
          </div>
          <div className="text-[10px] text-[#9cb4bb]">
            {mode === 'setup'
              ? 'Protects Power Guard, Files & Drop, and SSH & VPS'
              : 'Unlock sensitive computer controls'}
          </div>
        </div>

        {/* 4 PIN Dots */}
        <div className="flex gap-2.5 py-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-3 w-3 rounded-full border transition-all"
              style={{
                borderColor: error ? '#ff5d6c' : '#88f1d1',
                background: i < digits.length ? '#88f1d1' : 'transparent',
              }}
            />
          ))}
        </div>
        {error && <div className="text-[10px] font-bold text-[#ff5d6c]">{error}</div>}

        {/* Keypad */}
        <div className="grid w-full grid-cols-3 gap-1.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleDigit(n)}
              className="font-mono-tech h-10 rounded-xl border border-white/10 bg-white/[0.06] text-sm font-extrabold text-white active:bg-[#88f1d1]/25"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDigits('')}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.04] text-[10px] font-bold text-zinc-400"
          >
            CLR
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="font-mono-tech h-10 rounded-xl border border-white/10 bg-white/[0.06] text-sm font-extrabold text-white active:bg-[#88f1d1]/25"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => setDigits((d) => d.slice(0, -1))}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.04] text-[10px] font-bold text-zinc-400"
          >
            ⌫
          </button>
        </div>

        {mode === 'setup' && savedPin && (
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onClearPin();
            }}
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-[#ff5d6c]/40 bg-[#ff5d6c]/12 py-1.5 text-[10px] font-extrabold text-[#ff5d6c]"
          >
            <Unlock className="h-3 w-3" />
            REMOVE PIN LOCK
          </button>
        )}
      </div>
    </div>
  );
}
