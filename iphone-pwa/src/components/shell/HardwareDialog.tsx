'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface HardwareDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Native <dialog> modal wrapper following modern web standards:
 * - Uses showModal() for built-in top-layer, inert backdrop, focus containment & Esc dismissal
 * - Includes Safari pointer-bounds light-dismiss fallback when `closedBy` is unavailable
 */
export function HardwareDialog({ open, title, onClose, children }: HardwareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    const handleClose = () => {
      el.returnValue = '';
      onClose();
    };
    el.addEventListener('close', handleClose);

    // Light-dismiss fallback for browsers without native `closedby="any"` (e.g. Safari)
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        pressedOutside = isOutside(e);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype) && pressedOutside && isOutside(e)) {
        el.close();
      }
      pressedOutside = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);

    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="hw-dialog w-full"
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
        <h1 id={titleId} className="text-xs font-semibold tracking-wider text-white uppercase">
          {title}
        </h1>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="deck-scroll overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}
