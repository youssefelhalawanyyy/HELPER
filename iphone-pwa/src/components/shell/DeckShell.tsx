'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ClipboardList,
  Home,
  Link2,
  MonitorSmartphone,
  Rocket,
  Sliders,
  Smartphone,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { AgentNotificationBanner } from '@/components/shell/AgentNotificationBanner';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import { PairingOverlay } from '@/components/shell/PairingOverlay';
import { SnippetDrawer } from '@/components/shell/SnippetDrawer';
import { HardwareToolsView } from '@/components/views/HardwareToolsView';
import { LaunchControlView } from '@/components/views/LaunchControlView';
import { LiveMonitorView } from '@/components/views/LiveMonitorView';
import { PreviewAmbientView } from '@/components/views/PreviewAmbientView';
import { SmartDeckView } from '@/components/views/SmartDeckView';
import { useDevDeckSocket } from '@/hooks/useDevDeckSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { formatTimer } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export type DeckViewId = 'deck' | 'monitor' | 'launch' | 'hardware' | 'preview';

const DEFAULT_TICKER: Array<[string, string]> = [
  ['#34d399', 'DevDeck OLED hardware mode ready'],
  ['#22d3ee', 'Local Wi-Fi WebSocket bridge on :4747'],
  ['#fbbf24', 'Antigravity MCP notify_iphone armed'],
  ['#60a5fa', 'Voice-to-Mac auto-paste online'],
  ['#a78bfa', 'Auto-switching macOS app profiles'],
];

const NAV_ITEMS: Array<{ id: DeckViewId; label: string; icon: typeof Home }> = [
  { id: 'deck', label: 'Deck', icon: Home },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'launch', label: 'Launch', icon: Rocket },
  { id: 'hardware', label: 'Hardware', icon: Sliders },
  { id: 'preview', label: 'Ambient', icon: MonitorSmartphone },
];

