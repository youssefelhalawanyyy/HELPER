'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const STORAGE_VOICE = 'devdeck.nour.voice.v2';

const NEURAL_FEMALE_VOICES = [
  { id: 'Leda', label: 'Leda · Cute Teen Girl (Default)' },
  { id: 'Zephyr', label: 'Zephyr · Bright Cheerful Girl' },
  { id: 'Aoede', label: 'Aoede · Warm Friendly Girl' },
  { id: 'Autonoe', label: 'Autonoe · Playful Young Girl' },
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pcm24kBase64ToWavBytes(pcmBase64: string): ArrayBuffer {
  const bin = atob(pcmBase64);
  const pcmLen = bin.length;
  const buf = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmLen, true);
  const out = new Uint8Array(buf, 44);
  for (let i = 0; i < pcmLen; i += 1) out[i] = bin.charCodeAt(i);
  return buf;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function directGeminiTts(text: string, voiceName: string): Promise<ArrayBuffer | null> {
  if (ENV_GEMINI_KEY.length < 12) return null;
  const styled = `Say the following in a cute, cheerful, expressive young Egyptian teen girl voice with a 100% fluent natural Cairene Egyptian Arabic accent, lively intonation, and natural pauses. Read ONLY the Arabic text below:\n\n${text}`;
  for (const model of ['gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: styled }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
          }),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
        }>;
      };
      const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) continue;
      if (/pcm|L16/i.test(inline.mimeType || '')) {
        return pcm24kBase64ToWavBytes(inline.data);
      }
      return base64ToArrayBuffer(inline.data);
    } catch {
      // Try next TTS model
    }
  }
  return null;
}

