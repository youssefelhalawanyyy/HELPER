'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Copy,
  Mic,
  Phone,
  PhoneOff,
  Radio,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { NourVoiceController } from '@/hooks/useNourVoice';
import { soundEngine } from '@/lib/soundEngine';

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function NourVoiceView({ nour }: { nour: NourVoiceController }) {
  const {
    botName,
    setBotName,
    phase,
    liveCallOn,
    wakeWordOn,
    muted,
    toggleMute,
    liveTranscript,
    orbEnergy,
    turns,
    clearTurns,
    handleOrbTap,
    toggleLiveCall,
    toggleWakeWord,
    triggerPrompt,
  } = nour;

  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [turns, phase, liveTranscript]);

  const orbColor =
    phase === 'listening'
      ? '#7dd3fc'
      : phase === 'speaking'
        ? '#88f1d1'
        : phase === 'thinking'
          ? '#fbbf24'
          : phase === 'wake_listening'
            ? '#34d399'
            : '#88f1d1';

  const phaseLabel =
    phase === 'listening'
      ? 'بتسمعك دلوقتي'
      : phase === 'speaking'
        ? 'بتتكلم لايف'
        : phase === 'thinking'
          ? 'بتفكر في الرد…'
          : phase === 'wake_listening'
            ? `مستنية «يا ${botName}»`
            : liveCallOn
              ? 'المكالمة شغالة'
              : 'متاحة دلوقتي';

  const handleSendText = () => {
    const clean = draft.trim();
    if (!clean) return;
    soundEngine.playClick();
    setDraft('');
    void triggerPrompt(clean);
  };

  const copyMsg = (id: string, text: string) => {
    soundEngine.playClick();
    void navigator.clipboard?.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1400);
  };

  return (
    <div className="screen-grid layout-nour">
      {/* LEFT: Executive Voice Call Orb Stage */}
      <div className="tile flex min-h-0 flex-col items-center justify-between gap-2 text-center">
        <div
          className="absolute top-0 left-0 h-[3px] w-full rounded-r-full"
          style={{ background: `linear-gradient(90deg, #f472b6, ${orbColor}, #22d3ee)` }}
        />

        {/* Top Bar: Call + Wake Controls */}
        <div className="flex w-full items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: orbColor,
                boxShadow: `0 0 10px ${orbColor}`,
              }}
            />
            <span className="disp text-[16px]">{botName}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void toggleLiveCall()}
              className="flex h-7 items-center gap-1 rounded-full border px-2.5 text-[8.5px] font-extrabold uppercase transition-colors"
              style={{
                background: liveCallOn ? 'rgba(255,93,108,0.22)' : 'rgba(52,211,153,0.18)',
                borderColor: liveCallOn ? '#ff5d6c' : '#34d399',
                color: liveCallOn ? '#ff5d6c' : '#34d399',
              }}
            >
              {liveCallOn ? <PhoneOff className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
              {liveCallOn ? 'END' : 'LIVE CALL'}
            </button>
            <button
              type="button"
              onClick={() => void toggleWakeWord()}
              className="flex h-7 items-center gap-1 rounded-full border px-2 text-[8px] font-extrabold"
              style={{
                background: wakeWordOn ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                borderColor: wakeWordOn ? '#22d3ee' : 'rgba(255,255,255,0.1)',
                color: wakeWordOn ? '#22d3ee' : '#a1a1aa',
              }}
            >
              <Radio className={`h-3 w-3 ${wakeWordOn ? 'animate-pulse' : ''}`} />
              «يا {botName}»
            </button>
          </div>
        </div>

        {/* Multi-Ring Audio-Reactive Orb */}
        <div className="relative flex flex-col items-center justify-center gap-2">
          <div className="relative grid place-items-center">
            {/* Outer ambient ripple ring */}
            <motion.div
              aria-hidden="true"
              animate={{
                scale:
                  phase === 'speaking'
                    ? 1.15 + orbEnergy * 0.38
                    : phase === 'listening'
                      ? [1.05, 1.24, 1.05]
                      : 1.04,
                opacity: phase === 'idle' ? 0.18 : 0.48,
              }}
              transition={{
                duration: phase === 'speaking' ? 0.09 : 1.8,
                repeat: phase === 'listening' ? Infinity : 0,
              }}
              className="pointer-events-none absolute h-24 w-24 rounded-full border"
              style={{
                borderColor: orbColor,
                boxShadow: `0 0 38px ${orbColor}55`,
              }}
            />

            <motion.button
              type="button"
              onClick={() => void handleOrbTap()}
              whileTap={{ scale: 0.92 }}
              animate={{
                scale: phase === 'speaking' ? 1 + orbEnergy * 0.16 : phase === 'listening' ? [1, 1.05, 1] : 1,
              }}
              transition={{
                duration: phase === 'speaking' ? 0.08 : 1.4,
                repeat: phase === 'listening' ? Infinity : 0,
              }}
              aria-label="Talk or Interrupt"
              className="relative grid h-20 w-20 place-items-center rounded-full border-2"
              style={{
                borderColor: orbColor,
                background: `radial-gradient(circle at 32% 28%, ${orbColor}66, #0d242a 72%)`,
                boxShadow: `0 0 ${22 + Math.round(orbEnergy * 28)}px ${orbColor}55, inset 0 0 18px ${orbColor}38`,
              }}
            >
              {phase === 'speaking' ? (
                <Square className="h-6 w-6 fill-current text-white" />
              ) : (
                <Mic className="h-7 w-7 text-white" />
              )}
            </motion.button>
          </div>

          <div className="space-y-0.5">
            <div dir="rtl" className="text-[10.5px] font-extrabold text-white">
              {phaseLabel}
            </div>
            <div className="text-[8px] text-zinc-400">
              {phase === 'speaking'
                ? 'Tap orb to interrupt anytime'
                : 'Live Call stays on while swiping pages'}
            </div>
          </div>
        </div>

        {/* Bottom Audio Bar */}
        <div className="flex w-full items-center justify-between gap-1.5 rounded-xl border border-white/[0.06] bg-black/50 px-2 py-1">
          <button
            type="button"
            onClick={toggleMute}
            className="flex items-center gap-1 text-[8.5px] font-extrabold"
            style={{ color: muted ? '#ff5d6c' : '#34d399' }}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muted ? 'Muted' : 'Voice ON'}
          </button>

          <button aria-pressed={nour.spokenAlerts} onClick={nour.toggleAlerts} className="text-xs">
            Spoken alerts {nour.spokenAlerts ? 'on' : 'off'}
          </button>
          {/* Animated Mini Sound Bars */}
          <div className="flex h-3.5 items-center gap-0.5" aria-hidden="true">
            {[0.4, 0.9, 0.65, 1, 0.5].map((mult, idx) => (
              <span
                key={idx}
                className="w-[2.5px] rounded-full transition-all duration-75"
                style={{
                  height:
                    phase === 'speaking'
                      ? `${Math.max(25, Math.min(100, Math.round((0.25 + orbEnergy * mult) * 100)))}%`
                      : phase === 'listening'
                        ? '55%'
                        : '22%',
                  background: orbColor,
                }}
              />
            ))}
          </div>

          <input
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            dir="rtl"
            aria-label="Assistant name"
            className="w-12 rounded bg-white/[0.06] px-1.5 py-0.5 text-center text-[9px] font-extrabold text-[#f472b6] outline-none"
          />
        </div>
      </div>

      {/* RIGHT: Advanced Modern Chat Thread + Text/Voice Composer */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#f472b6] to-[#a78bfa]" />

        {/* Chat Header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black text-[#08221c]"
              style={{
                background: 'linear-gradient(135deg, #88f1d1, #7dd3fc)',
                boxShadow: '0 0 12px rgba(136,241,209,0.35)',
              }}
            >
              {(botName || 'ن').slice(0, 1)}
              <span
                className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#101d25]"
                style={{ background: phase === 'idle' ? '#34d399' : orbColor }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[11px] font-extrabold text-[#effaf7]">{botName}</span>
                <span className="rounded-full border border-[#b3e5df36] bg-[#bcfff20d] px-1.5 py-0.5 text-[7.5px] font-extrabold text-[#88f1d1]">
                  {phaseLabel}
                </span>
              </div>
              <div className="text-[8px] text-[#9cb4bb]">
                {turns.length > 0 ? `${turns.length} messages · Continuous memory` : 'Voice + Chat Companion'}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Clear chat"
            onClick={clearTurns}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-400 hover:border-[#ff5d6c]/40 hover:text-[#ff5d6c]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Modern Chat Messages Viewport */}
        <div
          ref={scrollRef}
          dir="rtl"
          className="deck-scroll min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-2.5 text-right"
        >
          {turns.length === 0 && !liveTranscript && phase !== 'thinking' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[#b3e5df36] bg-[#bcfff20d]">
                <Sparkles className="h-5 w-5 text-[#88f1d1]" />
              </div>
              <div className="space-y-0.5">
                <div className="text-[11px] font-extrabold text-[#effaf7]">
                  أهلاً! أنا {botName} — موجودة معاك في أي وقت
                </div>
                <div className="text-[9px] text-[#9cb4bb]">
                  اتكلم بصوتك أو اكتب تحت، وندردش في الكود أو في أي حاجة تخطر على بالك.
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                {[
                  'إيه أخبار اللابتوب دلوقتي؟',
                  'احكيلي عن مشروع ديف ديك',
                  'اعملي سكان للكمبيوتر',
                  'عايز أفصل شوية وندردش',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => void triggerPrompt(chip)}
                    className="rounded-full border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 py-1 text-[8.5px] font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1] hover:bg-[#bcfff21a]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {turns.map((t, idx) => {
                const isUser = t.role === 'user';
                const isLatestModel = !isUser && idx === turns.length - 1;
                return (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                    className={`flex items-end gap-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {!isUser && (
                      <div
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8.5px] font-black text-[#08221c]"
                        style={{ background: 'linear-gradient(135deg, #88f1d1, #7dd3fc)' }}
                      >
                        {(botName || 'ن').slice(0, 1)}
                      </div>
                    )}

                    <div
                      className={`group max-w-[86%] rounded-2xl px-3 py-2 text-[10.5px] leading-relaxed ${
                        isUser
                          ? 'rounded-bl-sm border border-[#88f1d1]/35 bg-gradient-to-br from-[#133338] to-[#0d2229] text-[#effaf7]'
                          : 'rounded-br-sm border border-[#98c8ce29] bg-[#102129] text-[#effaf7]'
                      }`}
                    >
                      <div>{t.text}</div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[7.5px] text-zinc-400">
                        <span className="font-mono-tech">{formatTime(t.ts)}</span>
                        {!isUser && (
                          <div className="flex items-center gap-1.5">
                            {isLatestModel && phase === 'speaking' && (
                              <span className="font-bold text-[#f472b6]">Speaking…</span>
                            )}
                            <button
                              type="button"
                              aria-label="Copy reply"
                              onClick={() => copyMsg(t.id, t.text)}
                              className="text-zinc-400 hover:text-white"
                            >
                              {copiedId === t.id ? (
                                <Check className="h-2.5 w-2.5 text-[#34d399]" />
                              ) : (
                                <Copy className="h-2.5 w-2.5" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {/* Live Interim Speech Bubble while talking */}
              {phase === 'listening' && liveTranscript && (
                <div className="flex flex-row-reverse items-end gap-1.5">
                  <div className="max-w-[82%] rounded-2xl rounded-bl-sm border border-dashed border-[#22d3ee]/45 bg-[#22d3ee]/10 px-3 py-1.5 text-[10px] text-[#aef4ff]">
                    {liveTranscript}…
                  </div>
                </div>
              )}

              {/* Live Typing Indicator while thinking */}
              {phase === 'thinking' && (
                <div className="flex items-end gap-1.5">
                  <div
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8.5px] font-black text-white"
                    style={{ background: 'linear-gradient(135deg, #f472b6, #a78bfa)' }}
                  >
                    {(botName || 'ن').slice(0, 1)}
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl rounded-br-sm border border-white/[0.08] bg-[#181526] px-3 py-2">
                    {[0, 1, 2].map((dot) => (
                      <motion.span
                        key={dot}
                        animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                        transition={{ repeat: Infinity, duration: 0.9, delay: dot * 0.16 }}
                        className="h-1.5 w-1.5 rounded-full bg-[#f472b6]"
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Hybrid Text + Voice Composer */}
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendText();
            }}
            dir="rtl"
            placeholder={`اكتب أو اتكلم مع ${botName}…`}
            className="h-8 min-w-0 flex-1 rounded-xl border border-[#b3e5df36] bg-[#0a151c] px-3 text-right text-[10px] text-[#effaf7] outline-none placeholder:text-[#78959e] focus:border-[#88f1d1]"
          />
          <button
            type="button"
            onClick={handleSendText}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#88f1d1] text-[#08221c] disabled:opacity-35"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
