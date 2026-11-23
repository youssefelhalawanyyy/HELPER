'use client';

import { motion } from 'framer-motion';
import {
  Activity,
  ClipboardList,
  Grid2X2,
  MonitorSmartphone,
  Rocket,
  Sliders,
} from 'lucide-react';
import { soundEngine } from '@/lib/soundEngine';

export type DeckViewId = 'deck' | 'monitor' | 'launch' | 'hardware' | 'preview';

interface LeftNavRailProps {
  activeView: DeckViewId;
  onSelectView: (view: DeckViewId) => void;
  onOpenSnippets: () => void;
  webhookCount: number;
  uncommittedCount: number;
}

const NAV_ITEMS: Array<{ id: DeckViewId; label: string; icon: typeof Grid2X2; accent: string }> = [
  { id: 'deck', label: 'Smart Deck', icon: Grid2X2, accent: 'text-cyan-400' },
  { id: 'monitor', label: 'Live Monitor', icon: Activity, accent: 'text-emerald-400' },
  { id: 'launch', label: 'Launch Control', icon: Rocket, accent: 'text-amber-400' },
  { id: 'hardware', label: 'Hardware Tools', icon: Sliders, accent: 'text-violet-400' },
  { id: 'preview', label: 'Preview & Ambient', icon: MonitorSmartphone, accent: 'text-sky-400' },
];

export function LeftNavRail({
  activeView,
  onSelectView,
  onOpenSnippets,
  webhookCount,
  uncommittedCount,
}: LeftNavRailProps) {
  return (
    <nav
      aria-label="Primary Deck Navigation"
      className="flex h-full w-[58px] shrink-0 flex-col items-center justify-between border-r border-white/[0.08] bg-[#08080A] py-2"
    >
      <div className="flex flex-col items-center gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const badge =
            item.id === 'launch' && (uncommittedCount > 0 || webhookCount > 0)
              ? uncommittedCount || webhookCount
              : 0;

          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                soundEngine.playClick();
                onSelectView(item.id);
              }}
              aria-label={item.label}
              title={item.label}
              className={`relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${
                isActive
                  ? 'border-white/20 bg-[#18181D] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                  : 'border-transparent bg-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="rail-active-pill"
                  className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-cyan-400 shadow-[0_0_8px_#06B6D4]"
                />
              )}
              <Icon className={`h-5 w-5 ${isActive ? item.accent : ''}`} />
              {badge > 0 && (
                <span className="font-mono-tech absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-black">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Quick Snippet Injector Drawer Trigger */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          soundEngine.playClick();
          onOpenSnippets();
        }}
        aria-label="Quick Snippet Injector"
        title="Quick Snippet Injector"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-400 transition-colors hover:bg-cyan-500/20"
      >
        <ClipboardList className="h-4 w-4" />
      </motion.button>
    </nav>
  );
}
