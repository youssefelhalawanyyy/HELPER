'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Battery,
  BatteryCharging,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coffee,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { AgentNotificationBanner } from '@/components/shell/AgentNotificationBanner';
import { AgentQuestionOverlay } from '@/components/shell/AgentQuestionOverlay';
import { SmartDeckView } from '@/components/views/SmartDeckView';
import { useDevDeckSocket } from '@/hooks/useDevDeckSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { formatTimer, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

const ViewSkeleton = () => (
  <div className="tile grid h-full place-items-center p-4">
    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#22d3ee]/30 border-t-[#22d3ee]" />
  </div>
);

// Lazy-load secondary views & modals for blazing-fast initial load on iPhone Safari
const PairingOverlay = dynamic(
  () => import('@/components/shell/PairingOverlay').then((m) => m.PairingOverlay),
  { ssr: false },
);
const SnippetDrawer = dynamic(
  () => import('@/components/shell/SnippetDrawer').then((m) => m.SnippetDrawer),
  { ssr: false },
);
const AntigravityMissionView = dynamic(
  () => import('@/components/views/AntigravityMissionView').then((m) => m.AntigravityMissionView),
  { loading: ViewSkeleton },
);
const LiveMonitorView = dynamic(
  () => import('@/components/views/LiveMonitorView').then((m) => m.LiveMonitorView),
  { loading: ViewSkeleton },
);
const MacInspectorView = dynamic(
  () => import('@/components/views/MacInspectorView').then((m) => m.MacInspectorView),
  { loading: ViewSkeleton },
);
const HardwareToolsView = dynamic(
  () => import('@/components/views/HardwareToolsView').then((m) => m.HardwareToolsView),
  { loading: ViewSkeleton },
);
const PreviewAmbientView = dynamic(
  () => import('@/components/views/PreviewAmbientView').then((m) => m.PreviewAmbientView),
  { loading: ViewSkeleton },
);
const LaunchControlView = dynamic(
  () => import('@/components/views/LaunchControlView').then((m) => m.LaunchControlView),
  { loading: ViewSkeleton },
);
const SystemDoctorView = dynamic(
  () => import('@/components/views/SystemDoctorView').then((m) => m.SystemDoctorView),
  { loading: ViewSkeleton },
);
const NetworkCommandView = dynamic(
  () => import('@/components/views/NetworkCommandView').then((m) => m.NetworkCommandView),
  { loading: ViewSkeleton },
);

export type DeckViewId =
  | 'deck'
  | 'antigravity'
  | 'monitor'
  | 'mac'
  | 'hardware'
  | 'preview'
  | 'launch'
  | 'doctor'
  | 'network';

const PAGES: Array<{ id: DeckViewId; label: string; accent: string }> = [
  { id: 'deck', label: 'Deck', accent: '#34d399' },
  { id: 'antigravity', label: 'Antigravity', accent: '#22d3ee' },
  { id: 'monitor', label: 'Monitor', accent: '#f472b6' },
  { id: 'mac', label: 'Mac & Dock', accent: '#a78bfa' },
  { id: 'hardware', label: 'Trackpad & Snap', accent: '#fbbf24' },
  { id: 'preview', label: 'Desk Clock', accent: '#60a5fa' },
  { id: 'launch', label: 'Launch', accent: '#fbbf24' },
  { id: 'doctor', label: 'PC Doctor', accent: '#ff5d6c' },
  { id: 'network', label: 'NetOps Pro', accent: '#22d3ee' },
];

const PAGE_VARIANTS = {
  enter: (dir: number) => ({
    x: dir > 0 ? 160 : -160,
    opacity: 0,
    scale: 0.96,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -160 : 160,
    opacity: 0,
    scale: 0.96,
  }),
};

