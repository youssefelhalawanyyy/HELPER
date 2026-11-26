'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Coffee,
  Lock,
  Mic,
  Search,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { PAGES, type DeckViewId } from '@/components/shell/LeftNavRail';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export function CommandSearchOverlay({
  deck,
  onNavigate,
  onClose,
}: {
  deck: DevDeckState;
  onNavigate: (id: DeckViewId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const quickControls = useMemo(() => {
    const items = [
      {
        id: 'audio-mute',
        keywords: 'audio sound volume mute speakers airpods',
        label: deck.mediaState.muted ? 'Unmute Computer Audio' : 'Mute Computer Audio',
        sub: `Current volume: ${deck.mediaState.volume}% · ${deck.macTelemetry?.audioOutputDevice || 'Speakers'}`,
        icon: deck.mediaState.muted ? VolumeX : Volume2,
        run: () =>
          deck.sendEvent({
            type: 'hardware:mute',
            payload: { requestId: makeRequestId(), muted: !deck.mediaState.muted },
          }),
      },
      {
        id: 'mic-mute',
        keywords: 'audio mic microphone mute call meeting',
        label: deck.macTelemetry?.micMuted ? 'Unmute Microphone' : 'Mute Microphone',
        sub: 'System-wide input toggle',
        icon: Mic,
        run: () => deck.sendEvent({ type: 'system:toggleMic', payload: { requestId: makeRequestId() } }),
      },
      {
        id: 'caffeine',
        keywords: 'awake caffeine sleep screen display',
        label: deck.caffeineActive ? 'Turn OFF Caffeine' : 'Turn ON Caffeine (Keep Awake)',
        sub: 'Sticky awake lock',
        icon: Coffee,
        run: () =>
          deck.sendEvent({
            type: 'hardware:caffeine',
            payload: { requestId: makeRequestId(), active: !deck.caffeineActive },
          }),
      },
      {
        id: 'super-mode',
        keywords: 'perf gpu super turbo eco fast ram speed',
        label: 'Switch to SUPER Performance Mode',
        sub: `Current mode: ${deck.perfState.mode.toUpperCase()}`,
        icon: Zap,
        run: () =>
          deck.sendEvent({
            type: 'perf:setMode',
            payload: { requestId: makeRequestId(), mode: 'super' },
          }),
      },
      {
        id: 'lock-screen',
        keywords: 'lock sleep security power',
        label: 'Lock Computer Screen',
        sub: 'Instant display lock',
        icon: Lock,
        run: () => deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } }),
      },
    ];
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.includes(q) || i.sub.toLowerCase().includes(q),
    );
  }, [deck, q]);

  const matchedPages = useMemo(() => {
    if (!q) return PAGES.slice(0, 8);
    return PAGES.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [q]);

  const matchedMacros = useMemo(() => {
    const list = deck.config?.macros || [];
    if (!q) return list.slice(0, 4);
    return list
      .filter((m) => m.label.toLowerCase().includes(q) || m.payload.toLowerCase().includes(q))
      .slice(0, 6);
  }, [deck.config?.macros, q]);

  if (!mounted) return null;

  return createPortal(
    <div
      data-no-swipe="true"
      onClick={onClose}
      className="fixed inset-0 z-[9995] flex items-start justify-center bg-black/80 px-3 pt-10"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-[520px] flex-col gap-2.5 overflow-hidden rounded-3xl border border-[#88f1d1]/35 bg-[#09151c] p-3.5 shadow-2xl"
      >
        <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-black/75 px-3 py-2">
          <Search className="h-4 w-4 text-[#88f1d1]" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search every control, macro, or tool (e.g. "audio", "heat", "files")…'
            className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-500"
          />
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="deck-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
          {/* Live Controls */}
          {quickControls.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-extrabold tracking-wider text-[#88f1d1] uppercase">
                Live Controls
              </div>
              {quickControls.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      c.run();
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-left hover:border-[#88f1d1]/45"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-[#88f1d1]" />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-extrabold text-white">{c.label}</div>
                        <div className="truncate text-[9px] text-[#9cb4bb]">{c.sub}</div>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#88f1d1]/15 px-2 py-0.5 text-[8px] font-extrabold text-[#88f1d1]">
                      RUN
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Matched Macros */}
          {matchedMacros.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-extrabold tracking-wider text-[#fbbf24] uppercase">
                Smart Deck Macros
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {matchedMacros.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      deck.sendEvent({
                        type: 'macro:execute',
                        payload: { requestId: makeRequestId(), macroId: m.id },
                      });
                      onClose();
                    }}
                    className="truncate rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-left text-[10.5px] font-bold text-white hover:border-[#fbbf24]/45"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All Tools & Workspaces */}
          {matchedPages.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-extrabold tracking-wider text-[#7dd3fc] uppercase">
                Tools &amp; Screens
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {matchedPages.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        onNavigate(p.id);
                        onClose();
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-left text-[10.5px] font-bold text-white hover:border-[#7dd3fc]/45"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[#7dd3fc]" />
                      <span className="truncate">{p.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