export function DeckShell() {
  const deck = useDevDeckSocket();
  const wakeLock = useWakeLock();
  const [activeView, setActiveView] = useState<DeckViewId>('deck');
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [antigravityMode, setAntigravityMode] = useState(true);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / 844, window.innerHeight / 390));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundEngine.setMuted(!next);
    if (next) soundEngine.playClick();
  };

  const tickerItems = useMemo(() => {
    if (deck.logs.length > 0) {
      return deck.logs.slice(-8).map((l): [string, string] => [
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
    return DEFAULT_TICKER;
  }, [deck.logs]);

  const isConnected = deck.status === 'connected';
  const isReconnecting = deck.status === 'reconnecting' || deck.status === 'connecting';
  const flashColor =
    deck.alertFlash?.kind === 'error'
      ? '#ff5d6c'
      : deck.alertFlash?.kind === 'warning'
        ? '#fbbf24'
        : '#34d399';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div style={{ width: 844 * scale, height: 390 * scale }}>
        <div
          className="relative overflow-hidden bg-black"
          style={{
            width: 844,
            height: 390,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <div className="flex h-full">
            {/* Slim 50px Left Navigation Rail */}
            <nav
              aria-label="Screens"
              className="flex w-[50px] shrink-0 flex-col items-center gap-1.5 py-2.5"
            >
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                const selected = activeView === id;
                return (
                  <motion.button
                    key={id}
                    type="button"
                    aria-label={label}
                    title={label}
                    whileTap={{ scale: 0.85 }}
                    transition={DECK_SPRING}
                    onClick={() => {
                      soundEngine.playClick();
                      setActiveView(id);
                    }}
                    className="relative grid h-9 w-9 place-items-center rounded-xl transition-colors"
                    style={{
                      color: selected ? '#ffffff' : '#6b7080',
                      background: selected ? '#1d1e24' : 'transparent',
                    }}
                  >
                    {selected && (
                      <motion.i
                        layoutId="rail-pip"
                        className="absolute top-2 bottom-2 -left-[7px] w-[3px] rounded-full bg-[#34d399]"
                      />
                    )}
                    <Icon className="h-[17px] w-[17px]" />
                  </motion.button>
                );
              })}

              <div className="flex-1" />

              <motion.button
                type="button"
                aria-label="Quick Snippets"
                title="Quick Snippets"
                whileTap={{ scale: 0.85 }}
                onClick={() => {
                  soundEngine.playClick();
                  setSnippetsOpen(true);
                }}
                className="grid h-8 w-8 place-items-center rounded-xl text-[#22d3ee] hover:bg-white/[0.06]"
              >
                <ClipboardList className="h-[15px] w-[15px]" />
              </motion.button>

              <motion.button
                type="button"
                aria-label="Toggle sound"
                whileTap={{ scale: 0.85 }}
                onClick={toggleSound}
                className="grid h-8 w-8 place-items-center text-[#6b7080] hover:text-white"
              >
                {soundOn ? <Volume2 className="h-[15px] w-[15px]" /> : <VolumeX className="h-[15px] w-[15px]" />}
              </motion.button>

              <motion.button
                type="button"
                aria-label="Pair Mac"
                title="Pair Mac"
                whileTap={{ scale: 0.85 }}
                onClick={() => {
                  soundEngine.playClick();
                  setPairingModalOpen(true);
                }}
                className="grid h-8 w-8 place-items-center text-[#6b7080] hover:text-[#34d399]"
              >
                <Link2 className="h-[15px] w-[15px]" />
              </motion.button>
            </nav>

            {/* Right Main Column */}
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-2 pr-2.5">
              {/* Ultra-Slim Top Bar */}
              <header className="flex h-6 shrink-0 items-center gap-2 text-[10px] font-bold">
                <span className="sub mr-1 !text-[11px] !tracking-[0.14em] !text-[#f2f3f7]">
                  DevDeck
                </span>

                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setPairingModalOpen(true);
                  }}
                  className="flex h-5 items-center gap-1.5 rounded-full px-2.5"
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
                  <span>
                    {isConnected
                      ? 'CONNECTED'
                      : isReconnecting
                        ? 'RECONNECTING…'
                        : 'PAIR MAC'}
                  </span>
                </button>

                <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2.5 text-[#f2f3f7]">
                  CPU <b className="ml-1">{Math.round(deck.stats.cpuPct)}%</b>
                </span>
                <span className="num flex h-5 items-center rounded-full bg-white/[0.06] px-2.5 text-[#f2f3f7]">
                  RAM <b className="ml-1">{deck.stats.ramUsedGb.toFixed(1)}GB</b>
                </span>

                {deck.focusState.active && (
                  <span className="num flex h-5 items-center rounded-full bg-[#fbbf24]/15 px-2.5 text-[#fbbf24]">
                    FOCUS {formatTimer(deck.focusState.remainingSec)}
                  </span>
                )}

                <div className="flex-1" />

                <span className="flex items-center gap-1 text-[#fbbf24]">
                  <Smartphone className="h-[11px] w-[11px]" />
                  {wakeLock.active ? 'Screen wake on' : 'Wake ready'}
                </span>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  aria-pressed={antigravityMode}
                  onClick={() => {
                    soundEngine.playClick();
                    setAntigravityMode((v) => !v);
                    setActiveView('deck');
                  }}
                  className="flex h-5 items-center gap-1 rounded-full px-3 text-white"
                  style={{
                    background: antigravityMode ? '#2563eb' : '#23252d',
                    boxShadow: antigravityMode ? '0 0 14px #2563eb88' : 'none',
                  }}
                >
                  <Zap className="h-[10px] w-[10px] fill-current" />
                  ANTIGRAVITY
                </motion.button>
              </header>

              {/* Main Interactive Canvas */}
              <main className="relative min-h-0 flex-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeView}
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.16 }}
                    className="h-full"
                  >
                    {activeView === 'deck' && (
                      <SmartDeckView
                        deck={deck}
                        antigravityPinned={antigravityMode}
                        onNavigateToMonitor={() => setActiveView('monitor')}
                      />
                    )}
                    {activeView === 'monitor' && <LiveMonitorView deck={deck} />}
                    {activeView === 'launch' && <LaunchControlView deck={deck} />}
                    {activeView === 'hardware' && <HardwareToolsView deck={deck} />}
                    {activeView === 'preview' && <PreviewAmbientView deck={deck} />}
                  </motion.div>
                </AnimatePresence>
              </main>

              {/* Bottom Live Dev Log Marquee Ticker */}
              <footer className="flex h-5 shrink-0 items-center overflow-hidden rounded-full border border-white/[0.07] bg-[#101114]">
                <span className="sub z-10 grid h-full place-items-center bg-white/[0.06] px-2.5 !text-[8.5px]">
                  Dev log
                </span>
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
              </footer>
            </div>
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
                className="pointer-events-none absolute right-3 bottom-8 z-40 max-w-[320px] truncate rounded-full border px-3 py-1 text-[10px] font-bold shadow-2xl"
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
        </div>
      </div>

      {/* Quick Snippet Injector Slide-Over Drawer */}
      <SnippetDrawer
        open={snippetsOpen}
        snippets={deck.config?.snippets ?? []}
        onClose={() => setSnippetsOpen(false)}
        onSend={deck.sendEvent}
      />

      {/* Live MCP Agent Notification Card */}
      <AgentNotificationBanner
        notification={deck.agentNotification}
        onDismiss={deck.dismissAgentNotification}
        onSend={deck.sendEvent}
      />

      {/* On-Demand Pairing Overlay */}
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
  );
}
