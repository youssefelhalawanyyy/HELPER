'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Bell, Bot, CheckCircle2, X, XCircle } from 'lucide-react';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { AgentNotification, ClientEvent } from '@/types/protocol';

interface AgentNotificationBannerProps {
  notification: AgentNotification | null;
  onDismiss: () => void;
  onSend: (event: ClientEvent) => boolean;
}

export function AgentNotificationBanner({
  notification,
  onDismiss,
  onSend,
}: AgentNotificationBannerProps) {
  const style =
    notification?.status === 'error'
      ? {
          border: 'border-red-500/50 bg-[#1B0A0C]/95',
          icon: XCircle,
          iconColor: 'text-red-400',
        }
      : notification?.status === 'success'
        ? {
            border: 'border-emerald-500/50 bg-[#0A1A14]/95',
            icon: CheckCircle2,
            iconColor: 'text-emerald-400',
          }
        : notification?.status === 'approval'
          ? {
              border: 'border-cyan-400/60 bg-[#09171C]/95',
              icon: Bot,
              iconColor: 'text-cyan-300',
            }
          : notification?.status === 'warning'
            ? {
                border: 'border-amber-500/50 bg-[#1B1408]/95',
                icon: AlertTriangle,
                iconColor: 'text-amber-400',
              }
            : {
                border: 'border-white/20 bg-[#121217]/95',
                icon: Bell,
                iconColor: 'text-zinc-300',
              };

  const Icon = style.icon;

  return (
    <AnimatePresence>
      {notification && (
        <motion.div
          key={notification.id}
          initial={{ opacity: 0, y: -18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={`fixed top-11 right-4 z-40 w-[360px] max-w-[82vw] rounded-2xl border p-3 shadow-2xl backdrop-blur-md ${style.border}`}
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-white">
                    {notification.title}
                  </span>
                  <span className="font-mono-tech rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase text-zinc-300">
                    {notification.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-300">
                  {notification.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss agent notification"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {notification.status === 'approval' && (
            <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playErrorThud();
                  onSend({
                    type: 'macro:execute',
                    payload: { requestId: makeRequestId(), macroId: 'ag-reject-changes' },
                  });
                  onDismiss();
                }}
                className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-200 hover:bg-red-500/25"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject (⌘⌫)
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playSuccessChime();
                  onSend({
                    type: 'macro:execute',
                    payload: { requestId: makeRequestId(), macroId: 'ag-accept-changes' },
                  });
                  onDismiss();
                }}
                className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-black hover:bg-emerald-400"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accept (⌘↵)
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
