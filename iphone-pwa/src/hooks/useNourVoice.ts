'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeckViewId } from '@/components/shell/LeftNavRail';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

export type NourVoicePhase = 'idle' | 'wake_listening' | 'listening' | 'thinking' | 'speaking';

export interface NourChatTurn {
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
const STORAGE_VOICE = 'devdeck.nour.voice.v3';

export const NEURAL_FEMALE_VOICES = [
  { id: 'Aoede', label: 'Aoede · 24yo Friend (Locked)' },
  { id: 'Zephyr', label: 'Zephyr · Bright' },
  { id: 'Leda', label: 'Leda · Youthful' },
  { id: 'Autonoe', label: 'Autonoe · Energetic' },
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
  const styled = `Speak briskly, naturally, and effortlessly at a slightly fast conversational pace (no slow dragging or long pauses), like a warm 24-year-old Egyptian close friend chatting in fluent everyday Cairene Arabic:\n${text}`;
  for (const model of ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-lite-tts']) {
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

/**
 * Persistent top-level Nour Voice AI hook mounted in DeckShell so LIVE CALL & Wake Word
 * keep running seamlessly while swiping across every page in DevDeck.
 */
export function useNourVoice(deck: DevDeckState, onNavigate: (view: DeckViewId) => void) {
  const [botName, setBotNameState] = useState('نور');
  const [voiceName, setVoiceNameState] = useState<string>('Aoede');
  const [phase, setPhase] = useState<NourVoicePhase>('idle');
  const [liveCallOn, setLiveCallOn] = useState(false);
  const [wakeWordOn, setWakeWordOn] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [orbEnergy, setOrbEnergy] = useState(0);
  const [turns, setTurns] = useState<NourChatTurn[]>([]);
  const [showSubtitles, setShowSubtitles] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<NourVoicePhase>('idle');
  const liveCallRef = useRef(false);
  const wakeWordRef = useRef(false);
  const activeListeningRef = useRef(false);
  const turnsRef = useRef<NourChatTurn[]>([]);
  const botNameRef = useRef('نور');
  const voiceNameRef = useRef('Aoede');
  const mutedRef = useRef(false);
  const abortReqRef = useRef<AbortController | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const latestTranscriptRef = useRef('');
  const submittedTurnRef = useRef(false);

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
      if (savedName) setBotNameState(savedName);
      const savedVoice = localStorage.getItem(STORAGE_VOICE);
      if (savedVoice) setVoiceNameState(savedVoice);
    } catch {
      // Ignore
    }
  }, []);

  const setBotName = useCallback((v: string) => {
    setBotNameState(v);
    try {
      localStorage.setItem(STORAGE_NAME, v);
    } catch {
      // Ignore
    }
  }, []);

  const setVoiceName = useCallback((v: string) => {
    setVoiceNameState(v);
    try {
      localStorage.setItem(STORAGE_VOICE, v);
    } catch {
      // Ignore
    }
  }, []);

  const ensureAudioCtx = useCallback(async (): Promise<AudioContext> => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
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
      // Orb tap still interrupts instantly
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
        source.playbackRate.value = 1.12;

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
          if (playingSourceRef.current === source) playingSourceRef.current = null;
          stopSpeaking();
          setPhase('idle');
          afterSpeak?.();
        };

