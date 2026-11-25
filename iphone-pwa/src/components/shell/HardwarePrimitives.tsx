'use client';

import { InstrumentGauge } from '@/components/shell/InstrumentGauge';

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { soundEngine } from '@/lib/soundEngine';

export const DECK_SPRING = { type: 'spring' as const, stiffness: 420, damping: 22 };

export function Burst({ color, n = 18, r = 70 }: { color: string; n?: number; r?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      {Array.from({ length: n }).map((_, i) => {
        const a = (i / n) * Math.PI * 2;
        const d = r * (0.5 + (i % 3) * 0.3);
        return (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

export function HardwareTile({
  accent,
  title,
  sub,
  icon,
  active = false,
  onClick,
  onPointerDown,
  onPointerUp,
  children,
  ariaLabel,
  className = '',
}: {
  accent: string;
  title: string;
  sub: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  children?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel || title.replace(/\n/g, ' ')}
      whileTap={{ scale: 0.965 }}
      whileHover={{ y: -2 }}
      transition={DECK_SPRING}
      onClick={() => {
        soundEngine.playClick();
        onClick?.();
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className={`tile flex h-full w-full flex-col p-3.5 ${className}`}
      style={
        active
          ? {
              borderColor: accent,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 1px ${accent}55, 0 0 30px -6px ${accent}88`,
            }
          : undefined
      }
    >
      {/* Signature L-shaped top/left neon accent bar */}
      <div
        className="absolute top-0 left-0 h-[3px] rounded-r-full transition-all duration-500"
        style={{ width: active ? '100%' : '48%', background: accent }}
      />
      <div
        className="absolute top-0 left-0 h-1/2 w-[3px] rounded-b-full"
        style={{ background: `linear-gradient(${accent}, transparent)` }}
      />

      <div className="flex w-full items-start justify-between">
        <div className="disp whitespace-pre-line text-[32px] text-[#f2f3f7]">{title}</div>
        <motion.span
          style={{ color: accent }}
          animate={active ? { scale: [1, 1.2, 1] } : {}}
          transition={{ repeat: active ? Infinity : 0, duration: 1.4 }}
        >
          {icon}
        </motion.span>
      </div>

      <div className="flex w-full flex-1 items-center">{children}</div>

      <div className="sub truncate" style={{ color: active ? accent : undefined }}>
        {sub}
      </div>
    </motion.button>
  );
}

export function BrushedDial({
  value,
  onChange,
  accent = '#fbbf24',
  size = 112,
  label = 'Mac dial',
}: {
  value: number;
  onChange: (nextVal: number, delta: number) => void;
  accent?: string;
  size?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastAngRef = useRef<number | null>(null);
  const lastSoundRef = useRef(0);

  const getAngle = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * (180 / Math.PI);
  };

  const bump = () => {
    if (Date.now() - lastSoundRef.current > 55) {
      soundEngine.playDetent();
      lastSoundRef.current = Date.now();
    }
  };

  return (
    <div
      ref={ref}
      data-no-swipe="true"
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      style={{ width: size, height: size }}
      className="relative grid cursor-grab touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        lastAngRef.current = getAngle(e);
      }}
      onPointerMove={(e) => {
        if (lastAngRef.current === null || !ref.current) return;
        const cur = getAngle(e);
        let d = cur - lastAngRef.current;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        lastAngRef.current = cur;
        const step = d / 2.7;
        const next = Math.max(0, Math.min(100, value + step));
        bump();
        onChange(next, step);
      }}
      onPointerUp={() => {
        lastAngRef.current = null;
      }}
      onPointerCancel={() => {
        lastAngRef.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          bump();
          onChange(Math.min(100, value + 5), 5);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          bump();
          onChange(Math.max(0, value - 5), -5);
        }
      }}
    >
      <InstrumentGauge
        mode="dial"
        decorative
        hideOuterLabel
        label={label.replace(/^Mac | dial$/g, '')}
        value={value}
        accent={accent}
      />
    </div>
  );
}
