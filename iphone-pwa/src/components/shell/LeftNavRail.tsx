'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  BatteryCharging,
  BookOpen,
  Bot,
  Clock3,
  Command,
  FolderKanban,
  Globe,
  Grid2X2,
  HeartPulse,
  Mic,
  Monitor,
  MousePointer2,
  Network,
  Radar,
  Rocket,
  Server,
} from 'lucide-react';

export const PAGES = [
  { id: 'preview', label: 'Desk Clock', title: 'Desk Clock', icon: Clock3, accent: '#aecaf4' },
  { id: 'deck', label: 'Deck', title: 'Smart Deck', icon: Grid2X2, accent: '#ccbaff' },
  { id: 'antigravity', label: 'Antigravity', title: 'Antigravity', icon: Bot, accent: '#96d9ea' },
  { id: 'monitor', label: 'Monitor', title: 'Live Monitor', icon: Activity, accent: '#a5dfbe' },
  { id: 'mac', label: 'Mac & Dock', title: 'Mac & Dock', icon: Monitor, accent: '#b6c5f5' },
  {
    id: 'hardware',
    label: 'Trackpad & Snap',
    title: 'Trackpad & Snap',
    icon: MousePointer2,
    accent: '#f0cc9b',
  },
  { id: 'launch', label: 'Launch', title: 'Launch Control', icon: Rocket, accent: '#edbb9e' },
  { id: 'doctor', label: 'PC Doctor', title: 'System Doctor', icon: HeartPulse, accent: '#efb6c7' },
  { id: 'network', label: 'NetOps Pro', title: 'NetOps Pro', icon: Network, accent: '#9cd5ca' },
  { id: 'power', label: 'Power Guard', title: 'Power & Thermal', icon: BatteryCharging, accent: '#a8e6cf' },
  { id: 'webtester', label: 'Web Studio', title: 'Web Studio', icon: Globe, accent: '#93c5fd' },
  { id: 'webmonitor', label: 'Web Monitor', title: 'Website Monitor', icon: Radar, accent: '#86efac' },
  { id: 'hosting', label: 'Hosting', title: 'Hosting Dashboard', icon: FolderKanban, accent: '#fcd34d' },
  { id: 'ssh', label: 'SSH & VPS', title: 'SSH Server Manager', icon: Server, accent: '#67e8f9' },
  { id: 'nour', label: 'نور Voice', title: 'Nour Voice AI', icon: Mic, accent: '#f9a8d4' },
] as const;

export type DeckViewId = (typeof PAGES)[number]['id'];

export function Brand() {
  return (
    <span className="console-brand">
      <span aria-hidden="true">
        <Command size={20} strokeWidth={2.4} />
      </span>
      DevDeck
    </span>
  );
}

export function LeftNavRail({
  index,
  onSelect,
  inert,
}: {
  index: number;
  onSelect: (index: number) => void;
  inert: boolean;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [index]);

  return (
    <aside inert={inert} className="console-rail" data-no-swipe="true">
      <div className="rail-brand">
        <Brand />
      </div>
      <nav className="console-nav" aria-label="Workspace screens">
        {PAGES.map(({ id, label, title, icon: Icon }, i) => (
          <button
            type="button"
            key={id}
            ref={i === index ? selected : undefined}
            aria-label={`Go to ${label}`}
            aria-current={i === index ? 'page' : undefined}
            title={title}
            onClick={() => onSelect(i)}
          >
            <Icon size={18} strokeWidth={1.7} />
            <span>{title}</span>
          </button>
        ))}
      </nav>
      <Link className="rail-setup" href="/setup">
        <BookOpen size={16} />
        Setup guide
        <ArrowUpRight size={14} />
      </Link>
    </aside>
  );
}
