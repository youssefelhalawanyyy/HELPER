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
  { id: 'preview', label: 'Desk Clock', title: 'Desk Clock', icon: Clock3, accent: '#88f1d1' },
  { id: 'deck', label: 'Deck', title: 'Smart Deck', icon: Grid2X2, accent: '#88f1d1' },
  { id: 'antigravity', label: 'Antigravity', title: 'Antigravity', icon: Bot, accent: '#7dd3fc' },
  { id: 'monitor', label: 'Monitor', title: 'Live Monitor', icon: Activity, accent: '#88f1d1' },
  { id: 'mac', label: 'Mac & Dock', title: 'Mac & Dock', icon: Monitor, accent: '#99f6e4' },
  {
    id: 'hardware',
    label: 'Trackpad & Snap',
    title: 'Trackpad & Snap',
    icon: MousePointer2,
    accent: '#88f1d1',
  },
  { id: 'launch', label: 'Launch', title: 'Launch Control', icon: Rocket, accent: '#fde68a' },
  { id: 'doctor', label: 'PC Doctor', title: 'System Doctor', icon: HeartPulse, accent: '#88f1d1' },
  { id: 'network', label: 'NetOps Pro', title: 'NetOps Pro', icon: Network, accent: '#7dd3fc' },
  { id: 'power', label: 'Power Guard', title: 'Power & Thermal', icon: BatteryCharging, accent: '#88f1d1' },
  { id: 'webtester', label: 'Web Studio', title: 'Web Studio', icon: Globe, accent: '#88f1d1' },
  { id: 'webmonitor', label: 'Web Monitor', title: 'Website Monitor', icon: Radar, accent: '#86efac' },
  { id: 'hosting', label: 'Hosting', title: 'Hosting Dashboard', icon: FolderKanban, accent: '#99f6e4' },
  { id: 'ssh', label: 'SSH & VPS', title: 'SSH Server Manager', icon: Server, accent: '#7dd3fc' },
  { id: 'nour', label: 'نور Voice', title: 'Nour Voice AI', icon: Mic, accent: '#88f1d1' },
] as const;

export type DeckViewId = (typeof PAGES)[number]['id'];

export function Brand() {
  return (
    <span className="console-brand">
      <span aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="DevDeck logo"
          className="h-full w-full rounded-[inherit] object-cover"
        />
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
