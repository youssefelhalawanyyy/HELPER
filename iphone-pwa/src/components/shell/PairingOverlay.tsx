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
type HostOs = 'mac' | 'windows';

export function PairingOverlay({
  open,
  status,
  currentPairing,
  onClose,
  onPairWithPin,
  onDisconnect,
}: PairingOverlayProps) {
  const [mode, setMode] = useState<PairMode>('tunnel');
  const [hostOs, setHostOs] = useState<HostOs>('mac');
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

    if (cleaned.length > 1) {
      const next = [...digits];
      for (let i = 0; i < 6 && i < cleaned.length; i += 1) {
        next[i] = cleaned[i];
      }
      setDigits(next);
      pinRefs.current[Math.min(5, cleaned.length)]?.focus();
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

    const rawHost = host.trim();
    const isLocalOrIp = /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i.test(rawHost);
    const normalizedHost =
      /^https?:\/\//i.test(rawHost)
        ? rawHost
        : isLocalOrIp
          ? rawHost
          : mode === 'tunnel'
            ? `https://${rawHost}`
            : rawHost;
    const resolvedPort =
      /^https:\/\//i.test(normalizedHost) || (mode === 'tunnel' && !isLocalOrIp)
        ? 443
        : Number(port) || 4747;

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
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 p-2.5 backdrop-blur-xl sm:p-4"
        >
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute h-[280px] w-[520px] rounded-full opacity-25 blur-[90px]"
            style={{
              background:
                mode === 'tunnel'
                  ? 'radial-gradient(circle, #22d3ee 0%, #2563eb 50%, transparent 75%)'
                  : 'radial-gradient(circle, #34d399 0%, #22d3ee 50%, transparent 75%)',
            }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={DECK_SPRING}
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }} aria-label="Pair with computer"
            className="pair-sheet tile deck-scroll relative w-full max-w-[740px] overflow-y-auto p-3.5"
            style={{
              borderRadius: 21,
              borderColor: 'rgba(152,200,206,0.22)',
              boxShadow:
                'inset 0 1px 0 rgba(188,255,242,0.08), 0 30px 80px -15px rgba(2,8,12,0.95)',
            }}
          >
            {/* Compact Header Row */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/icon-192.png"
                  alt="DevDeck logo"
                  className="h-9 w-9 shrink-0 rounded-xl border border-[#88f1d1]/45 object-cover shadow-[0_0_12px_rgba(136,241,209,0.25)]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="disp text-[22px] text-[#f2f3f7] sm:text-[24px]">
                    Pair With Computer
                  </h1>
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
              </div>

              {onClose && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.88 }}
                  onClick={onClose}
                  autoFocus
                aria-label="Close pairing dialog"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-[#8b90a0] hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </motion.button>
              )}
            </div>

            <div className="pair-columns grid grid-cols-12 gap-3">
              {/* Left Column: Mode Tabs + Inputs + OTP PIN + Submit */}
              <form onSubmit={handleSubmit} className="col-span-7 flex flex-col gap-2.5">
                {/* Mode Tabs */}
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setMode('tunnel');
                      if (/^(127\.0\.0\.1|localhost|192\.168\.)/.test(host)) setHost('');
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] font-bold transition-all ${
                      mode === 'tunnel'
                        ? 'bg-[#142b34] text-[#88f1d1] shadow-[inset_0_1px_0_rgba(188,255,242,0.1)]'
                        : 'text-[#9cb4bb] hover:text-[#effaf7]'
                    }`}
                  >
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">HTTPS Tunnel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setMode('lan');
                      if (!host || /^https:\/\//i.test(host)) setHost('127.0.0.1');
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] font-bold transition-all ${
                      mode === 'lan'
                        ? 'bg-[#142b34] text-[#88f1d1] shadow-[inset_0_1px_0_rgba(188,255,242,0.1)]'
                        : 'text-[#9cb4bb] hover:text-[#effaf7]'
                    }`}
                  >
                    <Wifi className="h-3 w-3 shrink-0" />
                    <span className="truncate">Local PC / IP</span>
                  </button>
                </div>

                {/* Host / Port Row */}
                <div className="grid grid-cols-12 gap-2">
                  <label
                    className={
                      mode === 'tunnel'
                        ? 'col-span-12 flex flex-col gap-1'
                        : 'col-span-8 flex flex-col gap-1'
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="sub !text-[9px]">
                        {mode === 'tunnel' ? 'Cloudflare Tunnel URL' : 'Computer IP Address'}
                      </span>
                      {mode === 'lan' && (
                        <button
                          type="button"
                          onClick={() => setHost('127.0.0.1')}
                          className="text-[9.5px] font-bold text-[#34d399] hover:underline"
                        >
                          Use 127.0.0.1
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
                          ? 'https://xxxx.trycloudflare.com'
                          : '127.0.0.1 or 192.168.x.x'
                      }
                      className="font-mono-tech rounded-xl border border-white/10 bg-black/90 px-3 py-2 text-[11.5px] text-white placeholder:text-zinc-600 outline-none focus:border-[#22d3ee]"
                    />
                  </label>

                  {mode === 'lan' && (
                    <label className="col-span-4 flex flex-col gap-1">
                      <span className="sub !text-[9px]">Port</span>
                      <input
                        type="number"
                        required
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        className="font-mono-tech rounded-xl border border-white/10 bg-black/90 px-2.5 py-2 text-[11.5px] text-white outline-none focus:border-[#34d399]"
                      />
                    </label>
                  )}
                </div>

                {/* 6-Digit Hardware OTP PIN */}
                <div className="flex flex-col gap-1">
                  <span className="sub !text-[9px]">6-Digit Terminal Pair PIN</span>
                  <div className="grid grid-cols-6 gap-1.5">
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
                        className="font-mono-tech num h-10 w-full rounded-xl border border-white/10 bg-black/90 text-center text-base font-extrabold text-[#22d3ee] placeholder:text-zinc-700 outline-none transition-all focus:border-[#22d3ee] focus:shadow-[0_0_14px_-4px_rgba(34,211,238,0.65)]"
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-[#ff5d6c]/35 bg-[#ff5d6c]/10 px-2.5 py-1.5 text-[10.5px] font-medium text-[#ff9ca5]">
                    {error}
                  </div>
                )}

                {/* Action Row */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  {currentPairing ? (
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="flex items-center gap-1 rounded-full border border-[#ff5d6c]/35 bg-[#ff5d6c]/10 px-3 py-1.5 text-[10.5px] font-bold text-[#ff5d6c]"
                    >
                      <Unplug className="h-3 w-3" />
                      Unpair
                    </button>
                  ) : (
                    <span className="sub !text-[8.5px]">Local Wi-Fi · Zero Cloud</span>
                  )}

                  <motion.button
                    type="submit"
                    whileTap={readyToConnect ? { scale: 0.96 } : undefined}
                    disabled={!readyToConnect}
                    className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-extrabold tracking-wide transition-all disabled:opacity-35"
                    style={{
                      background: readyToConnect ? '#34d399' : '#1f232c',
                      color: readyToConnect ? '#04130c' : '#8b90a0',
                      boxShadow: readyToConnect
                        ? '0 3px 0 #14664a, 0 0 22px -4px rgba(52,211,153,0.65)'
                        : 'none',
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    CONNECT TO COMPUTER
                  </motion.button>
                </div>
              </form>

              {/* Right Column: Mac & Windows Terminal Setup Guide */}
              <div className="col-span-5 flex flex-col justify-between gap-2 rounded-2xl border border-white/[0.07] bg-black/60 p-3">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-[#34d399]" />
                      <span className="sub !text-[9px] !text-zinc-300">Terminal Steps</span>
                    </div>
                    <div className="flex rounded-full bg-white/[0.06] p-0.5">
                      {(
                        [
                          { id: 'mac', label: 'Mac' },
                          { id: 'windows', label: 'Windows' },
                        ] as const
                      ).map((osTab) => (
                        <button
                          key={osTab.id}
                          type="button"
                          onClick={() => {
                            soundEngine.playClick();
                            setHostOs(osTab.id);
                          }}
                          className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase transition-colors"
                          style={{
                            background: hostOs === osTab.id ? '#22d3ee' : 'transparent',
                            color: hostOs === osTab.id ? '#041016' : '#8b90a0',
                          }}
                        >
                          {osTab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(hostOs === 'mac'
                      ? [
                          {
                            tag: '1. Start Live + QR (Mac)',
                            cmd: 'cd /Users/youssefhalawanyy/HELPER && npm run live',
                            note: 'Starts bridge + HTTPS tunnel + prints 1-scan QR & PIN',
                          },
                          ...(mode === 'tunnel'
                            ? [
                                {
                                  tag: '2. Pair iPhone',
                                  cmd: 'Scan QR or paste https://….trycloudflare.com + PIN',
                                  note: 'Works from anywhere over HTTPS',
                                },
                              ]
                            : [
                                {
                                  tag: '2. Local IP (Same Mac)',
                                  cmd: '127.0.0.1',
                                  note: 'Use 127.0.0.1 on this Mac, or LAN IP on Wi-Fi',
                                },
                              ]),
                        ]
                      : [
                          {
                            tag: '1. First Time (PowerShell)',
                            cmd: 'git clone https://github.com/youssefelhalawanyyy/HELPER.git; cd HELPER; npm install',
                            note: 'Requires Node.js LTS on Windows 10/11',
                          },
                          {
                            tag: '2. Start Live + QR (Windows)',
                            cmd: 'npm run live',
                            note: 'Or right-click start-windows.bat → Run as Administrator',
                          },
                        ]
                    ).map((item, idx) => (
                      <div
                        key={item.tag}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[9.5px] font-extrabold uppercase text-[#22d3ee]">
                            {item.tag}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyCommand(idx, item.cmd)}
                            aria-label={`Copy ${item.tag}`}
                            className="flex items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 hover:text-white"
                          >
                            {copiedCmd === idx ? (
                              <>
                                <Check className="h-2.5 w-2.5 text-[#34d399]" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-2.5 w-2.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <code className="font-mono-tech block break-all text-[9.5px] leading-snug text-zinc-200">
                          {item.cmd}
                        </code>
                        <div className="mt-1 text-[9px] text-[#7c8190]">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-[9.5px] leading-snug text-[#7c8190]">
                  <span>
                    {hostOs === 'windows'
                      ? 'Run as Admin for full Defender + SFC repair.'
                      : mode === 'tunnel'
                        ? 'Scan terminal QR for 1-tap pairing.'
                        : 'Fastest on this computer (no tunnel).'}
                  </span>
                  <a
                    href={`/setup#${hostOs}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-bold text-[#22d3ee] hover:underline"
                  >
                    Full Setup Guide ↗
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
