'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { ClientEvent, SnippetItem } from '@/types/protocol';

interface SnippetDrawerProps {
  open: boolean;
  snippets: SnippetItem[];
  onClose: () => void;
  onSend: (event: ClientEvent) => boolean;
}

export function SnippetDrawer({ open, snippets, onClose, onSend }: SnippetDrawerProps) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [autoPaste, setAutoPaste] = useState(true);

  const handleInject = (snip: SnippetItem) => {
    soundEngine.playClick();
    onSend({
      type: 'snippet:inject',
      payload: { requestId: makeRequestId(), text: snip.value, autoPaste: snip.autoPaste },
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !value.trim()) return;
    soundEngine.playClick();
    onSend({
      type: 'snippet:upsert',
      payload: {
        requestId: makeRequestId(),
        snippet: {
          id: `snip-${Date.now().toString(36)}`,
          label: label.trim(),
          category: 'custom',
          value: value.trim(),
          autoPaste,
        },
      },
    });
    setLabel('');
    setValue('');
    setAdding(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/65 backdrop-blur-xs"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className="fixed top-0 right-0 bottom-0 z-40 flex w-[340px] max-w-[85vw] flex-col border-l border-white/10 bg-[#0B0B0E] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <h2 className="text-xs font-semibold tracking-wide text-white uppercase">
                  Quick Snippet Injector
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  className="flex h-7 items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 text-[11px] font-medium text-cyan-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close snippets"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {adding && (
              <form
                onSubmit={handleAdd}
                className="flex flex-col gap-2 border-b border-white/[0.08] bg-[#121217] p-3"
              >
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Snippet label (e.g. Auth Header)"
                  className="rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                />
                <textarea
                  rows={2}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Text or {{uuid}} / {{email}} / {{iso}}"
                  className="font-mono-tech rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-cyan-400"
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={autoPaste}
                      onChange={(e) => setAutoPaste(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    Auto-paste on Mac (⌘V)
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg bg-cyan-500 px-3 py-1 text-[11px] font-semibold text-black"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto p-3">
              {snippets.map((snip) => (
                <div
                  key={snip.id}
                  className="hw-key group flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => handleInject(snip)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <ClipboardPaste className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      <span className="truncate text-xs font-medium text-white">{snip.label}</span>
                    </div>
                    <span className="font-mono-tech mt-0.5 truncate text-[10px] text-zinc-500">
                      {snip.value}
                    </span>
                  </button>

                  {snip.category === 'custom' && (
                    <button
                      type="button"
                      onClick={() =>
                        onSend({
                          type: 'snippet:delete',
                          payload: { requestId: makeRequestId(), snippetId: snip.id },
                        })
                      }
                      aria-label={`Delete ${snip.label}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
