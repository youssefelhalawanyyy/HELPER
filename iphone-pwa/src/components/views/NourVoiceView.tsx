'use client';

import { motion } from 'framer-motion';
import {
  Mic,
  Phone,
  PhoneOff,
  Radio,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { NourVoiceController } from '@/hooks/useNourVoice';

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
    showSubtitles,
    setShowSubtitles,
    handleOrbTap,
    toggleLiveCall,
    toggleWakeWord,
    triggerPrompt,
  } = nour;

  const orbColor =
    phase === 'listening'
      ? '#22d3ee'
      : phase === 'speaking'
        ? '#f472b6'
        : phase === 'thinking'
          ? '#fbbf24'
          : phase === 'wake_listening'
            ? '#34d399'
            : '#c084fc';

  const statusText =
    phase === 'listening'
      ? 'سامعاك دلوقتي... اتكلم!'
      : phase === 'speaking'
        ? `${botName} بتتكلم — قاطعها بصوتك أو اضغط في أي وقت`
        : phase === 'thinking'
          ? `${botName} بتجهز الرد...`
          : phase === 'wake_listening'
            ? `مستنياك تقول «يا ${botName}»...`
            : `ابدأ LIVE CALL واسحب بين أي صفحات والمكالمة شغالة!`;

  return (
    <div className="screen-grid layout-nour">
      {/* LEFT: Live Voice-Reactive Orb + Persistent Live Call & Wake Word Controls */}
      <div className="tile flex min-h-0 flex-col items-center justify-between gap-2 text-center">
        <div
          className="absolute top-0 left-0 h-[3px] w-full rounded-r-full"
          style={{ background: `linear-gradient(90deg, #f472b6, ${orbColor}, #22d3ee)` }}
        />

        {/* Header */}
        <div className="flex w-full items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#f472b6]" />
            <span className="disp text-[17px]">{botName} Live</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void toggleLiveCall()}
              className="flex h-7 items-center gap-1 rounded-full border px-2.5 text-[8.5px] font-extrabold uppercase"
              style={{
                background: liveCallOn ? 'rgba(255,93,108,0.24)' : 'rgba(52,211,153,0.2)',
                borderColor: liveCallOn ? '#ff5d6c' : '#34d399',
                color: liveCallOn ? '#ff5d6c' : '#34d399',
              }}
            >
              {liveCallOn ? <PhoneOff className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
              {liveCallOn ? 'END CALL' : 'LIVE CALL'}
            </button>
            <button
              type="button"
              onClick={() => void toggleWakeWord()}
              className="flex h-7 items-center gap-1 rounded-full border px-2 text-[8px] font-extrabold uppercase"
              style={{
                background: wakeWordOn ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.05)',
                borderColor: wakeWordOn ? '#22d3ee' : 'rgba(255,255,255,0.12)',
                color: wakeWordOn ? '#22d3ee' : '#a1a1aa',
              }}
            >
              <Radio className={`h-3 w-3 ${wakeWordOn ? 'animate-pulse' : ''}`} />
              «يا {botName}»
            </button>
          </div>
        </div>

        {/* Audio-Reactive Glowing Orb */}
        <div className="flex flex-col items-center justify-center gap-1.5">
          <motion.button
            type="button"
            onClick={() => void handleOrbTap()}
            whileTap={{ scale: 0.92 }}
            animate={{
              scale:
                phase === 'speaking'
                  ? 1 + orbEnergy * 0.22
                  : phase === 'listening'
                    ? [1, 1.06, 1]
                    : 1,
            }}
            transition={{
              duration: phase === 'speaking' ? 0.08 : 1.4,
              repeat: phase === 'listening' ? Infinity : 0,
            }}
            aria-label="Talk or Interrupt Nour"
            className="relative grid h-24 w-24 place-items-center rounded-full border-2"
            style={{
              borderColor: orbColor,
              background: `radial-gradient(circle at 35% 30%, ${orbColor}66, #140d21 72%)`,
              boxShadow: `0 0 ${28 + Math.round(orbEnergy * 34)}px ${orbColor}66, inset 0 0 22px ${orbColor}33`,
            }}
          >
            {phase === 'speaking' ? (
              <Square className="h-7 w-7 fill-current text-white" />
            ) : (
              <Mic className="h-8 w-8 text-white" />
            )}
          </motion.button>

          <div dir="rtl" className="text-[10.5px] font-extrabold text-white">
            {statusText}
          </div>
          {liveTranscript && (
            <div dir="rtl" className="max-w-[92%] truncate text-[9px] text-[#22d3ee]">
              «{liveTranscript}»
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="flex w-full items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-extrabold text-zinc-200"
          >
            {muted ? <VolumeX className="h-3 w-3 text-[#ff5d6c]" /> : <Volume2 className="h-3 w-3 text-[#34d399]" />}
            {muted ? 'Muted' : 'Neural Voice'}
          </button>

          <span className="font-mono-tech text-[8px] text-[#34d399]">
            Background Call Active Across Pages
          </span>

          <button
            type="button"
            onClick={() => setShowSubtitles(!showSubtitles)}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-bold text-zinc-300"
          >
            {showSubtitles ? 'Subtitles: ON' : 'Voice Only'}
          </button>
        </div>
      </div>

      {/* RIGHT: Neural Female Voice Picker, Live Subtitles & 1-Tap Starters */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#f472b6]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              dir="rtl"
              aria-label="Wake word name"
              className="h-7 w-20 rounded-lg border border-white/10 bg-[#080a10] px-2 text-center text-[10px] font-extrabold text-[#f472b6] outline-none"
            />
            <span className="truncate text-[9px] font-bold text-zinc-400">
              {liveCallOn
                ? 'Live Call Active · Ready for hours'
                : wakeWordOn
                  ? `Listening for «يا ${botName}»`
                  : 'Egyptian Arabic Companion'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Clear conversation"
            onClick={clearTurns}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-zinc-400 hover:text-[#ff5d6c]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Conversation Subtitles */}
        <div
          dir="rtl"
          className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-right"
        >
          {!showSubtitles ? (
            <div className="grid h-full place-items-center text-[10px] font-bold text-zinc-400">
              وضع المكالمة الصوتية فقط شغال — اسحب لأي صفحة وهفضل معاك!
            </div>
          ) : turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <div className="text-[11px] font-extrabold text-[#f472b6]">
                أهلاً يا قمر! أنا {botName} — شغّل LIVE CALL واسحب براحتك بين كل الصفحات وأنا بكلمك لايف!
              </div>
              <div className="text-[9px] text-zinc-400">
                صوت بنت مصرية حقيقي بالذكاء الاصطناعي وتقدر تقاطعني في أي لحظة.
              </div>
            </div>
          ) : (
            turns.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl px-2.5 py-1.5 text-[10px] leading-relaxed ${
                  t.role === 'user'
                    ? 'mr-auto max-w-[88%] border border-[#22d3ee]/25 bg-[#22d3ee]/10 text-[#e0f9ff]'
                    : 'ml-auto max-w-[92%] border border-[#f472b6]/30 bg-[#f472b6]/10 text-white'
                }`}
              >
                <div className="mb-0.5 text-[8px] font-extrabold opacity-70">
                  {t.role === 'user' ? 'أنت' : botName}
                </div>
                {t.text}
              </div>
            ))
          )}
        </div>

        {/* 1-Tap Voice Starters */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            'يا نور عاملة إيه؟ إيه أخبار اللابتوب؟',
            'احكيلي عن مشروع ديف ديك باختصار',
            'اعملي سكان للكمبيوتر وشوفي صحته',
            'عايزين ندردش شوية يا نور',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              dir="rtl"
              onClick={() => void triggerPrompt(prompt)}
              className="truncate rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-right text-[8.5px] font-bold text-zinc-200 hover:border-[#f472b6]/45"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
