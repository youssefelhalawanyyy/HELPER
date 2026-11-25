'use client';

import { useId, useRef } from 'react';
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

/**
 * Studio-Grade 3D Machined Hardware Rotary Potentiometer:
 * - 270° sweep (-135° MIN to +135° MAX)
 * - 25 illuminated perimeter LED step segments + engraved 0/25/50/75/100 scale
 * - Anodized knurled aluminum rotary cap with 24 machined grip teeth & glowing laser indicator notch
 * - Supports both circular rotary drag AND vertical studio-mixer drag + keyboard arrow detents
 */
export function BrushedDial({
  value,
  onChange,
  accent = '#fbbf24',
  size = 116,
  label = 'Mac potentiometer',
  unit = '%',
  sublabel,
  muted = false,
}: {
  value: number;
  onChange: (nextVal: number, delta: number) => void;
  accent?: string;
  size?: number;
  label?: string;
  unit?: string;
  sublabel?: string;
  muted?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ref = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ lastAng: number; lastY: number; val: number } | null>(null);
  const lastSoundRef = useRef(0);

  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const frac = clamped / 100;
  const SWEEP = 270; // -135° to +135°
  const knobDeg = frac * SWEEP - SWEEP / 2;
  const activeColor = muted ? '#ff5d6c' : accent;

  const getAngle = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.atan2(clientY - r.top - r.height / 2, clientX - r.left - r.width / 2) * (180 / Math.PI);
  };

  const bump = () => {
    if (Date.now() - lastSoundRef.current > 48) {
      soundEngine.playDetent();
      lastSoundRef.current = Date.now();
    }
  };

  const polar = (f: number, radius: number) => {
    const rad = ((f * SWEEP - SWEEP / 2) * Math.PI) / 180;
    return {
      x: Math.round((70 + radius * Math.sin(rad)) * 100) / 100,
      y: Math.round((70 - radius * Math.cos(rad)) * 100) / 100,
    };
  };

  const LED_COUNT = 25;

  return (
    <div
      ref={ref}
      data-no-swipe="true"
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      style={{ width: size, height: size }}
      className="relative grid cursor-grab touch-none select-none place-items-center rounded-full active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStateRef.current = {
          lastAng: getAngle(e.clientX, e.clientY),
          lastY: e.clientY,
          val: clamped,
        };
      }}
      onPointerMove={(e) => {
        const st = dragStateRef.current;
        if (!st || !ref.current) return;
        const curAng = getAngle(e.clientX, e.clientY);
        let dAng = curAng - st.lastAng;
        if (dAng > 180) dAng -= 360;
        if (dAng < -180) dAng += 360;
        const dY = st.lastY - e.clientY;
        st.lastAng = curAng;
        st.lastY = e.clientY;

        // Combine circular rotation with vertical mixer fader drag for effortless 1-thumb control
        const step = Math.abs(dAng) > Math.abs(dY) * 1.1 ? dAng / 2.4 : dY * 0.65;
        if (Math.abs(step) < 0.15) return;
        const next = Math.max(0, Math.min(100, st.val + step));
        const delta = next - st.val;
        st.val = next;
        bump();
        onChange(next, delta);
      }}
      onPointerUp={() => {
        dragStateRef.current = null;
      }}
      onPointerCancel={() => {
        dragStateRef.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          bump();
          onChange(Math.min(100, clamped + 5), 5);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          bump();
          onChange(Math.max(0, clamped - 5), -5);
        }
      }}
    >
      <svg
        viewBox="0 0 140 140"
        className="h-full w-full overflow-visible drop-shadow-[0_6px_14px_rgba(0,0,0,0.65)]"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${uid}-well`} cx="50%" cy="45%" r="58%">
            <stop offset="0%" stopColor="#142630" />
            <stop offset="70%" stopColor="#091319" />
            <stop offset="100%" stopColor="#040a0e" />
          </radialGradient>
          <linearGradient id={`${uid}-bezel`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f727c" />
            <stop offset="45%" stopColor="#172b33" />
            <stop offset="100%" stopColor="#091318" />
          </linearGradient>
          <linearGradient id={`${uid}-cap`} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
            <stop offset="0%" stopColor="#3c5862" />
            <stop offset="35%" stopColor="#1d323b" />
            <stop offset="70%" stopColor="#101e25" />
            <stop offset="100%" stopColor="#284049" />
          </linearGradient>
          <radialGradient id={`${uid}-dish`} cx="45%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#1b313a" />
            <stop offset="75%" stopColor="#0b171d" />
            <stop offset="100%" stopColor="#071015" />
          </radialGradient>
        </defs>

        {/* Recessed Potentiometer Chassis Well */}
        <circle cx="70" cy="70" r="66" fill={`url(#${uid}-well)`} stroke={`url(#${uid}-bezel)`} strokeWidth="2.4" />
        <circle cx="70" cy="70" r="63.5" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.7" />

        {/* 25-Segment 270° Perimeter LED Collar */}
        <g>
          {Array.from({ length: LED_COUNT }, (_, i) => {
            const segF = i / (LED_COUNT - 1);
            const lit = !muted && clamped > 0 && segF <= frac + 0.01;
            const isPeak = i >= LED_COUNT - 3;
            const pOuter = polar(segF, 58.2);
            const pInner = polar(segF, 52.4);
            const ledColor = lit
              ? isPeak && activeColor === '#fbbf24'
                ? '#ff5d6c'
                : activeColor
              : '#182a33';
            return (
              <line
                key={i}
                x1={pInner.x}
                y1={pInner.y}
                x2={pOuter.x}
                y2={pOuter.y}
                stroke={ledColor}
                strokeWidth={i % 6 === 0 ? 2.8 : 2.1}
                strokeLinecap="round"
                strokeOpacity={lit ? 1 : 0.65}
              />
            );
          })}
        </g>

        {/* Engraved MIN / 50 / MAX Potentiometer Detent Labels */}
        <text x="24" y="124" textAnchor="middle" fill="#7c96a0" fontSize="7" fontWeight="800" fontFamily="ui-monospace, monospace">
          MIN
        </text>
        <text x="70" y="9.5" textAnchor="middle" fill="#7c96a0" fontSize="6.8" fontWeight="800" fontFamily="ui-monospace, monospace">
          50
        </text>
        <text x="116" y="124" textAnchor="middle" fill={activeColor} fontSize="7" fontWeight="800" fontFamily="ui-monospace, monospace">
          MAX
        </text>

        {/* Rotating Machined Knurled Aluminum Potentiometer Knob */}
        <g transform="translate(70, 70)">
          <g
            style={{
              transform: `rotate(${knobDeg}deg)`,
              transition: dragStateRef.current ? 'none' : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Outer Knurled Grip Teeth (24 machined serrations around knob perimeter) */}
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * 15 * Math.PI) / 180;
              const x1 = Math.sin(a) * 41.5;
              const y1 = -Math.cos(a) * 41.5;
              const x2 = Math.sin(a) * 45.2;
              const y2 = -Math.cos(a) * 45.2;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#395560"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              );
            })}

            {/* Anodized Aluminum Outer Cap Skirt */}
            <circle
              cx="0"
              cy="0"
              r="42.5"
              fill={`url(#${uid}-cap)`}
              stroke={activeColor}
              strokeOpacity="0.55"
              strokeWidth="1.4"
            />
            <circle cx="0" cy="0" r="38.2" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />

            {/* Recessed Brushed Center Dish */}
            <circle cx="0" cy="0" r="33.5" fill={`url(#${uid}-dish)`} stroke="#071015" strokeWidth="1.2" />

            {/* Laser-Etched Glowing Potentiometer Position Notch + LED Dot */}
            <line
              x1="0"
              y1="-23"
              x2="0"
              y2="-39.5"
              stroke={activeColor}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            <circle cx="0" cy="-35.5" r="2.2" fill="#ffffff" />
          </g>

          {/* Stationary Digital Potentiometer Readout in Center Dish */}
          <text
            x="0"
            y="3"
            textAnchor="middle"
            fill={muted ? '#ff5d6c' : '#effaf7'}
            fontSize="15"
            fontWeight="900"
            fontFamily="var(--font-display, system-ui), sans-serif"
          >
            {muted ? 'MUTE' : `${Math.round(clamped)}${unit}`}
          </text>
          <text
            x="0"
            y="14.5"
            textAnchor="middle"
            fill={activeColor}
            fontSize="6.6"
            fontWeight="800"
            letterSpacing="0.12em"
            fontFamily="ui-monospace, monospace"
          >
            {(sublabel || label.replace(/^Mac | dial| potentiometer$/gi, '')).toUpperCase().slice(0, 10)}
          </text>
        </g>
      </svg>
    </div>
  );
}