        source.start(0);
        orbRafRef.current = requestAnimationFrame(animateOrb);
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
        onNavigate('doctor');
        deck.sendEvent({ type: 'doctor:scan', payload: { requestId: makeRequestId() } });
      } else if (action === 'net_scan') {
        onNavigate('network');
        deck.sendEvent({ type: 'network:scan', payload: { requestId: makeRequestId() } });
      } else if (action === 'lock_screen') {
        deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } });
      } else if (action === 'caffeine_on') {
        deck.sendEvent({ type: 'hardware:caffeine', payload: { requestId: makeRequestId(), active: true } });
      } else if (action === 'caffeine_off') {
        deck.sendEvent({ type: 'hardware:caffeine', payload: { requestId: makeRequestId(), active: false } });
      } else if (action === 'open_antigravity') {
        onNavigate('antigravity');
      } else if (action === 'open_power') {
        onNavigate('power');
      } else if (action === 'open_doctor') {
        onNavigate('doctor');
      } else if (action === 'open_network') {
        onNavigate('network');
      }
    },
    [deck, onNavigate],
  );

  const askNour = useCallback(
    async (userSpeech: string) => {
      const clean = userSpeech.trim();
      if (!clean) return;

      abortReqRef.current?.abort();
      stopSpeaking();
      stopRecognition();
      setPhase('thinking');
      setLiveTranscript(clean);

      const ctrl = new AbortController();
      abortReqRef.current = ctrl;

      const userTurn: NourChatTurn = { id: makeRequestId(), role: 'user', text: clean, ts: Date.now() };
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
          if (data.audioBase64) wavBuffer = base64ToArrayBuffer(data.audioBase64);
        } else if (ENV_GEMINI_KEY.length >= 12) {
          const sys = `إنتي "${botNameRef.current}"، بنت مصرية عندك 24 سنة وصاحبته المقربة جداً. اتكلمي بلهجة قاهرية طبيعية وهادية ومباشرة من غير أي كليشيهات أو أوفر (ممنوع يا قمر/يا سيدي/يا بطل/فصحى). خلي ردك جملة أو جملتين بالكتير ومن غير نجوم أو إيموجي. حالة الجهاز:\n${liveContext}`;
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
                  temperature: 0.78,
                  maxOutputTokens: 95,
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
              .trim() || 'معلش يا قمر مسمعتش كويس، قولها تاني كده؟';
          wavBuffer = await directGeminiTts(replyText, voiceNameRef.current);
        } else {
          replyText = 'وصلني بالكمبيوتر أو ضيف مفتاح جيميناي عشان أتكلم معاك بصوتي الحقيقي!';
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        replyText = 'معلش الشبكة هنجت ثانية، قول تاني وأنا سامعاك!';
      }

      if (ctrl.signal.aborted) return;

      const modelTurn: NourChatTurn = {
        id: makeRequestId(),
        role: 'model',
        text: replyText,
        ts: Date.now(),
      };
      setTurns((prev) => [...prev.slice(-14), modelTurn]);
      executeNourAction(action);

      await playNeuralWav(wavBuffer, () => {
        if (liveCallRef.current) {
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
      latestTranscriptRef.current = '';
      submittedTurnRef.current = false;
      setPhase(mode === 'active' ? 'listening' : 'wake_listening');
      setLiveTranscript('');

      const rec = new Rec();
      rec.lang = 'ar-EG';
      rec.continuous = mode === 'wake';
      rec.interimResults = true;

      const submitCaptured = (text: string) => {
        const clean = text.trim();
        if (!clean || submittedTurnRef.current) return;
        submittedTurnRef.current = true;
        activeListeningRef.current = false;
        latestTranscriptRef.current = '';
        if (silenceTimerRef.current) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        soundEngine.playDetent();
        void askNour(clean);
      };

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
        latestTranscriptRef.current = trimmed;

        if (activeListeningRef.current) {
          if (isFinal) {
            submitCaptured(trimmed);
            return;
          }
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            if (activeListeningRef.current && latestTranscriptRef.current) {
              submitCaptured(latestTranscriptRef.current);
            }
          }, 550);
          return;
        }

        const nameEsc = escapeRegExp(botNameRef.current.trim() || 'نور');
        const wakeRe = new RegExp(`(?:يا\\s*)?(?:${nameEsc}|نور|nour|noor)\\b[,،:\\s]*(.*)`, 'i');
        const m = trimmed.match(wakeRe);
        if (m) {
          const afterWake = (m[1] || '').trim();
          if (isFinal && afterWake.length >= 2) {
            soundEngine.playSuccessChime();
            submitCaptured(afterWake);
          } else if (isFinal) {
            soundEngine.playSuccessChime();
            submitCaptured('يا نور');
          } else {
            if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = window.setTimeout(() => {
              soundEngine.playSuccessChime();
              submitCaptured(afterWake.length >= 2 ? afterWake : 'يا نور');
            }, 550);
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
        if (activeListeningRef.current && latestTranscriptRef.current && !submittedTurnRef.current) {
          submitCaptured(latestTranscriptRef.current);
          return;
        }
        if (liveCallRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if (liveCallRef.current && phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
              startRecognitionRef.current('active');
            }
          }, 90);
        } else if (wakeWordRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if (wakeWordRef.current && phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
              startRecognitionRef.current('wake');
            }
          }, 300);
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

  const handleOrbTap = useCallback(async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
      abortReqRef.current?.abort();
      stopSpeaking();
      startRecognition('active');
      return;
    }
    if (phaseRef.current === 'listening') {
      stopRecognition();
      setPhase(wakeWordRef.current ? 'wake_listening' : 'idle');
      if (wakeWordRef.current) startRecognition('wake');
      return;
    }
    startRecognition('active');
  }, [ensureAudioCtx, startRecognition, stopRecognition, stopSpeaking]);

  const toggleLiveCall = useCallback(async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    if (liveCallRef.current) {
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
  }, [ensureAudioCtx, startRecognition, stopRecognition, stopSpeaking]);

  const toggleWakeWord = useCallback(async () => {
    soundEngine.playClick();
    await ensureAudioCtx();
    if (wakeWordRef.current) {
      setWakeWordOn(false);
      stopRecognition();
      setPhase('idle');
    } else {
      setLiveCallOn(false);
      setWakeWordOn(true);
      startRecognition('wake');
    }
  }, [ensureAudioCtx, startRecognition, stopRecognition]);

  const toggleMute = useCallback(() => {
    soundEngine.playClick();
    setMutedState((prev) => {
      const next = !prev;
      if (next) stopSpeaking();
      return next;
    });
  }, [stopSpeaking]);

  const clearTurns = useCallback(() => {
    soundEngine.playClick();
    setTurns([]);
  }, []);

  const triggerPrompt = useCallback(
    async (prompt: string) => {
      await ensureAudioCtx();
      void askNour(prompt);
    },
    [askNour, ensureAudioCtx],
  );

  return {
    botName,
    setBotName,
    voiceName,
    setVoiceName,
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
  };
}

export type NourVoiceController = ReturnType<typeof useNourVoice>;
