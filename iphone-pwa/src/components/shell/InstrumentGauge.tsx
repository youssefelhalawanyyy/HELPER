import { memo, useId } from 'react';
import styles from './InstrumentGauge.module.css';

const SAFE_GREEN = '#34d399';
const WARN_YELLOW = '#fbbf24';
const UNSAFE_RED = '#ff3b4e';

export interface HeatScale {
  warm: number;
  hot: number;
}

export type GaugeMode = 'tach' | 'heat' | 'speed' | 'battery' | 'health' | 'dial';

export const batteryHeatScale: HeatScale = { warm: 38, hot: 45 };

export function processorHeatScale(limit: number): HeatScale {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 85;
  return {
    warm: Math.max(58, Math.min(73, safeLimit - 13)),
    hot: safeLimit,
  };
}

export function heatBand(value: number | null, scale: HeatScale): {
  color: string;
  label: string;
  level: 'idle' | 'safe' | 'warn' | 'unsafe';
} {
  if (value === null || !Number.isFinite(value)) {
    return { color: '#94a3b8', label: 'NO SENSOR', level: 'idle' };
  }
  if (value >= scale.hot) {
    return { color: UNSAFE_RED, label: 'UNSAFE · HOT', level: 'unsafe' };
  }
  if (value >= scale.warm) {
    return { color: WARN_YELLOW, label: 'WARM · CAUTION', level: 'warn' };
  }
  return { color: SAFE_GREEN, label: 'SAFE · NORMAL', level: 'safe' };
}

const CX = 70;
const CY = 70;
const SWEEP_DEG = 240; // -120° to +120° from 12 o'clock

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function polar(fraction: number, radius: number): { x: number; y: number } {
  const rad = ((fraction * SWEEP_DEG - SWEEP_DEG / 2) * Math.PI) / 180;
  return {
    x: Math.round((CX + radius * Math.sin(rad)) * 100) / 100,
    y: Math.round((CY - radius * Math.cos(rad)) * 100) / 100,
  };
}

