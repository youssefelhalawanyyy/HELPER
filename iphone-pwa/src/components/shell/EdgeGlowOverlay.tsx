'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { AlertFlash } from '@/hooks/useDevDeckSocket';

export function EdgeGlowOverlay({ alertFlash }: { alertFlash: AlertFlash | null }) {
  const glowColor =
    alertFlash?.kind === 'error'
      ? 'rgba(239, 68, 68, 0.72)'
      : alertFlash?.kind === 'warning'
        ? 'rgba(245, 158, 11, 0.65)'
        : 'rgba(16, 185, 129, 0.72)';

  const badgeStyles =
    alertFlash?.kind === 'error'
      ? 'border-red-500/50 bg-red-950/90 text-red-200'
      : alertFlash?.kind === 'warning'
        ? 'border-amber-500/50 bg-amber-950/90 text-amber-200'
        : 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200';

  return (
    <AnimatePresence>
      {alertFlash && (
        <motion.div
          key={alertFlash.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.55, 1, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.9, ease: 'easeInOut' }}
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            boxShadow: `inset 0 0 38px 6px ${glowColor}`,
          }}
        >
          <div className="flex justify-center pt-10">
            <span
              className={`font-mono-tech rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide shadow-xl ${badgeStyles}`}
            >
              {alertFlash.message}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
