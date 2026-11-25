'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
import { Brand, LeftNavRail, PAGES, type DeckViewId } from './LeftNavRail';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import {
  Battery,
  BatteryCharging,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coffee,
  Maximize2,
  Mic,
  Minimize2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { AgentNotificationBanner } from '@/components/shell/AgentNotificationBanner';
import { AgentQuestionOverlay } from '@/components/shell/AgentQuestionOverlay';
import { useDeskBreak } from '@/hooks/useDeskBreak';
import { PreviewAmbientView } from '@/components/views/PreviewAmbientView';
import { SmartDeckView } from '@/components/views/SmartDeckView';
import { useDevDeckSocket } from '@/hooks/useDevDeckSocket';
import { useNourVoice } from '@/hooks/useNourVoice';
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
const PowerThermalView = dynamic(
  () => import('@/components/views/PowerThermalView').then((m) => m.PowerThermalView),
  { loading: ViewSkeleton },
);
const PerfStudioView = dynamic(
  () => import('@/components/views/PerfStudioView').then((m) => m.PerfStudioView),
  { loading: ViewSkeleton },
);
const FilesHubView = dynamic(
  () => import('@/components/views/FilesHubView').then((m) => m.FilesHubView),
  { loading: ViewSkeleton },
);
const WebsiteTesterView = dynamic(
  () => import('@/components/views/WebsiteTesterView').then((m) => m.WebsiteTesterView),
  { loading: ViewSkeleton },
);
const WebsiteMonitorView = dynamic(
  () => import('@/components/views/WebsiteMonitorView').then((m) => m.WebsiteMonitorView),
  { loading: ViewSkeleton },
);
const HostingDashboardView = dynamic(
  () => import('@/components/views/HostingDashboardView').then((m) => m.HostingDashboardView),
  { loading: ViewSkeleton },
);
const SshManagerView = dynamic(
  () => import('@/components/views/SshManagerView').then((m) => m.SshManagerView),
  { loading: ViewSkeleton },
);
const NourVoiceView = dynamic(
  () => import('@/components/views/NourVoiceView').then((m) => m.NourVoiceView),
  { loading: ViewSkeleton },
);

const PAGE_VARIANTS = {
  enter: (dir: number) => ({
    x: dir > 0 ? 12 : -12,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -12 : 12,
    opacity: 0,
  }),
};

export function DeckShell() {
  const deck = useDevDeckSocket();
  const { triggerFlash, showToast } = deck;
  const onBreakComplete = useCallback(() => {
    triggerFlash('success', 'Break timer complete');
    showToast(true, 'Break timer complete');
  }, [triggerFlash, showToast]);
  const deskBreak = useDeskBreak(onBreakComplete);
  const wakeLock = useWakeLock();
  const [pageIdx, setPageIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [pcMenuOpen, setPcMenuOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [antigravityMode, setAntigravityMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const reduceMotion = useReducedMotion();
  const overlayOpen = pairingModalOpen || snippetsOpen || Boolean(deck.agentQuestion);
  const swipeStartRef = useRef<{ x: number; y: number; blocked: boolean } | null>(null);

  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    const idx = PAGES.findIndex((p) => p.id === view);
    if (idx >= 0) setPageIdx(idx);
  }, []);
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

  // Persistent Nour Voice AI session — stays alive while swiping across ALL pages!
  const nour = useNourVoice(deck, goToView);

  // Secondary views load on-demand via next/dynamic and cache automatically — zero upfront CPU burst on launch!

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || pairingModalOpen || snippetsOpen || deck.agentQuestion) return;
    const target = e.target as HTMLElement | null;
    const blocked = Boolean(
      target?.closest(
        '[data-no-swipe="true"], input, textarea, select, iframe, dialog, [role="slider"]',
      ),
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

    const stageDx = e.changedTouches[0].clientX - start.x;
    const stageDy = e.changedTouches[0].clientY - start.y;

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
    <MotionConfig reducedMotion="user">
      <div
        className="console-shell"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ '--page-accent': activePage.accent } as CSSProperties}
      >
        <LeftNavRail index={pageIdx} onSelect={goToIndex} inert={overlayOpen} />
        <div className="console-main" inert={overlayOpen}>
          <header className="console-topbar" data-no-swipe="true">
            <div className="console-status">
              <span className="mobile-brand">
                <Brand />
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    if (deck.savedPcs.length > 0) setPcMenuOpen((v) => !v);
                    else setPairingModalOpen(true);
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
                        ? 'Reconnecting…'
                        : 'Pair computer'}
                  </span>
                  {deck.savedPcs.length > 1 && <span className="text-[9px] opacity-75">▾</span>}
                </button>

                {/* Multi-PC 1-Tap Switcher Popover */}
                {pcMenuOpen && (
                  <div className="fixed top-12 left-4 z-50 w-64 rounded-2xl border border-[#98c8ce33] bg-[#0b1820] p-2 shadow-2xl">
                    <div className="mb-1.5 flex items-center justify-between px-2 text-[9px] font-extrabold text-[#9cb4bb] uppercase">
                      <span>Saved Computers ({deck.savedPcs.length})</span>
                      <button
                        type="button"
                        onClick={() => setPcMenuOpen(false)}
                        className="text-zinc-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-1">
                      {deck.savedPcs.map((pc) => {
                        const isCurrent =
                          deck.pairing?.host === pc.host && deck.pairing?.port === pc.port;
                        return (
                          <div
                            key={`${pc.host}:${pc.port}`}
                            className="flex items-center justify-between gap-1 rounded-xl border px-2 py-1.5"
                            style={{
                              borderColor: isCurrent
                                ? 'rgba(136,241,209,0.45)'
                                : 'rgba(255,255,255,0.06)',
                              background: isCurrent
                                ? 'rgba(136,241,209,0.12)'
                                : 'rgba(255,255,255,0.03)',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                soundEngine.playClick();
                                deck.savePairing(pc);
                                setPcMenuOpen(false);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="truncate text-[11px] font-extrabold text-white">
                                {pc.platform === 'win32' ? '🪟 ' : '🍎 '}
                                {pc.label || pc.host}
                              </div>
                              <div className="font-mono-tech truncate text-[9px] text-[#9cb4bb]">
                                {pc.host}
                              </div>
                            </button>
                            {!isCurrent && (
                              <button
                                type="button"
                                onClick={() => deck.removeSavedPc(pc.host, pc.port)}
                                className="rounded px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-[#ff5d6c]"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPcMenuOpen(false);
                        setPairingModalOpen(true);
                      }}
                      className="mt-2 w-full rounded-xl bg-[#88f1d1] py-1.5 text-[10px] font-extrabold text-[#061c17]"
                    >
                      + Pair New Mac / Windows PC
                    </button>
                  </div>
                )}
              </div>

              <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2 text-[#f2f3f7]">
                CPU{' '}
                <b className="ml-1">{isConnected ? `${Math.round(deck.stats.cpuPct)}%` : '--'}</b>
              </span>
              {isConnected && deck.powerState.cpuTempC !== null && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    goToView('power');
                  }}
                  title="CPU Silicon Die Temperature (tap for Power Guard)"
                  className="num flex h-5 items-center gap-1 rounded-full bg-white/[0.06] px-2 font-extrabold"
                  style={{
                    color:
                      deck.powerState.cpuTempC >= deck.powerState.overheatTempC
                        ? '#ff5d6c'
                        : deck.powerState.cpuTempC >= Math.max(58, deck.powerState.overheatTempC - 13)
                          ? '#fbbf24'
                          : '#34d399',
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background:
                        deck.powerState.cpuTempC >= deck.powerState.overheatTempC
                          ? '#ff5d6c'
                          : deck.powerState.cpuTempC >= Math.max(58, deck.powerState.overheatTempC - 13)
                            ? '#fbbf24'
                            : '#34d399',
                    }}
                  />
                  {deck.powerState.cpuTempC.toFixed(1)}°C
                </button>
              )}
              <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2 text-[#f2f3f7]">
                RAM{' '}
                <b className="ml-1">{isConnected ? `${deck.stats.ramUsedGb.toFixed(1)}G` : '--'}</b>
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
            </div>
            <div className="console-utilities" role="group" aria-label="Quick controls">
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
                aria-pressed={isFullscreen}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  soundEngine.playClick();
                  if (document.fullscreenElement) {
                    void document.exitFullscreen?.().catch(() => {});
                  } else {
                    void document.documentElement.requestFullscreen?.().catch(() => {
                      deck.showToast(
                        true,
                        'On iPhone: tap Share → Add to Home Screen for full screen',
                      );
                    });
                  }
                }}
                className="grid h-5 w-6 place-items-center rounded-full bg-white/[0.06] text-[#8b90a0] hover:text-white"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
              </motion.button>

              <motion.button
                type="button"
                aria-label="Toggle sound"
                aria-pressed={soundOn}
                whileTap={{ scale: 0.9 }}
                onClick={toggleSound}
                className="grid h-5 w-6 place-items-center rounded-full bg-white/[0.06] text-[#8b90a0]"
              >
                {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                aria-pressed={deck.caffeineActive}
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
                Caffeine
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                aria-pressed={activeView === 'nour' || nour.liveCallOn || nour.wakeWordOn}
                title={
                  nour.liveCallOn
                    ? 'Nour Live Call Active — tap to open'
                    : nour.wakeWordOn
                      ? 'Nour Wake Word Active — say «يا نور»'
                      : 'Talk to Nour (Egyptian Arabic Voice AI)'
                }
                onClick={() => {
                  soundEngine.playClick();
                  goToView('nour');
                }}
                className="flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[9px] font-extrabold whitespace-nowrap"
                style={{
                  background:
                    nour.liveCallOn || nour.phase === 'speaking' || nour.phase === 'listening'
                      ? 'rgba(244,114,182,0.34)'
                      : activeView === 'nour'
                        ? 'rgba(244,114,182,0.24)'
                        : 'rgba(244,114,182,0.12)',
                  color: '#f9a8d4',
                  boxShadow:
                    nour.liveCallOn || nour.phase === 'speaking' || nour.phase === 'listening'
                      ? '0 0 14px rgba(244,114,182,.6)'
                      : 'none',
                }}
              >
                {(nour.liveCallOn || nour.wakeWordOn || nour.phase !== 'idle') && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                    style={{
                      background:
                        nour.phase === 'listening'
                          ? '#22d3ee'
                          : nour.phase === 'speaking'
                            ? '#f472b6'
                            : '#34d399',
                    }}
                  />
                )}
                <Mic className="h-[10px] w-[10px] shrink-0" />
                {nour.liveCallOn ? `${nour.botName} LIVE` : nour.botName}
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
                className="flex h-5 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[9px] font-extrabold whitespace-nowrap"
                style={{
                  background:
                    activeView === 'antigravity' || deck.antigravityState.active
                      ? '#88f1d1'
                      : '#bcfff20d',
                  borderColor:
                    activeView === 'antigravity' || deck.antigravityState.active
                      ? '#88f1d1'
                      : '#b3e5df36',
                  color:
                    activeView === 'antigravity' || deck.antigravityState.active
                      ? '#08221c'
                      : '#effaf7',
                }}
              >
                <Zap className="h-[10px] w-[10px] shrink-0 fill-current" />
                Antigravity IDE
              </motion.button>
            </div>
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
          <main className="console-canvas">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={activeView}
                custom={direction}
                variants={PAGE_VARIANTS}
                initial={reduceMotion ? false : 'enter'}
                animate="center"
                exit="exit"
                transition={
                  reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }
                }
                className="console-view"
                data-screen={activeView}
              >
                {activeView !== 'deck' && activeView !== 'preview' && (
                  <header className="screen-masthead">
                    <div className="masthead-copy">
                      <activePage.icon size={22} aria-hidden="true" />
                      <h1>{activePage.title}</h1>
                    </div>
                    <div className="masthead-art" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  </header>
                )}
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
                  <MacInspectorView deck={deck} onNavigateToMonitor={() => goToView('monitor')} />
                )}
                {activeView === 'hardware' && <HardwareToolsView deck={deck} />}
                {activeView === 'preview' && <PreviewAmbientView deck={deck} deskBreak={deskBreak} onPair={() => setPairingModalOpen(true)} />}
                {activeView === 'launch' && <LaunchControlView deck={deck} />}
                {activeView === 'doctor' && <SystemDoctorView deck={deck} />}
                {activeView === 'network' && <NetworkCommandView deck={deck} />}
                {activeView === 'power' && <PowerThermalView deck={deck} />}
                {activeView === 'perf' && <PerfStudioView deck={deck} />}
                {activeView === 'files' && <FilesHubView deck={deck} />}
                {activeView === 'webtester' && <WebsiteTesterView deck={deck} />}
                {activeView === 'webmonitor' && <WebsiteMonitorView deck={deck} />}
                {activeView === 'hosting' && <HostingDashboardView deck={deck} />}
                {activeView === 'ssh' && <SshManagerView deck={deck} />}
                {activeView === 'nour' && <NourVoiceView nour={nour} />}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Bottom Bar: Interactive Swipe Page Dots + Live Dev Log Marquee */}
          <footer className="console-footer">
            {/* Page Switcher Pill (Swipe or Tap Dots / Arrows) */}
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#98c8ce29] bg-[#0d1921] px-2 py-0.5">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => goToIndex(pageIdx - 1)}
                className="text-[#9cb4bb] hover:text-[#effaf7]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <span
                className="min-w-[82px] text-center text-[9.5px] font-extrabold uppercase tracking-wider"
                style={{ color: '#88f1d1' }}
              >
                {activePage.label}
              </span>

              <button
                type="button"
                aria-label="Next page"
                onClick={() => goToIndex(pageIdx + 1)}
                className="text-[#9cb4bb] hover:text-[#effaf7]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Live Dev Log Marquee */}
            <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden rounded-full border border-[#98c8ce29] bg-[#0d1921]">
              <span className="sub z-10 grid h-full shrink-0 place-items-center whitespace-nowrap border-r border-[#98c8ce26] bg-[#11222c] px-2.5 !text-[8.5px]">
                Dev log
              </span>
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="anim-mq flex whitespace-nowrap text-[10px] font-semibold text-[#effaf7]">
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
              role="status"
              className="console-toast pointer-events-none absolute right-4 bottom-9 z-40 max-w-[340px] truncate rounded-full border px-3 py-1 text-[10px] font-bold shadow-2xl"
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
    </MotionConfig>
  );
}
