'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { AgentQuestion, ClientEvent } from '@/types/protocol';

export function AgentQuestionOverlay({
  question,
  onSend,
}: {
  question: AgentQuestion | null;
  onSend: (event: ClientEvent) => boolean;
}) {
  return (
    <AnimatePresence>
      {question && (
        <motion.div
          key={question.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 8 }}
            transition={DECK_SPRING}
            role="dialog" aria-modal="true" aria-label="Antigravity question"
            className="question-sheet tile relative w-full max-w-[480px] p-5"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#22d3ee]/15 text-[#22d3ee]">
                <Bot className="h-4 w-4" />
              </div>
              <span className="disp text-[22px] text-[#22d3ee]">Antigravity Needs You</span>
            </div>

            <p className="mb-4 text-sm font-semibold leading-snug text-white">
              {question.question}
            </p>

            <div className="grid grid-cols-2 gap-2">
              {question.options.map((opt, idx) => (
                <motion.button
                  key={opt}
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={DECK_SPRING}
                  onClick={() => {
                    soundEngine.playSuccessChime();
                    onSend({
                      type: 'agent:answer',
                      payload: { requestId: makeRequestId(), questionId: question.id, answer: opt },
                    });
                  }}
                  className="rounded-xl px-3.5 py-2.5 text-xs font-extrabold transition-all"
                  style={
                    idx === 0
                      ? {
                          background: '#34d399',
                          color: '#04130c',
                          boxShadow: '0 3px 0 #14664a',
                        }
                      : {
                          background: 'rgba(255,255,255,0.08)',
                          color: '#f2f3f7',
                          border: '1px solid rgba(255,255,255,0.12)',
                        }
                  }
                >
                  {opt}
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