export function DeckShell() {
  const deck = useDevDeckSocket();
  const wakeLock = useWakeLock();
  const [pageIdx, setPageIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [antigravityMode, setAntigravityMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState({
    stageW: 844,
    stageH: 390,
    scale: 1,
    portrait: false,
  });

  // Swipe gesture tracking (works in both landscape & 90deg-rotated portrait)
  const swipeStartRef = useRef<{ x: number; y: number; blocked: boolean } | null>(null);

  const activePage = PAGES[pageIdx];
  const activeView = activePage.id;

  const goToIndex = useCallback(
    (nextIdx: number) => {
      const len = PAGES.length;
      const wrapped = ((nextIdx % len) + len) % len;
      if (wrapped === pageIdx) return;
      setDirection(nextIdx > pageIdx ? 1 : -1);
      setPageIdx(wrapped);
      soundEngine.playDetent();
    },
    [pageIdx],
  );

  const goToView = useCallback(
    (id: DeckViewId) => {
      const idx = PAGES.findIndex((p) => p.id === id);
      if (idx >= 0) goToIndex(idx);
    },
    [goToIndex],
  );

  // Idle-prefetch secondary view chunks after first paint so tab swipes feel instant
  useEffect(() => {
    const warmChunks = () => {
      void import('@/components/views/AntigravityMissionView');
      void import('@/components/views/HardwareToolsView');
      void import('@/components/views/SystemDoctorView');
      void import('@/components/views/NetworkCommandView');
      void import('@/components/views/LiveMonitorView');
      void import('@/components/views/MacInspectorView');
      void import('@/components/views/PreviewAmbientView');
      void import('@/components/views/LaunchControlView');
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warmChunks, { timeout: 1800 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warmChunks, 900);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    try {
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      void orient?.lock?.('landscape')?.catch(() => {});
    } catch {
      // iOS Safari uses CSS 90deg lock below
    }

    const updateViewport = () => {
      const vv = window.visualViewport;
      const w = vv?.width ?? window.innerWidth;
      const h = vv?.height ?? window.innerHeight;
      const portrait = h > w;

      // Exact landscape dimensions after 90deg rotation when phone is held upright
      const landW = portrait ? h : w;
      const landH = portrait ? w : h;

      // Always fill 100% of the screen edge-to-edge in BOTH orientations (zero black bars)
      const stageH = 390;
      const stageW = Math.max(660, Math.round(stageH * (landW / Math.max(1, landH))));
      const scale = landH / stageH;

      setViewport({ stageW, stageH, scale, portrait });
    };

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));

    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || pairingModalOpen || snippetsOpen || deck.agentQuestion) return;
    const target = e.target as HTMLElement | null;
    const blocked = Boolean(
      target?.closest('[data-no-swipe="true"], input, textarea, select, iframe'),
    );
    swipeStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      blocked,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.blocked || e.changedTouches.length === 0) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;

    // When rotated 90deg clockwise in portrait, the stage's horizontal axis is physical Y
    const stageDx = viewport.portrait ? endY - start.y : endX - start.x;
    const stageDy = viewport.portrait ? -(endX - start.x) : endY - start.y;

    if (Math.abs(stageDx) > 48 && Math.abs(stageDx) > Math.abs(stageDy) * 1.25) {
      if (stageDx < 0) {
        // Swipe left -> next page
        goToIndex(pageIdx + 1);
      } else {
        // Swipe right -> previous page
        goToIndex(pageIdx - 1);
      }
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundEngine.setMuted(!next);
    if (next) soundEngine.playClick();
  };

  const isConnected = deck.status === 'connected';
  const isReconnecting = deck.status === 'reconnecting' || deck.status === 'connecting';

  const tickerItems = useMemo(() => {
    if (!isConnected) {
      return [
        ['#ff5d6c', 'Not connected — tap PAIR MAC to link'],
        ['#22d3ee', 'Swipe left / right to switch pages'],
      ] as Array<[string, string]>;
    }
    const items: Array<[string, string]> = [];
    for (const l of deck.logs.slice(-6)) {
      items.push([
        l.level === 'error'
          ? '#ff5d6c'
          : l.level === 'success'
            ? '#34d399'
            : l.level === 'warn'
              ? '#fbbf24'
              : '#22d3ee',
        l.text.slice(0, 72),
      ]);
    }
    if (items.length === 0) {
      items.push(['#34d399', `${deck.hello?.hostname || 'Mac'} linked`]);
      items.push(['#22d3ee', `Active: ${deck.activeApp.appName}`]);
      items.push(['#fbbf24', `Git: ${deck.gitStatus.repoName} (${deck.gitStatus.branch})`]);
      items.push(['#a78bfa', `Dev ports: ${deck.ports.length}`]);
    }
    return items;
  }, [
    isConnected,
    deck.logs,
    deck.hello?.hostname,
    deck.activeApp.appName,
    deck.gitStatus.repoName,
    deck.gitStatus.branch,
    deck.ports.length,
  ]);

  const flashColor =
    deck.alertFlash?.kind === 'error'
      ? '#ff5d6c'
      : deck.alertFlash?.kind === 'warning'
        ? '#fbbf24'
        : '#34d399';

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="relative shrink-0 overflow-hidden bg-black"
        style={{
          width: viewport.stageW,
          height: viewport.stageH,
          transform: viewport.portrait
            ? `rotate(90deg) scale(${viewport.scale})`
            : `scale(${viewport.scale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Precision edge-to-edge full-screen padding (clears notch cleanly without wasted margins) */}
        <div
          className="flex h-full flex-col gap-1.5"
          style={{
            paddingTop: 5,
            paddingLeft: viewport.portrait
              ? 'max(8px, calc(env(safe-area-inset-top, 0px) * 0.5))'
              : 'max(8px, calc(env(safe-area-inset-left, 0px) * 0.5))',
            paddingRight: viewport.portrait
              ? 'max(8px, calc(env(safe-area-inset-bottom, 0px) * 0.4))'
              : 'max(8px, calc(env(safe-area-inset-right, 0px) * 0.5))',
            paddingBottom: 'max(5px, calc(env(safe-area-inset-bottom, 0px) * 0.35))',
          }}
        >
          {/* Ultra-Slim Single-Line Top Status Bar */}
          <header className="flex h-6 shrink-0 items-center gap-1.5 overflow-hidden text-[9.5px] font-bold">
            <div className="mr-0.5 flex shrink-0 items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt="DevDeck logo"
                className="h-5 w-5 shrink-0 rounded-[5px] border border-[#22d3ee]/40 object-cover shadow-[0_0_8px_rgba(34,211,238,0.35)]"
              />
              <span className="sub whitespace-nowrap !text-[10.5px] !tracking-[0.14em] !text-[#f2f3f7]">
                DevDeck
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setPairingModalOpen(true);
              }}
              className="flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 whitespace-nowrap"
              style={{
                background: isConnected
                  ? 'rgba(52,211,153,.12)'
                  : isReconnecting
                    ? 'rgba(251,191,36,.14)'
                    : 'rgba(255,93,108,.14)',
                color: isConnected ? '#34d399' : isReconnecting ? '#fbbf24' : '#ff5d6c',
              }}
            >
              <span className="relative h-1.5 w-1.5">
                <i
                  className="anim-ping absolute inset-0 rounded-full"
                  style={{
                    background: isConnected ? '#34d399' : isReconnecting ? '#fbbf24' : '#ff5d6c',
                  }}
                />
                <i
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: isConnected ? '#34d399' : isReconnecting ? '#fbbf24' : '#ff5d6c',
                  }}
                />
              </span>
              <span className="max-w-[96px] truncate">
                {isConnected
                  ? deck.hello?.hostname || 'CONNECTED'
                  : isReconnecting
                    ? 'RECONNECTING…'
                    : 'PAIR COMPUTER'}
              </span>
            </button>

            <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2 text-[#f2f3f7]">
              CPU <b className="ml-1">{isConnected ? `${Math.round(deck.stats.cpuPct)}%` : '--'}</b>
            </span>
            <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2 text-[#f2f3f7]">
              RAM{' '}
              <b className="ml-1">
                {isConnected ? `${deck.stats.ramUsedGb.toFixed(1)}G` : '--'}
              </b>
            </span>

            {isConnected && deck.stats.batteryPct !== null && (
              <span
                className="num flex h-5 items-center gap-0.5 rounded-full bg-white/[0.06] px-2"
                style={{
                  color: deck.stats.batteryCharging
                    ? '#34d399'
                    : deck.stats.batteryPct <= 20
                      ? '#ff5d6c'
                      : '#f2f3f7',
                }}
              >
                {deck.stats.batteryCharging ? (
                  <BatteryCharging className="h-3 w-3" />
                ) : (
                  <Battery className="h-3 w-3" />
                )}
                {deck.stats.batteryPct}%
              </span>
            )}

            {deck.focusState.active && (
              <span className="num flex h-5 items-center rounded-full bg-[#fbbf24]/15 px-2 text-[#fbbf24]">
                {formatTimer(deck.focusState.remainingSec)}
              </span>
            )}

            <div className="flex-1" />

            {/* Quick Utility Buttons (Snippets + Sound + Caffeine + Antigravity IDE) */}
            <motion.button
              type="button"
              aria-label="Quick Snippets"
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                soundEngine.playClick();
                setSnippetsOpen(true);
              }}
              className="grid h-5 w-6 place-items-center rounded-full bg-white/[0.06] text-[#22d3ee]"
            >
              <ClipboardList className="h-3 w-3" />
            </motion.button>

            <motion.button
              type="button"
              aria-label="Toggle fullscreen"
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                soundEngine.playClick();
                if (document.fullscreenElement) {
                  void document.exitFullscreen?.().catch(() => {});
                } else {
                  void document.documentElement.requestFullscreen?.().catch(() => {
                    deck.showToast(true, 'On iPhone: tap Share → Add to Home Screen for full screen');
                  });
                }
              }}
              className="grid h-5 w-6 place-items-center rounded-full bg-white/[0.06] text-[#8b90a0] hover:text-white"
            >
              {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </motion.button>

            <motion.button
              type="button"
              aria-label="Toggle sound"
              whileTap={{ scale: 0.9 }}
              onClick={toggleSound}
              className="grid h-5 w-6 place-items-center rounded-full bg-white/[0.06] text-[#8b90a0]"
            >
              {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              title={wakeLock.active ? 'Keep Mac & Screen Awake' : 'Toggle Mac Caffeine'}
              onClick={() => {
                soundEngine.playClick();
                deck.sendEvent({
                  type: 'hardware:caffeine',
                  payload: { requestId: makeRequestId(), active: !deck.caffeineActive },
                });
              }}
              className="flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[9px] font-extrabold whitespace-nowrap"
              style={{
                background: deck.caffeineActive ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.06)',
                color: deck.caffeineActive ? '#fbbf24' : '#8b90a0',
                boxShadow: deck.caffeineActive ? '0 0 12px rgba(251,191,36,.4)' : 'none',
              }}
            >
              <Coffee className="h-[10px] w-[10px] shrink-0" />
              CAFFEINE
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              aria-pressed={activeView === 'antigravity'}
              onClick={() => {
                soundEngine.playClick();
                setAntigravityMode(true);
                goToView('antigravity');
                if (isConnected) {
                  deck.sendEvent({
                    type: 'app:focus',
                    payload: { requestId: makeRequestId(), appName: 'Antigravity IDE' },
                  });
                }
              }}
              className="flex h-5 shrink-0 items-center gap-1 rounded-full px-2.5 text-[9px] font-extrabold whitespace-nowrap text-white"
              style={{
                background:
                  activeView === 'antigravity' || deck.antigravityState.active
                    ? '#2563eb'
                    : '#23252d',
                boxShadow:
                  activeView === 'antigravity' || deck.antigravityState.active
                    ? '0 0 14px #2563eb88'
                    : 'none',
              }}
            >
              <Zap className="h-[10px] w-[10px] shrink-0 fill-current" />
              ANTIGRAVITY IDE
            </motion.button>
          </header>

          {/* Live Antigravity Agent Progress HUD (instant across EVERY page) */}
          <AnimatePresence>
            {deck.agentProgress.active && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex items-center gap-2 rounded-full border border-[#22d3ee]/35 bg-[#08171d] px-3 py-1 text-[10px]"
              >
                <Bot className="h-3 w-3 shrink-0 animate-pulse text-[#22d3ee]" />
                <span className="font-bold text-white">{deck.agentProgress.title}</span>
                <span className="truncate text-zinc-400">{deck.agentProgress.step}</span>
                <div className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#34d399] transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(4, deck.agentProgress.percent))}%` }}
                  />
                </div>
                <span className="num font-extrabold text-[#34d399]">
                  {Math.round(deck.agentProgress.percent)}%
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Smooth Directional Swipe Carousel Canvas */}
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={activeView}
                custom={direction}
                variants={PAGE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.85 }}
                className="h-full w-full"
              >
                {activeView === 'deck' && (
                  <SmartDeckView
                    deck={deck}
                    antigravityPinned={antigravityMode}
                    onNavigateToMonitor={() => goToView('monitor')}
                    onOpenPairing={() => setPairingModalOpen(true)}
                  />
                )}
                {activeView === 'antigravity' && <AntigravityMissionView deck={deck} />}
                {activeView === 'monitor' && <LiveMonitorView deck={deck} />}
                {activeView === 'mac' && (
                  <MacInspectorView
                    deck={deck}
                    onNavigateToMonitor={() => goToView('monitor')}
                  />
                )}
                {activeView === 'hardware' && <HardwareToolsView deck={deck} />}
                {activeView === 'preview' && <PreviewAmbientView deck={deck} />}
                {activeView === 'launch' && <LaunchControlView deck={deck} />}
                {activeView === 'doctor' && <SystemDoctorView deck={deck} />}
                {activeView === 'network' && <NetworkCommandView deck={deck} />}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Bottom Bar: Interactive Swipe Page Dots + Live Dev Log Marquee */}
          <footer className="flex h-6 shrink-0 items-center gap-2">
            {/* Page Switcher Pill (Swipe or Tap Dots / Arrows) */}
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.08] bg-[#101114] px-2 py-0.5">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => goToIndex(pageIdx - 1)}
                className="text-zinc-400 hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <span
                className="min-w-[82px] text-center text-[9.5px] font-extrabold uppercase tracking-wider"
                style={{ color: activePage.accent }}
              >
                {activePage.label}
              </span>

              <div className="flex items-center gap-1 px-1">
                {PAGES.map((p, idx) => {
                  const active = idx === pageIdx;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={`Go to ${p.label}`}
                      onClick={() => goToIndex(idx)}
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: active ? 16 : 6,
                        background: active ? p.accent : 'rgba(255,255,255,0.2)',
                      }}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                aria-label="Next page"
                onClick={() => goToIndex(pageIdx + 1)}
                className="text-zinc-400 hover:text-white"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Live Dev Log Marquee */}
            <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden rounded-full border border-white/[0.07] bg-[#101114]">
              <span className="sub z-10 grid h-full shrink-0 place-items-center whitespace-nowrap border-r border-white/[0.08] bg-[#1a1b22] px-2.5 !text-[8.5px]">
                Dev log
              </span>
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="anim-mq flex whitespace-nowrap text-[10px] font-semibold text-[#f2f3f7]">
                  {[0, 1].map((dup) => (
                    <span key={dup} className="flex">
                      {tickerItems.map(([color, text], i) => (
                        <span key={`${dup}-${i}`} className="flex items-center gap-1.5 px-4">
                          <i className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          {text}
                        </span>
                      ))}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </footer>
        </div>

        {/* Full-frame Edge Glow Pulse */}
        <AnimatePresence>
          {deck.alertFlash && (
            <motion.div
              key={deck.alertFlash.id}
              initial={{ opacity: 0.92 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
              className="pointer-events-none absolute inset-0 z-50"
              style={{
                borderRadius: 24,
                boxShadow: `inset 0 0 0 2px ${flashColor}, inset 0 0 50px ${flashColor}55`,
              }}
            />
          )}
        </AnimatePresence>

        {/* Subtle Action Toast */}
        <AnimatePresence>
          {deck.toast && (
            <motion.div
              key={deck.toast.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-none absolute right-4 bottom-9 z-40 max-w-[340px] truncate rounded-full border px-3 py-1 text-[10px] font-bold shadow-2xl"
              style={{
                background: deck.toast.ok ? '#0b1e16' : '#240c10',
                borderColor: deck.toast.ok ? '#34d39955' : '#ff5d6c66',
                color: deck.toast.ok ? '#34d399' : '#ff5d6c',
              }}
            >
              {deck.toast.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Overlays locked inside the 844x390 landscape stage */}
        <SnippetDrawer
          open={snippetsOpen}
          snippets={deck.config?.snippets ?? []}
          onClose={() => setSnippetsOpen(false)}
          onSend={deck.sendEvent}
        />

        <AgentNotificationBanner
          notification={deck.agentNotification}
          onDismiss={deck.dismissAgentNotification}
          onSend={deck.sendEvent}
        />

        <AgentQuestionOverlay question={deck.agentQuestion} onSend={deck.sendEvent} />

        <PairingOverlay
          open={pairingModalOpen}
          status={deck.status}
          currentPairing={deck.pairing}
          onClose={() => setPairingModalOpen(false)}
          onPairWithPin={deck.pairWithPin}
          onDisconnect={() => {
            deck.clearPairing();
            setPairingModalOpen(false);
          }}
        />
      </div>
    </div>
  );
}
