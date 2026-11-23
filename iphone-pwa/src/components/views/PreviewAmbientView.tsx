'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clipboard,
  Clock,
  ExternalLink,
  Globe,
  Moon,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export function PreviewAmbientView({ deck }: { deck: DevDeckState }) {
  const [subMode, setSubMode] = useState<'ambient' | 'preview'>('ambient');
  const [urlInput, setUrlInput] = useState(deck.previewUrl);
  const [iframeKey, setIframeKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setUrlInput(deck.previewUrl);
  }, [deck.previewUrl]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Rewrite localhost / 127.0.0.1 to Mac's LAN IP so iPhone can load it seamlessly
  const resolvedPreviewUrl = useMemo(() => {
    const raw = deck.previewUrl || 'http://localhost:3000';
    if (!deck.hello?.lanIp) return raw;
    return raw.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `//${deck.hello.lanIp}`);
  }, [deck.previewUrl, deck.hello?.lanIp]);

  const handleSyncUrl = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.playClick();
    deck.sendEvent({
      type: 'preview:set',
      payload: { requestId: makeRequestId(), url: urlInput.trim() },
    });
    setIframeKey((k) => k + 1);
  };

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const secStr = String(now.getSeconds()).padStart(2, '0');
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      {/* Sub-mode Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setSubMode('ambient');
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[11px] font-medium ${
              subMode === 'ambient'
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                : 'border-white/[0.08] bg-[#101014] text-zinc-400'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            OLED Ambient
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setSubMode('preview');
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[11px] font-medium ${
              subMode === 'preview'
                ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                : 'border-white/[0.08] bg-[#101014] text-zinc-400'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            Localhost Preview
          </button>
        </div>

        {subMode === 'preview' && (
          <form onSubmit={handleSyncUrl} className="flex flex-1 items-center justify-end gap-1.5">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:5173"
              className="font-mono-tech w-full max-w-[300px] rounded-lg border border-white/10 bg-black px-2.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-emerald-400"
            />
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-black"
            >
              Sync
            </button>
            <button
              type="button"
              onClick={() => setIframeKey((k) => k + 1)}
              aria-label="Reload preview"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <a
              href={resolvedPreviewUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open preview in Safari"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </form>
        )}
      </div>

      {/* Mode 1: OLED Ambient Standby Mode */}
      {subMode === 'ambient' ? (
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-2.5">
          {/* Left: Minimalist OLED Clock + Media Controls */}
          <div className="col-span-6 flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-black p-4">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
                <Clock className="h-3 w-3 text-cyan-400" />
                <span>{dateStr}</span>
              </div>
              <div className="font-mono-tech mt-1 flex items-baseline gap-1.5">
                <span className="text-5xl font-bold tracking-tighter text-white">{timeStr}</span>
                <span className="text-lg font-medium text-cyan-400/80">:{secStr}</span>
              </div>
            </div>

            {/* Mac Media Controls */}
            <div className="hw-panel flex items-center justify-between gap-3 rounded-xl p-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white">
                  {deck.mediaState.track}
                </div>
                <div className="truncate text-[10px] text-zinc-400">
                  {deck.mediaState.artist} · {deck.mediaState.player}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'media:control',
                      payload: { requestId: makeRequestId(), action: 'prev' },
                    });
                  }}
                  aria-label="Previous track"
                  className="hw-key flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'media:control',
                      payload: { requestId: makeRequestId(), action: 'playpause' },
                    });
                  }}
                  aria-label="Play or pause"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500 text-black shadow-[0_0_16px_rgba(6,182,212,0.35)]"
                >
                  {deck.mediaState.playing ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'media:control',
                      payload: { requestId: makeRequestId(), action: 'next' },
                    });
                  }}
                  aria-label="Next track"
                  className="hw-key flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </div>
          </div>

          {/* Right: Mac Clipboard History Ring */}
          <div className="hw-panel col-span-6 flex min-h-0 flex-col rounded-2xl p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clipboard className="h-3.5 w-3.5 text-cyan-400" />
                <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Mac Clipboard History ({deck.clipboard.history.length})
                </span>
              </div>
              <span className="font-mono-tech text-[9px] text-zinc-500">Tap to re-copy</span>
            </div>

            <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {deck.clipboard.history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    deck.sendEvent({
                      type: 'clipboard:copy',
                      payload: { requestId: makeRequestId(), text: item.text },
                    });
                  }}
                  className="w-full rounded-lg border border-white/[0.06] bg-[#121216] px-2.5 py-2 text-left transition-colors hover:border-cyan-400/40"
                >
                  <p className="font-mono-tech line-clamp-2 text-[10.5px] text-zinc-200">
                    {item.text}
                  </p>
                </button>
              ))}

              {deck.clipboard.history.length === 0 && (
                <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                  Copy anything on your Mac — it appears here live
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Mode 2: Synced Localhost Preview */
        <div className="hw-panel relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
          <iframe
            key={`${iframeKey}-${resolvedPreviewUrl}`}
            src={resolvedPreviewUrl}
            title="Synced Mac Localhost Preview"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      )}
    </div>
  );
}
