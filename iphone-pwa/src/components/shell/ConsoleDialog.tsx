'use client';

import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function ConsoleDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const drag = useRef<number | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return createPortal(<dialog ref={ref} className="work-dialog" data-wide={wide} data-no-swipe="true" aria-labelledby={id}
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="work-sheet">
      <header className="work-heading" onPointerDown={e => { drag.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={e => { if (drag.current !== null && e.clientY - drag.current > 55) onClose(); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}>
        <h2 id={id}>{title}</h2><button aria-label="Close" onPointerDown={e => e.stopPropagation()} onClick={onClose}><X size={18}/></button>
      </header>
      {children}
    </div>
  </dialog>, document.body);
}
