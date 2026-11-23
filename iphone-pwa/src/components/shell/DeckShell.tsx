'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { AgentNotificationBanner } from '@/components/shell/AgentNotificationBanner';
import { EdgeGlowOverlay } from '@/components/shell/EdgeGlowOverlay';
import { type DeckViewId, LeftNavRail } from '@/components/shell/LeftNavRail';
import { PairingOverlay } from '@/components/shell/PairingOverlay';
import { SnippetDrawer } from '@/components/shell/SnippetDrawer';
import { TopStatusBar } from '@/components/shell/TopStatusBar';
import { HardwareToolsView } from '@/components/views/HardwareToolsView';
import { LaunchControlView } from '@/components/views/LaunchControlView';
import { LiveMonitorView } from '@/components/views/LiveMonitorView';
import { PreviewAmbientView } from '@/components/views/PreviewAmbientView';
import { SmartDeckView } from '@/components/views/SmartDeckView';
import { useDevDeckSocket } from '@/hooks/useDevDeckSocket';
import { useWakeLock } from '@/hooks/useWakeLock';

export function DeckShell() {
  const deck = useDevDeckSocket();
  const wakeLock = useWakeLock();
  const [activeView, setActiveView] = useState<DeckViewId>('deck');
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);

  const showPairing = pairingModalOpen || deck.status === 'unpaired';

  return (
    <div className="safe-landscape relative flex h-dvh w-screen overflow-hidden bg-black text-zinc-100">
      {/* Slim Left Navigation Rail */}
      <LeftNavRail
        activeView={activeView}
        onSelectView={setActiveView}
        onOpenSnippets={() => setSnippetsOpen(true)}
        webhookCount={deck.webhooks.length}
        uncommittedCount={deck.gitStatus.uncommitted}
      />

      {/* Right Main Column: Ultra-thin Top Status Bar + Active View Canvas */}
      <div className="relative flex min-w-0 flex-1 flex-col bg-black">
        <TopStatusBar
          status={deck.status}
          hostname={deck.hello?.hostname || ''}
          stats={deck.stats}
          activeAppName={deck.activeApp.appName}
          focusState={deck.focusState}
          wakeLockActive={wakeLock.active}
          onOpenPairing={() => setPairingModalOpen(true)}
        />

        {/* Graceful Reconnecting Banner */}
        <AnimatePresence>
          {deck.status === 'reconnecting' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-950/70 px-3 py-1 text-[11px] font-medium text-amber-200"
            >
              <WifiOff className="h-3.5 w-3.5 animate-pulse text-amber-400" />
              <span>Reconnecting to Mac…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active View Surface */}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {activeView === 'deck' && (
            <SmartDeckView deck={deck} onNavigateToMonitor={() => setActiveView('monitor')} />
          )}
          {activeView === 'monitor' && <LiveMonitorView deck={deck} />}
          {activeView === 'launch' && <LaunchControlView deck={deck} />}
          {activeView === 'hardware' && <HardwareToolsView deck={deck} />}
          {activeView === 'preview' && <PreviewAmbientView deck={deck} />}
        </main>

        {/* Subtle Hardware Action Toast */}
        <AnimatePresence>
          {deck.toast && (
            <motion.div
              key={deck.toast.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={`font-mono-tech pointer-events-none fixed right-4 bottom-3 z-30 max-w-[340px] truncate rounded-lg border px-3 py-1.5 text-[11px] shadow-2xl ${
                deck.toast.ok
                  ? 'border-emerald-500/35 bg-[#0D1914]/95 text-emerald-200'
                  : 'border-red-500/40 bg-[#1F0C0C]/95 text-red-200'
              }`}
            >
              {deck.toast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Snippet Injector Slide-Over Drawer */}
      <SnippetDrawer
        open={snippetsOpen}
        snippets={deck.config?.snippets ?? []}
        onClose={() => setSnippetsOpen(false)}
        onSend={deck.sendEvent}
      />

      {/* Full-Screen Build/Alert Edge Glow */}
      <EdgeGlowOverlay alertFlash={deck.alertFlash} />

      {/* Live MCP Agent Notification Banner */}
      <AgentNotificationBanner
        notification={deck.agentNotification}
        onDismiss={deck.dismissAgentNotification}
        onSend={deck.sendEvent}
      />

      {/* Pairing Overlay */}
      <PairingOverlay
        open={showPairing}
        status={deck.status}
        currentPairing={deck.pairing}
        onClose={deck.pairing ? () => setPairingModalOpen(false) : undefined}
        onPairWithPin={deck.pairWithPin}
        onDisconnect={() => {
          deck.clearPairing();
          setPairingModalOpen(false);
        }}
      />
    </div>
  );
}
