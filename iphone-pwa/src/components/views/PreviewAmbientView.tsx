'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Globe, Moon, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export function PreviewAmbientView({ deck }: { deck: DevDeckState }) {
  const [mode, setMode] = useState<'ambient' | 'preview'>('ambient');
  const [urlInput, setUrlInput] = useState(deck.previewUrl);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => setUrlInput(deck.previewUrl), [deck.previewUrl]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const resolvedUrl = useMemo(() => {
    const raw = deck.previewUrl || 'http://localhost:3000';
    if (!deck.hello?.lanIp) return raw;
    return raw.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `//${deck.hello.lanIp}`);
  }, [deck.previewUrl, deck.hello?.lanIp]);

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const secStr = String(now.getSeconds()).padStart(2, '0');
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  if (mode === 'preview') {
    return (
      <div className="tile flex h-full flex-col p-2.5">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('ambient')}
            className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-[10px] font-bold"
          >
            <Moon className="h-3 w-3 text-[#22d3ee]" />
            Ambient
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              deck.sendEvent({
                type: 'preview:set',
                payload: { requestId: makeRequestId(), url: urlInput.trim() },
              });
            }}
            className="flex flex-1 gap-1.5"
          >
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="font-mono-tech flex-1 rounded-full border border-white/10 bg-black px-3 py-1 text-[10.5px] text-white outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-[#34d399] px-3 py-1 text-[10px] font-extrabold text-[#04130c]"
            >
              Sync
            </button>
          </form>
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.08] text-[#22d3ee]"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <iframe
          src={resolvedUrl}
          title="Localhost Preview"
          className="min-h-0 flex-1 rounded-xl border border-white/10 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {/* Left: Pure OLED Clock + Media Controls */}
      <div className="tile flex flex-col justify-between p-4">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#60a5fa]" />
        <div className="flex items-center justify-between">
          <span className="sub">{dateStr}</span>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setMode('preview');
            }}
            className="flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[9.5px] font-bold text-[#34d399]"
          >
            <Globe className="h-3 w-3" />
            PREVIEW
          </button>
        </div>

        <div className="num flex items-baseline gap-1.5">
          <span className="disp text-[64px] tracking-tight">{timeStr}</span>
          <span className="text-[20px] font-extrabold text-[#60a5fa]">:{secStr}</span>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-black/60 p-2.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold">{deck.mediaState.track}</div>
            <div className="sub truncate">{deck.mediaState.artist}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(['prev', 'playpause', 'next'] as const).map((action) => (
              <motion.button
                key={action}
                type="button"
                whileTap={{ scale: 0.88 }}
                transition={DECK_SPRING}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'media:control',
                    payload: { requestId: makeRequestId(), action },
                  });
                }}
                aria-label={action}
                className="grid h-8 w-8 place-items-center rounded-full"
                style={{
                  background: action === 'playpause' ? '#34d399' : 'rgba(255,255,255,.08)',
                  color: action === 'playpause' ? '#04130c' : '#f2f3f7',
                }}
              >
                {action === 'prev' ? (
                  <SkipBack className="h-3.5 w-3.5" />
                ) : action === 'next' ? (
                  <SkipForward className="h-3.5 w-3.5" />
                ) : deck.mediaState.playing ? (
                  <Pause className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Mac Clipboard History */}
      <div className="tile flex min-h-0 flex-col p-4">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#a78bfa]" />
        <div className="mb-2 flex items-center justify-between">
          <div className="disp text-[26px]">Clipboard</div>
          <span className="sub">{deck.clipboard.history.length} items</span>
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
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-left hover:border-[#a78bfa]/50"
            >
              <p className="font-mono-tech line-clamp-2 text-[10.5px] text-zinc-200">{item.text}</p>
            </button>
          ))}
          {deck.clipboard.history.length === 0 && (
            <div className="sub grid h-full place-items-center text-center">
              Copy anything on your Mac — it syncs here live
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
