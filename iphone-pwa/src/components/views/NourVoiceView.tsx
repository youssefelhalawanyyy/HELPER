'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Mic,
  MicOff,
  Radio,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { DeckViewId } from '@/components/shell/LeftNavRail';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type VoicePhase = 'idle' | 'wake_listening' | 'listening' | 'thinking' | 'speaking';

interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  ts: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const ENV_GEMINI_KEY = (process.env.NEXT_PUBLIC_DEVDECK_DOCTOR_AI_KEY || '').trim();
const STORAGE_NAME = 'devdeck.nour.name.v1';

const FEMALE_ARABIC_HINTS = /salma|mariam|laila|hoda|amina|noura|rana|sara|fatima|zahra|female|سلمى|مريم|ليلى|هدى/i;
const MALE_ARABIC_HINTS = /majed|tarik|naayf|maged|hamdan|shakir|male|ماجد|طارق|نايف/i;

function pickBestFemaleArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const arVoices = voices.filter((v) => /^ar/i.test(v.lang));
  if (arVoices.length === 0) return null;

  // 1. Egyptian Arabic female voice (e.g. Salma ar-EG)
  const egFemale = arVoices.find(
    (v) => /ar[-_]eg/i.test(v.lang) && !MALE_ARABIC_HINTS.test(v.name),
  );
  if (egFemale) return egFemale;

  // 2. Any named Arabic female voice (Mariam, Laila, Hoda, etc.)
  const anyFemale = arVoices.find((v) => FEMALE_ARABIC_HINTS.test(v.name));
  if (anyFemale) return anyFemale;

  // 3. Any non-male Arabic voice
  const nonMale = arVoices.find((v) => !MALE_ARABIC_HINTS.test(v.name));
  return nonMale || arVoices[0];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function NourVoiceView({
  deck,
  onNavigate,
}: {
  deck: DevDeckState;
  onNavigate?: (view: DeckViewId) => void;
}) {
  const [botName, setBotName] = useState('نور');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [wakeWordOn, setWakeWordOn] = useState(false);
  const [handsFreeFollowup, setHandsFreeFollowup] = useState(true);
  const [muted, setMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastReply, setLastReply] = useState('اضغطي على الدايرة أو شغّل النداء الصوتي وقول «يا نور» عشان نتكلم سوا!');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState('');
  const [showSubtitles, setShowSubtitles] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  const wakeWordRef = useRef(false);
  const activeListeningRef = useRef(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  const botNameRef = useRef('نور');
  const mutedRef = useRef(false);
  const followUpRef = useRef(true);
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    wakeWordRef.current = wakeWordOn;
  }, [wakeWordOn]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    botNameRef.current = botName;
  }, [botName]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    followUpRef.current = handsFreeFollowup;
  }, [handsFreeFollowup]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_NAME);
      if (saved) setBotName(saved);
    } catch {
      // Ignore
    }
  }, []);

  // Load available Arabic voices on iPhone/Mac/Windows
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      const ar = list.filter((v) => /^ar/i.test(v.lang));
      setVoices(ar.length > 0 ? ar : list.slice(0, 12));
      setSelectedVoiceUri((prev) => {
        if (prev) return prev;
        const best = pickBestFemaleArabicVoice(list);
        return best?.voiceURI || '';
      });
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const liveContext = useMemo(() => {
    const p = deck.powerState;
    const d = deck.doctorReport;
    const n = deck.networkState;
    return [
      `الاتصال بالكمبيوتر: ${deck.status === 'connected' ? `متصل (${deck.hello?.hostname || 'Mac'})` : 'غير متصل (شغال مباشر على الموبايل)'}`,
      `التطبيق المفتوح: ${deck.activeApp.appName || 'غير معروف'}`,
      `المعالج: ${deck.stats.cpuPct}% · الرام: ${deck.stats.ramUsedGb}/${deck.stats.ramTotalGb} جيجا`,
      `البطارية: ${p.batteryPct || deck.stats.batteryPct}% (${p.isCharging ? 'بيشحن' : 'على البطارية'})${p.healthPct ? ` · صحة البطارية ${p.healthPct}%` : ''}`,
      `صحة الجهاز (PC Doctor): ${d.score ? `${d.score}/100 (${d.grade})` : 'لم يتم الفحص بعد'}`,
      `الإنترنت: ${n.downMbps ? `تحميل ${n.downMbps} ميجا · بنج ${n.pingMs}ms` : 'جاهز للفحص'}`,
      `الفرع الحالي في Git: ${deck.gitStatus.branch || 'main'}`,
    ].join('\n');
  }, [deck]);

  const executeNourAction = useCallback(
    (action: string | null | undefined) => {
      if (!action) return;
      if (action === 'doctor_scan') {
        onNavigate?.('doctor');
        deck.sendEvent({ type: 'doctor:scan', payload: { requestId: makeRequestId() } });
      } else if (action === 'net_scan') {
        onNavigate?.('network');
        deck.sendEvent({ type: 'network:scan', payload: { requestId: makeRequestId() } });
      } else if (action === 'lock_screen') {
        deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } });
      } else if (action === 'caffeine_on') {
        deck.sendEvent({ type: 'hardware:caffeine', payload: { requestId: makeRequestId(), active: true } });
      } else if (action === 'caffeine_off') {
        deck.sendEvent({ type: 'hardware:caffeine', payload: { requestId: makeRequestId(), active: false } });
      } else if (action === 'open_antigravity') {
        onNavigate?.('antigravity');
      } else if (action === 'open_power') {
        onNavigate?.('power');
      } else if (action === 'open_doctor') {
        onNavigate?.('doctor');
      } else if (action === 'open_network') {
        onNavigate?.('network');
      }
    },
    [deck, onNavigate],
  );

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recRef.current) {
      try {
        recRef.current.onend = null;
        recRef.current.abort();
      } catch {
        // Ignore
      }
      recRef.current = null;
    }
  }, []);

  const startRecognitionRef = useRef<(mode: 'wake' | 'active') => void>(() => {});

  const speakArabic = useCallback(
    (text: string, afterSpeak?: () => void) => {
      setLastReply(text);
      if (mutedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        afterSpeak?.();
        return;
      }

      // Pause mic while Nour speaks so she never hears her own voice
      stopRecognition();
      setPhase('speaking');
      window.speechSynthesis.cancel();

      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'ar-EG';
      utt.rate = 1.03;
      utt.pitch = 1.08;

      const allVoices = window.speechSynthesis.getVoices();
      const chosen =
        allVoices.find((v) => v.voiceURI === selectedVoiceUri) ||
        pickBestFemaleArabicVoice(allVoices);
      if (chosen) {
        utt.voice = chosen;
        utt.lang = chosen.lang || 'ar-EG';
      }

      const done = () => {
        setPhase('idle');
        afterSpeak?.();
      };
      utt.onend = done;
      utt.onerror = done;

      window.speechSynthesis.speak(utt);
    },
    [selectedVoiceUri, stopRecognition],
  );

  const askNour = useCallback(
    async (userSpeech: string) => {
      const clean = userSpeech.trim();
      if (!clean) return;
      stopRecognition();
      setPhase('thinking');
      setLiveTranscript(clean);

      const userTurn: ChatTurn = { id: makeRequestId(), role: 'user', text: clean, ts: Date.now() };
      const nextHistory = [...turnsRef.current.slice(-10), userTurn];
      setTurns(nextHistory);

      let replyText = '';
      let action: string | null = null;

      try {
        // 1. Prefer computer bridge (uses saved Gemini key + live system state)
        if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
          const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/nour/chat`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${deck.pairing.token}`,
            },
            body: JSON.stringify({
              message: clean,
              history: nextHistory.slice(-8).map((t) => ({ role: t.role, text: t.text })),
              botName: botNameRef.current,
              liveContext,
            }),
          });
          const data = (await res.json()) as { ok: boolean; reply: string; action?: string | null };
          replyText = data.reply;
          action = data.action || null;
        } else if (ENV_GEMINI_KEY.length >= 12) {
          // 2. Direct Phone Mode (works anywhere on iPhone even without Mac/PC bridge!)
          const sys = `إنتي "${botNameRef.current}"، بنت مصرية ذكية ولطيفة ومساعدة صوتية جوه تطبيق DevDeck. اتكلمي دايماً بالعامية المصرية الطبيعية (جملة لتلات جمل، بدون أي نجوم أو رموز ماركداون أو إيموجي لأن كلامك هيتنطق بالصوت مباشرة). حالة التطبيق:\n${liveContext}`;
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: sys }] },
                contents: nextHistory.slice(-8).map((t) => ({
                  role: t.role === 'user' ? 'user' : 'model',
                  parts: [{ text: t.text }],
                })),
                generationConfig: {
                  temperature: 0.75,
                  maxOutputTokens: 240,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
            },
          );
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          replyText =
            data.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || '')
              .join(' ')
              .replace(/[*#_`~]/g, '')
              .trim() || 'معلش يا سيدي مسمعتش كويس، قولها تاني كده؟';
        } else {
          replyText = 'وصلني بالكمبيوتر أو ضيف مفتاح جيميناي في بي سي دكتور عشان أقدر أرد عليك وأتكلم معاك في كل حاجة.';
        }
      } catch {
        replyText = 'معلش الشبكة قطعت ثانية، جرب تكلمني تاني يا بطل.';
      }

      const modelTurn: ChatTurn = {
        id: makeRequestId(),
        role: 'model',
        text: replyText,
        ts: Date.now(),
      };
      setTurns((prev) => [...prev.slice(-14), modelTurn]);
      executeNourAction(action);

      speakArabic(replyText, () => {
        if (wakeWordRef.current) {
          startRecognitionRef.current('wake');
        } else if (followUpRef.current) {
          // Stay ready briefly if user wants hands-free conversation
          setPhase('idle');
        }
      });
    },
    [deck.bridgeBaseUrl, deck.pairing?.token, deck.status, executeNourAction, liveContext, speakArabic, stopRecognition],
  );

  const startRecognition = useCallback(
    (mode: 'wake' | 'active') => {
      if (typeof window === 'undefined') return;
      const w = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      };
      const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!Rec) {
        deck.showToast(false, 'Voice recognition requires Safari or Chrome');
        return;
      }

      stopRecognition();
      activeListeningRef.current = mode === 'active';
      setPhase(mode === 'active' ? 'listening' : 'wake_listening');
      setLiveTranscript('');

      const rec = new Rec();
      rec.lang = 'ar-EG';
      rec.continuous = mode === 'wake';
      rec.interimResults = true;

      rec.onresult = (ev) => {
        let full = '';
        let isFinal = false;
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          full += ev.results[i][0]?.transcript || '';
          if (ev.results[i].isFinal) isFinal = true;
        }
        const trimmed = full.trim();
        if (!trimmed) return;
        setLiveTranscript(trimmed);

        if (activeListeningRef.current) {
          if (isFinal) {
            activeListeningRef.current = false;
            void askNour(trimmed);
          }
          return;
        }

        // Wake-word detection mode: match "نور", "يا نور", "nour", or custom botName
        const nameEsc = escapeRegExp(botNameRef.current.trim() || 'نور');
        const wakeRe = new RegExp(`(?:يا\\s*)?(?:${nameEsc}|نور|nour|noor)\\b[,،:\\s]*(.*)`, 'i');
        const m = trimmed.match(wakeRe);
        if (m) {
          const afterWake = (m[1] || '').trim();
          if (isFinal && afterWake.length >= 2) {
            soundEngine.playSuccessChime();
            void askNour(afterWake);
          } else if (isFinal) {
            soundEngine.playSuccessChime();
            speakArabic('أيوة يا سيدي، سامعاك، اتفضل قول!', () => {
              startRecognitionRef.current('active');
            });
          }
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          setWakeWordOn(false);
          setPhase('idle');
          deck.showToast(false, 'Microphone permission denied');
        }
      };

      rec.onend = () => {
        if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return;
        if (wakeWordRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if (wakeWordRef.current && phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
              startRecognitionRef.current('wake');
            }
          }, 350);
        } else {
          setPhase('idle');
        }
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch {
        setPhase('idle');
      }
    },
    [askNour, deck, speakArabic, stopRecognition],
  );

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  useEffect(() => {
    return () => {
      stopRecognition();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopRecognition]);

  const handleOrbTap = () => {
    soundEngine.playClick();
    // Unlock iOS speechSynthesis on user gesture
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && phase === 'speaking') {
      window.speechSynthesis.cancel();
      setPhase('idle');
      if (wakeWordOn) startRecognition('wake');
      return;
    }
    if (phase === 'listening') {
      stopRecognition();
      setPhase(wakeWordOn ? 'wake_listening' : 'idle');
      if (wakeWordOn) startRecognition('wake');
      return;
    }
    startRecognition('active');
  };

  const toggleWakeWord = () => {
    soundEngine.playClick();
    if (wakeWordOn) {
      setWakeWordOn(false);
      stopRecognition();
      setPhase('idle');
    } else {
      setWakeWordOn(true);
      // Warm up speechSynthesis inside tap gesture for iOS Safari
      speakArabic(`أهلاً بيك! أنا ${botName}، نادي عليا في أي وقت وقول يا ${botName}.`, () => {
        startRecognition('wake');
      });
    }
  };

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
        ? `${botName} بتتكلم... (اضغط للإيقاف)`
        : phase === 'thinking'
          ? `${botName} بتفكر...`
          : phase === 'wake_listening'
            ? `مستنياك تقول «يا ${botName}»...`
            : `اضغط على الدايرة عشان تتكلم مع ${botName}`;

  return (
    <div className="screen-grid layout-nour">
      {/* LEFT: Reactive Voice Orb + Wake Word Control */}
      <div className="tile flex min-h-0 flex-col items-center justify-between gap-2 text-center">
        <div
          className="absolute top-0 left-0 h-[3px] w-full rounded-r-full"
          style={{ background: `linear-gradient(90deg, #f472b6, ${orbColor}, #22d3ee)` }}
        />

        {/* Top Row: Name + Wake Word Toggle */}
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#f472b6]" />
            <span className="disp text-[18px]">{botName} · Voice AI</span>
          </div>
          <button
            type="button"
            onClick={toggleWakeWord}
            className="flex h-7 items-center gap-1 rounded-full border px-2.5 text-[8.5px] font-extrabold uppercase"
            style={{
              background: wakeWordOn ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.05)',
              borderColor: wakeWordOn ? '#34d399' : 'rgba(255,255,255,0.12)',
              color: wakeWordOn ? '#34d399' : '#a1a1aa',
            }}
          >
            <Radio className={`h-3 w-3 ${wakeWordOn ? 'animate-pulse' : ''}`} />
            {wakeWordOn ? `«يا ${botName}» ON` : `Wake «يا ${botName}»`}
          </button>
        </div>

        {/* Center Glowing Interactive Voice Orb */}
        <div className="flex flex-col items-center justify-center gap-2">
          <motion.button
            type="button"
            onClick={handleOrbTap}
            whileTap={{ scale: 0.92 }}
            animate={{
              scale:
                phase === 'speaking'
                  ? [1, 1.09, 0.98, 1.06, 1]
                  : phase === 'listening'
                    ? [1, 1.06, 1]
                    : 1,
            }}
            transition={{
              repeat: phase === 'speaking' || phase === 'listening' ? Infinity : 0,
              duration: phase === 'speaking' ? 1.1 : 1.5,
            }}
            aria-label="Talk to Nour"
            className="relative grid h-24 w-24 place-items-center rounded-full border-2"
            style={{
              borderColor: orbColor,
              background: `radial-gradient(circle at 35% 30%, ${orbColor}55, #120d1d 72%)`,
              boxShadow: `0 0 36px ${orbColor}55, inset 0 0 22px ${orbColor}33`,
            }}
          >
            {phase === 'speaking' ? (
              <Square className="h-7 w-7 fill-current text-white" />
            ) : phase === 'listening' ? (
              <Mic className="h-8 w-8 text-[#22d3ee]" />
            ) : (
              <Mic className="h-8 w-8 text-white" />
            )}
          </motion.button>

          <div dir="rtl" className="text-[11px] font-extrabold text-white">
            {statusText}
          </div>
          {liveTranscript && (
            <div dir="rtl" className="max-w-[92%] truncate text-[9.5px] text-[#22d3ee]">
              «{liveTranscript}»
            </div>
          )}
        </div>

        {/* Bottom Controls: Voice Mute + Follow-up + Name */}
        <div className="flex w-full items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setMuted((m) => !m);
              if (!muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
              }
            }}
            className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-extrabold text-zinc-200"
          >
            {muted ? <VolumeX className="h-3 w-3 text-[#ff5d6c]" /> : <Volume2 className="h-3 w-3 text-[#34d399]" />}
            {muted ? 'Muted' : 'Voice ON'}
          </button>

          <button
            type="button"
            onClick={() => setHandsFreeFollowup((v) => !v)}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-bold text-zinc-300"
          >
            {handsFreeFollowup ? 'Auto-Talk: ON' : 'Auto-Talk: OFF'}
          </button>

          <button
            type="button"
            onClick={() => setShowSubtitles((v) => !v)}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-bold text-zinc-300"
          >
            {showSubtitles ? 'Subtitles: ON' : 'Audio Only'}
          </button>
        </div>
      </div>

      {/* RIGHT: Live Spoken Subtitles, Voice Settings & 1-Tap Egyptian Voice Prompts */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#f472b6]" />

        {/* Voice Selector & Custom Name */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={botName}
              onChange={(e) => {
                setBotName(e.target.value);
                try {
                  localStorage.setItem(STORAGE_NAME, e.target.value);
                } catch {
                  // Ignore
                }
              }}
              dir="rtl"
              aria-label="Assistant wake name"
              className="h-7 w-20 rounded-lg border border-white/10 bg-[#080a10] px-2 text-center text-[10px] font-extrabold text-[#f472b6] outline-none"
              placeholder="نور"
            />
            <select
              value={selectedVoiceUri}
              onChange={(e) => setSelectedVoiceUri(e.target.value)}
              aria-label="Arabic Female Voice"
              className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9px] text-zinc-200 outline-none"
            >
              {voices.length === 0 ? (
                <option value="">Default Arabic Female Voice (ar-EG)</option>
              ) : (
                voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))
              )}
            </select>
          </div>
          <button
            type="button"
            aria-label="Clear conversation"
            onClick={() => {
              soundEngine.playClick();
              setTurns([]);
              setLastReply(`أنا جاهزة يا سيدي، اسألني في أي حاجة!`);
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-zinc-400 hover:text-[#ff5d6c]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Live Spoken Subtitle / Conversation Stream */}
        <div
          dir="rtl"
          className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-right"
        >
          {!showSubtitles ? (
            <div className="grid h-full place-items-center text-center">
              <div className="space-y-1">
                <MicOff className="mx-auto h-5 w-5 text-zinc-600" />
                <div className="text-[10px] font-bold text-zinc-400">وضع الصوت فقط شغال</div>
              </div>
            </div>
          ) : turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <div className="text-[11px] font-extrabold text-[#f472b6]">{lastReply}</div>
              <div className="text-[9px] text-zinc-400">
                تقدري تتكلمي معايا عن المشروع، حالة اللابتوب، النت، أو ندردش في أي موضوع بالعامية المصرية!
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

        {/* Quick 1-Tap Spoken Starters (Triggers Real Voice Reply!) */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            'إيه أخبار اللابتوب والبطارية دلوقتي؟',
            'احكيلي إيه الجديد في مشروع DevDeck؟',
            'اعملي سكان للكمبيوتر وشوفي فيه مشاكل ولا لأ',
            'عايزين ندردش شوية يا نور، عاملة إيه؟',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              dir="rtl"
              onClick={() => void askNour(prompt)}
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
