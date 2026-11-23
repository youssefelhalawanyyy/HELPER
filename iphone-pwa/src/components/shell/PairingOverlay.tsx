'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  Globe,
  Laptop,
  Loader2,
  ShieldCheck,
  Terminal,
  Unplug,
  Wifi,
  X,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { ConnectionState, PairingConfig } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

interface PairingOverlayProps {
  open: boolean;
  status: ConnectionState;
  currentPairing: PairingConfig | null;
  onClose?: () => void;
  onPairWithPin: (host: string, port: number, pin: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => void;
}

type PairMode = 'tunnel' | 'lan';

export function PairingOverlay({
  open,
  status,
  currentPairing,
  onClose,
  onPairWithPin,
  onDisconnect,
}: PairingOverlayProps) {
  const [mode, setMode] = useState<PairMode>('tunnel');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4747');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<number | null>(null);
  const pinRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);

    if (currentPairing?.host) {
      setHost(currentPairing.host);
      setPort(String(currentPairing.port || 4747));
      setMode(/^https:\/\//i.test(currentPairing.host) ? 'tunnel' : 'lan');
      return;
    }

    if (typeof window !== 'undefined') {
      const h = window.location.hostname;
      const isHosted = h.includes('vercel.app') || window.location.protocol === 'https:';
      if (isHosted) {
        setMode('tunnel');
        setHost('');
      } else {
        setMode('lan');
        setHost(h || '127.0.0.1');
      }
    }
  }, [open, currentPairing]);

  const pin = digits.join('');

  const handleDigitChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }

    // Handle pasting a full 6-digit PIN
    if (cleaned.length > 1) {
      const next = [...digits];
      for (let i = 0; i < 6 && i < cleaned.length; i += 1) {
        next[i] = cleaned[i];
      }
      setDigits(next);
      const focusIdx = Math.min(5, cleaned.length);
      pinRefs.current[focusIdx]?.focus();
      return;
    }

    soundEngine.playDetent();
    const next = [...digits];
    next[index] = cleaned[0];
    setDigits(next);
    if (index < 5) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handleCopyCommand = (idx: number, cmd: string) => {
    soundEngine.playClick();
    void navigator.clipboard?.writeText(cmd);
    setCopiedCmd(idx);
    window.setTimeout(() => setCopiedCmd(null), 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || pin.length < 6) return;
    setError(null);
    setBusy(true);
    soundEngine.playClick();

    const normalizedHost =
      mode === 'tunnel' && !/^https?:\/\//i.test(host.trim())
        ? `https://${host.trim()}`
        : host.trim();
    const resolvedPort = mode === 'tunnel' ? 443 : Number(port) || 4747;

    const res = await onPairWithPin(normalizedHost, resolvedPort, pin);
    setBusy(false);
    if (!res.ok) {
      soundEngine.playErrorThud();
      setError(res.error || 'Pairing failed');
    } else {
      setDigits(['', '', '', '', '', '']);
      onClose?.();
    }
  };

  const isConnected = status === 'connected';
  const readyToConnect = host.trim().length > 3 && pin.length === 6 && !busy;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-3 backdrop-blur-xl"
        >
          {/* Ambient radial halo */}
          <div
            className="pointer-events-none absolute h-[340px] w-[540px] rounded-full opacity-25 blur-[90px]"
            style={{
              background:
                mode === 'tunnel'
                  ? 'radial-gradient(circle, #22d3ee 0%, #2563eb 50%, transparent 75%)'
                  : 'radial-gradient(circle, #34d399 0%, #22d3ee 50%, transparent 75%)',
            }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={DECK_SPRING}
            onClick={(e) => e.stopPropagation()}
            className="tile relative w-full max-w-[560px] overflow-hidden p-5"
            style={{
              borderRadius: 26,
              borderColor: 'rgba(255,255,255,0.12)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.09), 0 30px 80px -15px rgba(0,0,0,0.95)',
            }}
          >
            {/* Top-left neon L-accent bar */}
            <div
              className="absolute top-0 left-0 h-[3px] w-3/5 rounded-r-full transition-colors duration-500"
              style={{
                background:
                  mode === 'tunnel'
                    ? 'linear-gradient(90deg, #22d3ee, #34d399)'
                    : 'linear-gradient(90deg, #34d399, #fbbf24)',
              }}
            />
            <div
              className="absolute top-0 left-0 h-1/2 w-[3px] rounded-b-full"
              style={{
                background:
                  mode === 'tunnel'
                    ? 'linear-gradient(#22d3ee, transparent)'
                    : 'linear-gradient(#34d399, transparent)',
              }}
            />

            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(34,211,238,0.18), rgba(52,211,153,0.1))',
                    boxShadow: '0 0 24px -6px rgba(34,211,238,0.5)',
                  }}
                >
                  <Laptop className="h-5 w-5 text-[#22d3ee]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="disp text-[26px] text-[#f2f3f7]">Pair With Mac</h1>
                    <span
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider"
                      style={{
                        background: isConnected
                          ? 'rgba(52,211,153,.15)'
                          : 'rgba(255,255,255,.07)',
                        color: isConnected ? '#34d399' : '#9ca3af',
                      }}
                    >
                      <i
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: isConnected ? '#34d399' : '#6b7080' }}
                      />
                      {status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#8b90a0]">
                    Link your iPhone 14 to the local Mac bridge over zero-latency WebSockets.
                  </p>
                </div>
              </div>

              {onClose && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.88 }}
                  onClick={onClose}
                  aria-label="Close pairing dialog"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-[#8b90a0] hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              )}
            </div>

            {/* Connection Mode Switcher */}
            <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-2xl border border-white/[0.07] bg-black/70 p-1">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setMode('tunnel');
                  if (/^(127\.0\.0\.1|localhost|192\.168\.)/.test(host)) setHost('');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold transition-all ${
                  mode === 'tunnel'
                    ? 'bg-[#1b1d24] text-[#22d3ee] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                    : 'text-[#7c8190] hover:text-zinc-200'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                HTTPS Tunnel (Vercel / iPhone)
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setMode('lan');
                  if (!host || /^https:\/\//i.test(host)) setHost('127.0.0.1');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold transition-all ${
                  mode === 'lan'
                    ? 'bg-[#1b1d24] text-[#34d399] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                    : 'text-[#7c8190] hover:text-zinc-200'
                }`}
              >
                <Wifi className="h-3.5 w-3.5" />
                Local Mac / LAN IP
              </button>
            </div>

            {/* Pairing Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              {/* Row 1: Bridge Address */}
              <div className="grid grid-cols-12 gap-2.5">
                <label className={mode === 'tunnel' ? 'col-span-12 flex flex-col gap-1' : 'col-span-8 flex flex-col gap-1'}>
                  <div className="flex items-center justify-between">
                    <span className="sub">
                      {mode === 'tunnel' ? 'Cloudflare Tunnel HTTPS URL' : 'Mac IP Address'}
                    </span>
                    {mode === 'lan' && (
                      <button
                        type="button"
                        onClick={() => setHost('127.0.0.1')}
                        className="text-[10px] font-bold text-[#34d399] hover:underline"
                      >
                        Use 127.0.0.1 (this Mac)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={
                      mode === 'tunnel'
                        ? 'https://your-tunnel-name.trycloudflare.com'
                        : '192.168.100.44 or 127.0.0.1'
                    }
                    className="font-mono-tech rounded-xl border border-white/10 bg-black/90 px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-[#22d3ee]"
                  />
                </label>

                {mode === 'lan' && (
                  <label className="col-span-4 flex flex-col gap-1">
                    <span className="sub">Bridge Port</span>
                    <input
                      type="number"
                      required
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="font-mono-tech rounded-xl border border-white/10 bg-black/90 px-3 py-2.5 text-xs text-white outline-none focus:border-[#34d399]"
                    />
                  </label>
                )}
              </div>

              {/* Row 2: 6-Digit Hardware OTP PIN */}
              <div className="flex flex-col gap-1.5">
                <span className="sub">6-Digit Terminal Pair PIN</span>
                <div className="grid grid-cols-6 gap-2">
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        pinRefs.current[i] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={d}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(i, e)}
                      aria-label={`PIN digit ${i + 1}`}
                      placeholder="•"
                      className="font-mono-tech num h-11 w-full rounded-xl border border-white/10 bg-black/90 text-center text-lg font-extrabold text-[#22d3ee] placeholder:text-zinc-700 outline-none transition-all focus:border-[#22d3ee] focus:shadow-[0_0_16px_-4px_rgba(34,211,238,0.6)]"
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-[#ff5d6c]/35 bg-[#ff5d6c]/10 px-3 py-2 text-[11px] font-medium text-[#ff9ca5]">
                  {error}
                </div>
              )}

              {/* Quick Mac Terminal Cheat Sheet */}
              <div className="rounded-2xl border border-white/[0.06] bg-black/60 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Terminal className="h-3 w-3 text-[#34d399]" />
                  <span className="sub !text-[9px]">Run on your Mac</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    {
                      tag: 'Terminal 1',
                      cmd: 'cd /Users/youssefhalawanyy/HELPER && npm run dev:bridge',
                    },
                    ...(mode === 'tunnel'
                      ? [
                          {
                            tag: 'Terminal 2',
                            cmd: 'npx -y cloudflared tunnel --url http://127.0.0.1:4747',
                          },
                        ]
                      : []),
                  ].map((item, idx) => (
                    <div
                      key={item.tag}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="mr-2 text-[9px] font-extrabold uppercase text-[#22d3ee]">
                          {item.tag}
                        </span>
                        <code className="font-mono-tech text-[10px] text-zinc-300">{item.cmd}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyCommand(idx, item.cmd)}
                        aria-label={`Copy ${item.tag} command`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.06] text-zinc-400 hover:text-white"
                      >
                        {copiedCmd === idx ? (
                          <Check className="h-3 w-3 text-[#34d399]" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Row */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                {currentPairing ? (
                  <button
                    type="button"
                    onClick={onDisconnect}
                    className="flex items-center gap-1.5 rounded-full border border-[#ff5d6c]/35 bg-[#ff5d6c]/10 px-3.5 py-2 text-[11px] font-bold text-[#ff5d6c] hover:bg-[#ff5d6c]/20"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    Unpair Mac
                  </button>
                ) : (
                  <span className="sub">Zero cloud · local Wi-Fi</span>
                )}

                <motion.button
                  type="submit"
                  whileTap={readyToConnect ? { scale: 0.96 } : undefined}
                  disabled={!readyToConnect}
                  className="flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold tracking-wide transition-all disabled:opacity-35"
                  style={{
                    background: readyToConnect ? '#34d399' : '#1f232c',
                    color: readyToConnect ? '#04130c' : '#8b90a0',
                    boxShadow: readyToConnect
                      ? '0 3px 0 #14664a, 0 0 24px -4px rgba(52,211,153,0.65)'
                      : 'none',
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  CONNECT TO MAC
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
