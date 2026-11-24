'use client';

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

export function GlowRing({ value, color, label }: { value: number; color: string; label: string }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-[92px] w-[92px]">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" stroke="#23252d" strokeWidth="7" />
        <motion.circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          animate={{ strokeDashoffset: C * (1 - clamped / 100) }}
          transition={{ type: 'spring', stiffness: 55 }}
          style={{ filter: `drop-shadow(0 0 5px ${color}99)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-[20px] font-extrabold leading-none text-[#f2f3f7]">
            {Math.round(clamped)}
          </div>
          <div className="sub mt-0.5">{label}</div>
        </div>
      </div>
    </div>
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
      className="relative cursor-grab touch-none overflow-clip"
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
          bump();
          onChange(Math.min(100, value + 5), 5);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          bump();
          onChange(Math.max(0, value - 5), -5);
        }
      }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-[225deg]">
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="#23252d"
          strokeWidth="5"
          strokeDasharray="217 289"
          strokeLinecap="round"
        />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={accent}
          strokeWidth="5"
          strokeDasharray={`${Math.max(0, Math.min(100, value)) * 2.17} 400`}
          strokeLinecap="round"
        />
      </svg>

      <motion.div
        className="absolute inset-[14px] rounded-full"
        animate={{ rotate: value * 2.7 - 135 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        style={{
          background: 'conic-gradient(from 0deg,#2b2d35,#4a4d58,#2b2d35,#4a4d58,#2b2d35)',
          boxShadow: '0 4px 0 #000, inset 0 1px 0 rgba(255,255,255,.25)',
        }}
      >
        <i
          className="absolute top-1.5 left-1/2 h-3 w-1 -translate-x-1/2 rounded"
          style={{ background: accent }}
        />
      </motion.div>

      <div
        className="num pointer-events-none absolute inset-0 grid place-items-center text-[20px] font-extrabold text-[#f2f3f7]"
        style={{ textShadow: '0 1px 3px #000' }}
      >
        <span>
          {Math.round(value)}
          <span className="text-[10px] opacity-60">%</span>
        </span>
      </div>
    </div>
  );
}
