'use client';

import { useEffect, useState } from 'react';
import { Loader2, QrCode, ShieldCheck, Unplug, X } from 'lucide-react';
import type { ConnectionState, PairingConfig } from '@/hooks/useDevDeckSocket';

interface PairingOverlayProps {
  open: boolean;
  status: ConnectionState;
  currentPairing: PairingConfig | null;
  onClose?: () => void;
  onPairWithPin: (host: string, port: number, pin: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => void;
}

export function PairingOverlay({
  open,
  status,
  currentPairing,
  onClose,
  onPairWithPin,
  onDisconnect,
}: PairingOverlayProps) {
  const [host, setHost] = useState(currentPairing?.host || '');
  const [port, setPort] = useState(String(currentPairing?.port || 4747));
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !host) {
      setHost(currentPairing?.host || window.location.hostname || '127.0.0.1');
    }
  }, [currentPairing, host]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await onPairWithPin(host.trim(), Number(port) || 4747, pin.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Pairing failed');
    } else {
      setPin('');
      onClose?.();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md">
      <div className="hw-panel relative w-full max-w-[480px] rounded-2xl p-4">
        {onClose && currentPairing && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pairing dialog"
            className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">Pair DevDeck with Mac</h1>
            <p className="text-[11px] text-zinc-400">
              Scan the terminal QR code on your Mac, or enter the 6-digit PIN below.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-2.5">
          <label className="col-span-5 flex flex-col gap-1">
            <span className="font-mono-tech text-[10px] uppercase tracking-wider text-zinc-400">
              Mac LAN IP or HTTPS URL
            </span>
            <input
              type="text"
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.42 or https://…"
              className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </label>

          <label className="col-span-3 flex flex-col gap-1">
            <span className="font-mono-tech text-[10px] uppercase tracking-wider text-zinc-400">
              Port
            </span>
            <input
              type="number"
              required
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </label>

          <label className="col-span-4 flex flex-col gap-1">
            <span className="font-mono-tech text-[10px] uppercase tracking-wider text-zinc-400">
              6-Digit PIN
            </span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="482910"
              className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-2 text-center text-xs tracking-[0.25em] text-cyan-300 outline-none focus:border-cyan-400"
            />
          </label>

          {error && (
            <div className="col-span-12 rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-1.5 text-[11px] text-red-200">
              {error}
            </div>
          )}

          <div className="col-span-12 mt-1 flex items-center justify-between gap-2">
            {currentPairing ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20"
              >
                <Unplug className="h-3.5 w-3.5" />
                Unpair
              </button>
            ) : (
              <span className="font-mono-tech text-[10px] text-zinc-500">
                Status: {status}
              </span>
            )}

            <button
              type="submit"
              disabled={busy || pin.length < 6}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-black transition-opacity disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Connect to Mac
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