export function NourVoiceView({
  deck,
  onNavigate,
}: {
  deck: DevDeckState;
  onNavigate?: (view: DeckViewId) => void;
}) {
  const [botName, setBotName] = useState('نور');
  const [voiceName, setVoiceName] = useState<string>('Leda');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [liveCallOn, setLiveCallOn] = useState(false);
  const [wakeWordOn, setWakeWordOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [orbEnergy, setOrbEnergy] = useState(0);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  const liveCallRef = useRef(false);
  const wakeWordRef = useRef(false);
  const activeListeningRef = useRef(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  const botNameRef = useRef('نور');
  const voiceNameRef = useRef('Leda');
  const mutedRef = useRef(false);
  const abortReqRef = useRef<AbortController | null>(null);
  const restartTimerRef = useRef<number | null>(null);

  // Web Audio playback + real-time orb meter + Echo-Cancelled Barge-In VAD!
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const orbRafRef = useRef<number | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { liveCallRef.current = liveCallOn; }, [liveCallOn]);
  useEffect(() => { wakeWordRef.current = wakeWordOn; }, [wakeWordOn]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { botNameRef.current = botName; }, [botName]);
  useEffect(() => { voiceNameRef.current = voiceName; }, [voiceName]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    try {
      const savedName = localStorage.getItem(STORAGE_NAME);
      if (savedName) setBotName(savedName);
      const savedVoice = localStorage.getItem(STORAGE_VOICE);
      if (savedVoice) setVoiceName(savedVoice);
    } catch {
      // Ignore
    }
  }, []);

  const ensureAudioCtx = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const stopVad = useCallback(() => {
    if (vadRafRef.current) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (vadStreamRef.current) {
      vadStreamRef.current.getTracks().forEach((t) => t.stop());
      vadStreamRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (orbRafRef.current) {
      cancelAnimationFrame(orbRafRef.current);
      orbRafRef.current = null;
    }
    setOrbEnergy(0);
    if (playingSourceRef.current) {
      try {
        playingSourceRef.current.onended = null;
        playingSourceRef.current.stop();
      } catch {
        // Ignore
      }
      playingSourceRef.current = null;
    }
    stopVad();
  }, [stopVad]);

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

  // Real-time Barge-In Interruption: detect user speaking while Nour talks (with hardware AEC!)
  const startBargeInVad = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const ctx = await ensureAudioCtx();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (phaseRef.current !== 'speaking') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      vadStreamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let loudFrames = 0;

      const check = () => {
        if (phaseRef.current !== 'speaking') return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        // Sustained user speech above echo floor (~220ms) -> instant barge-in!
        if (rms > 0.065) {
          loudFrames += 1;
          if (loudFrames >= 12) {
            stopSpeaking();
            soundEngine.playDetent();
            startRecognitionRef.current('active');
            return;
          }
        } else {
          loudFrames = Math.max(0, loudFrames - 1);
        }
        vadRafRef.current = requestAnimationFrame(check);
      };
      vadRafRef.current = requestAnimationFrame(check);
    } catch {
      // Mic permission or AEC unavailable — orb tap still interrupts instantly
    }
  }, [ensureAudioCtx, stopSpeaking]);

  const playNeuralWav = useCallback(
    async (wavBuffer: ArrayBuffer | null, afterSpeak?: () => void) => {
      if (mutedRef.current || !wavBuffer) {
        setPhase('idle');
        afterSpeak?.();
        return;
      }
      try {
        stopRecognition();
        stopSpeaking();
        const ctx = await ensureAudioCtx();
        const decoded = await ctx.decodeAudioData(wavBuffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = decoded;

        // Real-time voice amplitude meter for glowing orb animation
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const freq = new Uint8Array(analyser.frequencyBinCount);
        const animateOrb = () => {
          if (playingSourceRef.current !== source) return;
          analyser.getByteFrequencyData(freq);
          let sum = 0;
          for (let i = 0; i < freq.length; i += 1) sum += freq[i];
          setOrbEnergy(Math.min(1, sum / (freq.length * 95)));
          orbRafRef.current = requestAnimationFrame(animateOrb);
        };

        playingSourceRef.current = source;
        setPhase('speaking');
        source.onended = () => {
          if (playingSourceRef.current === source) {
            playingSourceRef.current = null;
          }
          stopSpeaking();
          setPhase('idle');
          afterSpeak?.();
        };

        source.start(0);
        orbRafRef.current = requestAnimationFrame(animateOrb);
        // Arm hardware echo-cancelled barge-in interruption!
        void startBargeInVad();
      } catch {
        stopSpeaking();
        setPhase('idle');
        afterSpeak?.();
      }
    },
    [ensureAudioCtx, startBargeInVad, stopRecognition, stopSpeaking],
  );

  const liveContext = useMemo(() => {
    const p = deck.powerState;
    const d = deck.doctorReport;
    const n = deck.networkState;
    return [
      `الاتصال بالكمبيوتر: ${deck.status === 'connected' ? `متصل (${deck.hello?.hostname || 'Mac'})` : 'مباشر على الموبايل'}`,
      `التطبيق المفتوح: ${deck.activeApp.appName || 'غير معروف'}`,
      `المعالج: ${deck.stats.cpuPct}% · الرام: ${deck.stats.ramUsedGb}/${deck.stats.ramTotalGb} جيجا`,
      `البطارية: ${p.batteryPct || deck.stats.batteryPct}% (${p.isCharging ? 'بيشحن' : 'على البطارية'})${p.healthPct ? ` · صحة البطارية ${p.healthPct}%` : ''}`,
      `صحة الجهاز: ${d.score ? `${d.score}/100 (${d.grade})` : 'جاهز للفحص'}`,
      `الإنترنت: ${n.downMbps ? `تحميل ${n.downMbps} ميجا · بنج ${n.pingMs}ms` : 'جاهز للفحص'}`,
      `الفرع الحالي: ${deck.gitStatus.branch || 'main'}`,
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

  const askNour = useCallback(
    async (userSpeech: string) => {
      const clean = userSpeech.trim();
      if (!clean) return;

      // Interrupt anything currently playing or pending
      abortReqRef.current?.abort();
      stopSpeaking();
      stopRecognition();
      setPhase('thinking');
      setLiveTranscript(clean);

      const ctrl = new AbortController();
      abortReqRef.current = ctrl;

      const userTurn: ChatTurn = { id: makeRequestId(), role: 'user', text: clean, ts: Date.now() };
      const nextHistory = [...turnsRef.current.slice(-10), userTurn];
      setTurns(nextHistory);

      let replyText = '';
      let wavBuffer: ArrayBuffer | null = null;
      let action: string | null = null;

      try {
        if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
          const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/nour/chat`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${deck.pairing.token}`,
            },
            body: JSON.stringify({
              message: clean,
              history: nextHistory.slice(-8).map((t) => ({ role: t.role, text: t.text })),
              botName: botNameRef.current,
              voiceName: voiceNameRef.current,
              liveContext,
            }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            reply: string;
            audioBase64?: string;
            action?: string | null;
          };
          replyText = data.reply;
          action = data.action || null;
          if (data.audioBase64) {
            wavBuffer = base64ToArrayBuffer(data.audioBase64);
          }
        } else if (ENV_GEMINI_KEY.length >= 12) {
          const sys = `إنتي "${botNameRef.current}"، بنوتة مصرية شابة كيوت وذكية ودمك خفيف. اتكلمي بلهجة مصرية قاهرية 100% طبيعية وشبابية (جملة لتلات جمل، بدون أي نجوم أو ماركداون أو إيموجي). حالة التطبيق:\n${liveContext}`;
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
            {
              method: 'POST',
              signal: ctrl.signal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: sys }] },
                contents: nextHistory.slice(-8).map((t) => ({
                  role: t.role === 'user' ? 'user' : 'model',
                  parts: [{ text: t.text }],
                })),
                generationConfig: {
                  temperature: 0.85,
                  maxOutputTokens: 220,
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
          wavBuffer = await directGeminiTts(replyText, voiceNameRef.current);
        } else {
          replyText = 'وصلني بالكمبيوتر أو ضيف مفتاح جيميناي عشان أتكلم معاك بصوتي الحقيقي!';
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        replyText = 'معلش الشبكة هنجت ثانية، جرب تكلمني تاني يا بطل.';
      }

      if (ctrl.signal.aborted) return;

      const modelTurn: ChatTurn = {
        id: makeRequestId(),
        role: 'model',
        text: replyText,
        ts: Date.now(),
      };
      setTurns((prev) => [...prev.slice(-14), modelTurn]);
      executeNourAction(action);

      await playNeuralWav(wavBuffer, () => {
        if (liveCallRef.current) {
          // True ChatGPT/Gemini Live continuous loop: immediately listen for next turn!
          startRecognitionRef.current('active');
        } else if (wakeWordRef.current) {
          startRecognitionRef.current('wake');
        }
      });
    },
    [
      deck.bridgeBaseUrl,
      deck.pairing?.token,
      deck.status,
      executeNourAction,
      liveContext,
      playNeuralWav,
      stopRecognition,
      stopSpeaking,
    ],
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
            void askNour('يا نور');
          }
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          setLiveCallOn(false);
          setWakeWordOn(false);
          setPhase('idle');
          deck.showToast(false, 'Allow Microphone access to talk with Nour');
        }
      };

      rec.onend = () => {
        if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return;
        if (liveCallRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if (liveCallRef.current && phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
              startRecognitionRef.current('active');
            }
          }, 250);
        } else if (wakeWordRef.current) {
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
    [askNour, deck, stopRecognition],
  );

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  useEffect(() => {
    return () => {
      abortReqRef.current?.abort();
      stopRecognition();
      stopSpeaking();
    };
  }, [stopRecognition, stopSpeaking]);

  const handleOrbTap = async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    // Instant manual interrupt when Nour is speaking or thinking!
    if (phase === 'speaking' || phase === 'thinking') {
      abortReqRef.current?.abort();
      stopSpeaking();
      startRecognition('active');
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

  const toggleLiveCall = async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    if (liveCallOn) {
      setLiveCallOn(false);
      abortReqRef.current?.abort();
      stopSpeaking();
      stopRecognition();
      setPhase('idle');
    } else {
      setWakeWordOn(false);
      setLiveCallOn(true);
      startRecognition('active');
    }
  };

  const toggleWakeWord = async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    if (wakeWordOn) {
      setWakeWordOn(false);
      stopRecognition();
      setPhase('idle');
    } else {
      setLiveCallOn(false);
      setWakeWordOn(true);
      startRecognition('wake');
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
        ? `${botName} بتتكلم — قاطعها بصوتك أو اضغط في أي وقت`
        : phase === 'thinking'
          ? `${botName} بتجهز الرد...`
          : phase === 'wake_listening'
            ? `مستنياك تقول «يا ${botName}»...`
            : `ابدأ مكالمة لايف أو اضغط على الدايرة`;

  return (
    <div className="screen-grid layout-nour">
      {/* LEFT: Live Voice-Reactive Orb + Live Call & Wake Word Controls */}
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
            onClick={() => {
              soundEngine.playClick();
              const next = !muted;
              setMuted(next);
              if (next) stopSpeaking();
            }}
            className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[8.5px] font-extrabold text-zinc-200"
          >
            {muted ? <VolumeX className="h-3 w-3 text-[#ff5d6c]" /> : <Volume2 className="h-3 w-3 text-[#34d399]" />}
            {muted ? 'Muted' : 'Neural Voice'}
          </button>

          <span className="font-mono-tech text-[8px] text-zinc-400">
            Barge-In Interrupt Ready
          </span>

          <button
            type="button"
            onClick={() => setShowSubtitles((v) => !v)}
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
              aria-label="Wake word name"
              className="h-7 w-16 rounded-lg border border-white/10 bg-[#080a10] px-2 text-center text-[10px] font-extrabold text-[#f472b6] outline-none"
            />
            <select
              value={voiceName}
              onChange={(e) => {
                setVoiceName(e.target.value);
                try {
                  localStorage.setItem(STORAGE_VOICE, e.target.value);
                } catch {
                  // Ignore
                }
              }}
              aria-label="Neural Female Voice"
              className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9px] font-bold text-zinc-200 outline-none"
            >
              {NEURAL_FEMALE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            aria-label="Clear conversation"
            onClick={() => {
              soundEngine.playClick();
              setTurns([]);
            }}
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
              وضع المكالمة الصوتية فقط شغال — اتكلم في أي وقت!
            </div>
          ) : turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <div className="text-[11px] font-extrabold text-[#f472b6]">
                أهلاً يا سيدي! أنا {botName} — اضغط LIVE CALL عشان نتكلم زي شات جي بي تي وجيميناي لايف!
              </div>
              <div className="text-[9px] text-zinc-400">
                صوت بنت مصرية حقيقي بالذكاء الاصطناعي وتقدر تقاطعني في نص الكلام في أي لحظة.
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
              onClick={async () => {
                await ensureAudioCtx();
                void askNour(prompt);
              }}
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