function describeArc(startFrac: number, endFrac: number, radius: number): string {
  const s = clamp(startFrac, 0, 1);
  const e = clamp(endFrac, 0, 1);
  if (e - s <= 0.002) return '';
  const a = polar(s, radius);
  const b = polar(e, radius);
  const largeArc = (e - s) * SWEEP_DEG > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x} ${b.y}`;
}

function formatScaleNumber(n: number): string {
  const rounded = Math.round(n);
  if (rounded >= 1000) {
    const k = Math.round((rounded / 1000) * 10) / 10;
    return `${k}k`;
  }
  return String(rounded);
}

interface ZoneSegment {
  from: number;
  to: number;
  color: string;
  baseOpacity: number;
  isRedline?: boolean;
}

function buildZones(mode: GaugeMode, max: number, accent: string, heat?: HeatScale): ZoneSegment[] {
  const gap = 0.011;
  if (heat || mode === 'heat') {
    const scale = heat ?? { warm: max * 0.6, hot: max * 0.8 };
    const warmF = clamp(scale.warm / max, 0.12, 0.82);
    const hotF = clamp(scale.hot / max, warmF + 0.08, 0.94);
    return [
      { from: 0, to: warmF - gap, color: SAFE_GREEN, baseOpacity: 0.44 },
      { from: warmF + gap, to: hotF - gap, color: WARN_YELLOW, baseOpacity: 0.5 },
      { from: hotF + gap, to: 1, color: UNSAFE_RED, baseOpacity: 0.72, isRedline: true },
    ];
  }
  if (mode === 'battery') {
    return [
      { from: 0, to: 0.2 - gap, color: UNSAFE_RED, baseOpacity: 0.62, isRedline: true },
      { from: 0.2 + gap, to: 0.48 - gap, color: WARN_YELLOW, baseOpacity: 0.4 },
      { from: 0.48 + gap, to: 1, color: SAFE_GREEN, baseOpacity: 0.36 },
    ];
  }
  if (mode === 'health') {
    return [
      { from: 0, to: 0.5 - gap, color: UNSAFE_RED, baseOpacity: 0.58, isRedline: true },
      { from: 0.5 + gap, to: 0.78 - gap, color: WARN_YELLOW, baseOpacity: 0.42 },
      { from: 0.78 + gap, to: 1, color: SAFE_GREEN, baseOpacity: 0.38 },
    ];
  }
  if (mode === 'tach') {
    return [
      { from: 0, to: 0.7 - gap, color: accent, baseOpacity: 0.2 },
      { from: 0.7 + gap, to: 0.85 - gap, color: WARN_YELLOW, baseOpacity: 0.38 },
      { from: 0.85 + gap, to: 1, color: UNSAFE_RED, baseOpacity: 0.64, isRedline: true },
    ];
  }
  if (mode === 'speed') {
    return [
      { from: 0, to: 0.65 - gap, color: '#22d3ee', baseOpacity: 0.22 },
      { from: 0.65 + gap, to: 1, color: SAFE_GREEN, baseOpacity: 0.32 },
    ];
  }
  // dial
  return [{ from: 0, to: 1, color: accent, baseOpacity: 0.2 }];
}

function resolveActiveAppearance(
  mode: GaugeMode,
  reading: number | null,
  fraction: number,
  accent: string,
  heat?: HeatScale,
): {
  color: string;
  level: 'idle' | 'safe' | 'warn' | 'unsafe';
  autoBadge: string;
  faceTag: string;
} {
  if (heat || mode === 'heat') {
    const scale = heat ?? { warm: 68, hot: 85 };
    const b = heatBand(reading, scale);
    return {
      color: reading === null ? '#64748b' : b.color,
      level: b.level,
      autoBadge: reading === null ? 'STANDBY' : b.level === 'unsafe' ? 'UNSAFE' : b.level === 'warn' ? 'CAUTION' : 'SAFE',
      faceTag: 'TEMP',
    };
  }
  if (mode === 'battery') {
    if (reading === null) return { color: '#64748b', level: 'idle', autoBadge: 'OFFLINE', faceTag: 'BATT' };
    if (fraction <= 0.2) return { color: UNSAFE_RED, level: 'unsafe', autoBadge: 'LOW BATT', faceTag: 'BATT' };
    if (fraction <= 0.48) return { color: WARN_YELLOW, level: 'warn', autoBadge: 'RESERVE', faceTag: 'BATT' };
    return { color: accent || SAFE_GREEN, level: 'safe', autoBadge: 'OPTIMAL', faceTag: 'BATT' };
  }
  if (mode === 'health') {
    if (reading === null) return { color: '#64748b', level: 'idle', autoBadge: 'READY', faceTag: 'DIAG' };
    if (fraction < 0.5) return { color: UNSAFE_RED, level: 'unsafe', autoBadge: 'CRITICAL', faceTag: 'DIAG' };
    if (fraction < 0.78) return { color: WARN_YELLOW, level: 'warn', autoBadge: 'FAIR', faceTag: 'DIAG' };
    return { color: SAFE_GREEN, level: 'safe', autoBadge: 'HEALTHY', faceTag: 'DIAG' };
  }
  if (mode === 'speed') {
    if (reading === null) return { color: '#22d3ee', level: 'idle', autoBadge: 'IDLE', faceTag: 'NET' };
    if (reading >= 100) return { color: SAFE_GREEN, level: 'safe', autoBadge: 'ULTRA', faceTag: 'NET' };
    if (reading >= 30) return { color: '#22d3ee', level: 'safe', autoBadge: 'FAST', faceTag: 'NET' };
    return { color: WARN_YELLOW, level: 'warn', autoBadge: 'LINK', faceTag: 'NET' };
  }
  if (mode === 'dial') {
    return { color: accent, level: 'safe', autoBadge: 'ROTARY', faceTag: 'CTRL' };
  }
  // tach
  if (reading === null) return { color: accent, level: 'idle', autoBadge: 'STANDBY', faceTag: 'LOAD' };
  if (fraction >= 0.85) return { color: UNSAFE_RED, level: 'unsafe', autoBadge: 'REDLINE', faceTag: 'LOAD' };
  if (fraction >= 0.7) return { color: WARN_YELLOW, level: 'warn', autoBadge: 'HIGH', faceTag: 'LOAD' };
  return { color: accent, level: 'safe', autoBadge: 'NOMINAL', faceTag: 'LOAD' };
}

export interface InstrumentGaugeProps {
  label: string;
  value: number | null;
  unit?: string;
  max?: number;
  accent?: string;
  heat?: HeatScale;
  mode?: GaugeMode;
  status?: string;
  decorative?: boolean;
  hideOuterLabel?: boolean;
  className?: string;
}

export const InstrumentGauge = memo(function InstrumentGauge({
  label,
  value,
  unit = '%',
  max = 100,
  accent = '#88f1d1',
  heat,
  mode,
  status,
  decorative = false,
  hideOuterLabel = false,
  className = '',
}: InstrumentGaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const resolvedMode: GaugeMode = mode ?? (heat ? 'heat' : 'tach');
  const isHeat = Boolean(heat) || resolvedMode === 'heat';
  const safeMax = max > 0 ? max : 100;

  const reading = value !== null && Number.isFinite(value) ? value : null;
  const fraction = clamp((reading ?? 0) / safeMax, 0, 1);
  const needleDeg = fraction * SWEEP_DEG - SWEEP_DEG / 2;

  const zones = buildZones(resolvedMode, safeMax, accent, heat);
  const active = resolveActiveAppearance(resolvedMode, reading, fraction, accent, heat);
  const isUnsafe = active.level === 'unsafe';
  const isWarn = active.level === 'warn';

  const displayValue =
    reading === null
      ? '—'
      : safeMax >= 200 || Number.isInteger(reading)
        ? String(Math.round(reading))
        : String(Math.round(reading * 10) / 10);

  const badgeText = status || active.autoBadge;
  const description = [
    label,
    reading === null ? 'No reading' : `${displayValue}${unit}`,
    badgeText,
  ]
    .filter(Boolean)
    .join(', ');

  // 4 intervals (0, 25%, 50%, 75%, 100%) for heat/battery/health; 5 intervals (0, 20, 40, 60, 80, 100%) for tach/speed/dial
  const fourStepScale = isHeat || resolvedMode === 'battery' || resolvedMode === 'health';
  const majorStep = fourStepScale ? 10 : 8;
  const medStep = fourStepScale ? 5 : 4;

  const scaleMarks = fourStepScale
    ? [0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
        if (isHeat && idx === 0) return { f, text: 'C', color: SAFE_GREEN, bold: true };
        if (isHeat && idx === 4) return { f, text: 'H', color: UNSAFE_RED, bold: true };
        if (resolvedMode === 'battery' && idx === 0) return { f, text: 'E', color: UNSAFE_RED, bold: true };
        if (resolvedMode === 'battery' && idx === 4) return { f, text: 'F', color: SAFE_GREEN, bold: true };
        return { f, text: formatScaleNumber(f * safeMax), color: '#b8c7d4', bold: false };
      })
    : [0, 0.2, 0.4, 0.6, 0.8, 1].map((f, idx) => ({
        f,
        text: formatScaleNumber(f * safeMax),
        color: resolvedMode === 'tach' && idx === 5 ? UNSAFE_RED : '#b8c7d4',
        bold: resolvedMode === 'tach' && idx === 5,
      }));

  const tickColorAt = (f: number, isMajor: boolean): string => {
    for (const z of zones) {
      if (f >= z.from - 0.012 && f <= z.to + 0.012) {
        if (isHeat) {
          if (z.color === UNSAFE_RED) return isMajor ? '#ff5d6c' : '#b92b3b';
          if (z.color === WARN_YELLOW) return isMajor ? '#fcd34d' : '#9a7820';
          return isMajor ? '#6ee7b7' : '#2f6e59';
        }
        if (z.isRedline) return isMajor ? '#ff5d6c' : '#a62c3b';
        if (z.color === WARN_YELLOW && resolvedMode === 'tach') {
          return isMajor ? '#fcd34d' : '#856822';
        }
      }
    }
    return isMajor ? '#dbe5ef' : '#526273';
  };

  // Needle vibrant automotive color: crimson in unsafe zone, amber in heat caution, fiery sports-orange/red or cyan spine otherwise
  const needlePrimary = isUnsafe
    ? '#ff3b4e'
    : isHeat && isWarn
      ? '#fbbf24'
      : isHeat
        ? '#34d399'
        : '#ff5a36';
  const needleSpine = isUnsafe
    ? '#ffd4d9'
    : isHeat && isWarn
      ? '#fef3c7'
      : isHeat
        ? '#d1fae5'
        : '#ffe6dc';

  const dialFaceTag = hideOuterLabel ? label.toUpperCase().slice(0, 8) : active.faceTag;

  return (
    <div
      className={`${styles.gauge} ${isUnsafe ? styles.unsafe : ''} ${hideOuterLabel ? styles.knobOnly : ''} ${className}`}
    >
      <svg
        className={styles.face}
        viewBox="0 0 140 140"
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : description}
        aria-hidden={decorative ? true : undefined}
      >
        <defs>
          <linearGradient id={`${uid}-bezel`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5d838d" />
            <stop offset="38%" stopColor="#1c333c" />
            <stop offset="72%" stopColor="#0c181f" />
            <stop offset="100%" stopColor="#355560" />
          </linearGradient>
          <radialGradient id={`${uid}-face`} cx="50%" cy="42%" r="58%">
            <stop offset="0%" stopColor="#152b34" />
            <stop offset="62%" stopColor="#0c1920" />
            <stop offset="100%" stopColor="#060e13" />
          </radialGradient>
          <linearGradient id={`${uid}-hub`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4c6e77" />
            <stop offset="100%" stopColor="#102028" />
          </linearGradient>
        </defs>

        {/* Outer Machined Automotive Bezel */}
        <circle cx={CX} cy={CY} r="67.5" fill="#05070b" />
        <circle cx={CX} cy={CY} r="65.2" fill="none" stroke={`url(#${uid}-bezel)`} strokeWidth="3.8" />
        <circle cx={CX} cy={CY} r="67" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.7" />

        {/* Recessed Carbon-Obsidian Dial Face */}
        <circle
          cx={CX}
          cy={CY}
          r="61.8"
          fill={`url(#${uid}-face)`}
          stroke={isUnsafe ? 'rgba(255,59,78,0.7)' : isWarn && isHeat ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.09)'}
          strokeWidth={isUnsafe ? 1.5 : 0.9}
        />

        {/* Subtle Top Crystal Reflection + Inner Cockpit Ring */}
        <path
          d="M 21 46 A 56 56 0 0 1 119 46 A 66 48 0 0 0 21 46 Z"
          fill="rgba(255,255,255,0.025)"
        />
        <circle
          cx={CX}
          cy={CY}
          r="27.5"
          fill="none"
          stroke="rgba(255,255,255,0.045)"
          strokeWidth="0.75"
          strokeDasharray="2 3"
        />

        {/* Base Recessed Arc Trench */}
        <path
          d={describeArc(0, 1, 55.2)}
          fill="none"
          stroke="#131b26"
          strokeWidth="5.4"
          strokeLinecap="butt"
        />

        {/* Painted Automotive Zone Arcs (Green / Yellow / Red for Heat, Reserve/Redline for others) */}
        <g fill="none" strokeLinecap="butt">
          {zones.map((z, idx) => {
            const pathD = describeArc(z.from, z.to, 55.2);
            if (!pathD) return null;
            return (
              <g key={idx}>
                <path
                  d={pathD}
                  stroke={z.color}
                  strokeWidth={z.isRedline ? 5.2 : 4.4}
                  strokeOpacity={z.baseOpacity}
                />
                {z.isRedline && (
                  <path
                    d={describeArc(z.from, z.to, 58.6)}
                    stroke={UNSAFE_RED}
                    strokeWidth="1.25"
                    strokeOpacity="0.85"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Illuminated Active Reading Arc */}
        {reading !== null && fraction > 0.004 && (
          <g fill="none" strokeLinecap="butt">
            {isHeat ? (
              zones.map((z, idx) => {
                if (fraction <= z.from) return null;
                const segEnd = Math.min(fraction, z.to);
                const d = describeArc(z.from, segEnd, 55.2);
                if (!d) return null;
                return (
                  <g key={`active-${idx}`}>
                    <path d={d} stroke={z.color} strokeWidth="9" strokeOpacity="0.22" />
                    <path d={d} stroke={z.color} strokeWidth="5" />
                  </g>
                );
              })
            ) : (
              <>
                <path
                  d={describeArc(0, fraction, 55.2)}
                  stroke={active.color}
                  strokeWidth="9"
                  strokeOpacity="0.2"
                />
                <path
                  d={describeArc(0, fraction, 55.2)}
                  stroke={active.color}
                  strokeWidth="4.8"
                />
              </>
            )}
          </g>
        )}

        {/* Precision Radial Degree Tick Marks (41 ticks across 240°) */}
        <g>
          {Array.from({ length: 41 }, (_, i) => {
            const f = i / 40;
            const isMajor = i % majorStep === 0;
            const isMed = !isMajor && i % medStep === 0;
            const outer = polar(f, 51.2);
            const inner = polar(f, isMajor ? 43.8 : isMed ? 46.8 : 48.6);
            return (
              <line
                key={i}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x}
                y2={inner.y}
                stroke={tickColorAt(f, isMajor)}
                strokeWidth={isMajor ? 1.65 : isMed ? 1.1 : 0.75}
              />
            );
          })}
        </g>

        {/* Radial Automotive Scale Numerals */}
        <g>
          {scaleMarks.map((mark) => {
            const p = polar(mark.f, 35.8);
            return (
              <text
                key={mark.f}
                className={styles.scale}
                x={p.x}
                y={p.y + 2.8}
                textAnchor="middle"
                style={{
                  fill: mark.color,
                  fontWeight: mark.bold ? 800 : 650,
                }}
              >
                {mark.text}
              </text>
            );
          })}
        </g>

        {/* Upper Dial Warning Indicator LED + Engraved Instrument Tag */}
        <g>
          <circle
            cx={CX}
            cy="46.5"
            r="2.1"
            className={isUnsafe ? styles.warningLed : undefined}
            fill={reading === null ? '#334155' : active.color}
          />
          {isHeat ? (
            /* Crisp automotive coolant / thermal glyph + TEMP tag */
            <text
              x={CX}
              y="55.5"
              textAnchor="middle"
              className={styles.faceTag}
              style={{ fill: isUnsafe ? '#ff8a96' : isWarn ? '#fde68a' : '#7b8ea3' }}
            >
              {dialFaceTag} °C
            </text>
          ) : (
            <text x={CX} y="55.5" textAnchor="middle" className={styles.faceTag}>
              {dialFaceTag}
            </text>
          )}
        </g>

        {/* Recessed Digital Cockpit LCD Window (mathematically clear of needle at all -120°..+120° angles) */}
        <rect
          x="35"
          y="88"
          width="70"
          height="20.5"
          rx="5"
          fill="#04060a"
          stroke={
            isUnsafe
              ? 'rgba(255,59,78,0.65)'
              : isWarn && isHeat
                ? 'rgba(251,191,36,0.45)'
                : 'rgba(255,255,255,0.11)'
          }
          strokeWidth="0.9"
        />
        <line x1="38" y1="89" x2="102" y2="89" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8" />

        <text
          className={styles.value}
          x={CX}
          y="102.2"
          textAnchor="middle"
          style={{ fill: isUnsafe ? '#ff808d' : '#f8fafc' }}
        >
          {displayValue}
          {reading !== null && unit && (
            <tspan className={styles.unit} dx="1">
              {unit}
            </tspan>
          )}
        </text>

        {/* Lower Dial Zone / Status Readout */}
        <text
          className={styles.zoneBadge}
          x={CX}
          y="119.5"
          textAnchor="middle"
          style={{
            fill:
              reading === null
                ? '#788799'
                : isHeat || isUnsafe || isWarn
                  ? active.color
                  : status
                    ? active.color
                    : '#8fa2b5',
          }}
        >
          {badgeText}
        </text>

        {/* Tapered Sports-Car Needle (pivoted at exact (70, 70) local origin) */}
        <g transform={`translate(${CX}, ${CY})`}>
          <g
            className={styles.needle}
            style={{
              transform: `rotate(${reading === null ? -SWEEP_DEG / 2 : needleDeg}deg)`,
              opacity: reading === null ? 0.35 : 1,
            }}
          >
            {/* Subtle vector drop shadow */}
            <polygon points="1.2,-47 3.6,0 2.1,9 -0.6,9 -1.2,0" fill="rgba(0,0,0,0.58)" />
            {/* Counterweight tail */}
            <polygon points="-2.3,0 2.3,0 1.6,9.2 -1.6,9.2" fill="#253040" />
            {/* Tapered illuminated needle blade */}
            <polygon points="0,-48.5 2.5,0 -2.5,0" fill={needlePrimary} />
            {/* High-contrast specular center spine */}
            <polygon points="0,-47 0.95,-3 -0.95,-3" fill={needleSpine} />
          </g>

          {/* Machined 3-Piece Center Hub Cap */}
          <circle cx="0" cy="0" r="8.2" fill={`url(#${uid}-hub)`} stroke="#0a0e14" strokeWidth="1" />
          <circle
            cx="0"
            cy="0"
            r="5.3"
            fill="#0b1017"
            stroke={reading === null ? '#475569' : active.color}
            strokeWidth="1.35"
          />
          <circle cx="0" cy="0" r="2.4" fill="#1e2736" />
          <circle cx="-0.8" cy="-0.9" r="0.8" fill="rgba(255,255,255,0.55)" />
        </g>
      </svg>

      {!hideOuterLabel && <span className={styles.label}>{label}</span>}
    </div>
  );
});
