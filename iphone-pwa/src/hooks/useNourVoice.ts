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

const CLIENT_TEXT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
];
let clientTextCursor = 0;
const clientTextCooldown = new Map<string, number>();

let clientTtsCursor = 0;
const clientTtsCooldown = new Map<string, number>();

const FEMALE_ARABIC_HINTS = /salma|mariam|laila|hoda|amina|noura|rana|sara|fatima|zahra|female|سلمى|مريم|ليلى|هدى/i;
const MALE_ARABIC_HINTS = /majed|tarik|naayf|maged|hamdan|shakir|male|ماجد|طارق|نايف/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArabicForEchoCheck(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether heard transcript while Nour is speaking is just speaker echo of her own voice
 * rather than the user interrupting her.
 */
function isLikelySelfEcho(heard: string, spoken: string): boolean {
  if (!spoken) return false;
  const h = normalizeArabicForEchoCheck(heard);
  const s = normalizeArabicForEchoCheck(spoken);
  if (!h || h.length < 2) return true;
  if (s.includes(h)) return true;
  const words = h.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return true;
  const matched = words.filter((w) => s.includes(w)).length;
  return matched / words.length >= 0.72;
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

async function directClientTts(text: string): Promise<ArrayBuffer | null> {
  if (ENV_GEMINI_KEY.length < 12) return null;
  const styled = `Speak briskly and naturally like a warm 24-year-old Egyptian close friend from Cairo:\n${text}`;
  const models = ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
  const start = clientTtsCursor % models.length;
  clientTtsCursor += 1;
  const now = Date.now();

  for (let i = 0; i < models.length; i += 1) {
    const model = models[(start + i) % models.length];
    if ((clientTtsCooldown.get(model) || 0) > now) continue;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 3600);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: styled }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
              },
            },
          }),
        },
      );
      window.clearTimeout(t);
      if (res.status === 429) {
        clientTtsCooldown.set(model, Date.now() + 50_000);
        continue;
      }
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
      window.clearTimeout(t);
    }
  }
  return null;
}

function speakBrowserFemaleFallback(text: string, onDone: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onDone();
    return;
  }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ar-EG';
  utt.rate = 1.1;
  utt.pitch = 1.12;
  const voices = window.speechSynthesis.getVoices();
  const arVoices = voices.filter((v) => /^ar/i.test(v.lang));
  const best =
    arVoices.find((v) => /ar[-_]eg/i.test(v.lang) && !MALE_ARABIC_HINTS.test(v.name)) ||
    arVoices.find((v) => FEMALE_ARABIC_HINTS.test(v.name)) ||
    arVoices.find((v) => !MALE_ARABIC_HINTS.test(v.name));
  if (best) {
    utt.voice = best;
    utt.lang = best.lang || 'ar-EG';
  }
  utt.onend = onDone;
  utt.onerror = onDone;
  window.speechSynthesis.speak(utt);
}

/**
 * Persistent full-duplex Nour Voice AI hook mounted in DeckShell:
 * - Instant ~800ms total response via pre-warmed ar-EG-SalmaNeural MP3 on bridge
 * - Unlimited turns for multi-hour continuous Live Calls (zero 3-turn TTS quota stops!)
 * - Real-time interruption: start talking while Nour is speaking -> she immediately pauses,
 *   waits for you to finish your full sentence, then answers right away!
 */
export function useNourVoice(deck: DevDeckState, onNavigate: (view: DeckViewId) => void) {
  const [botName, setBotNameState] = useState('نور');
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
  const mutedRef = useRef(false);
  const abortReqRef = useRef<AbortController | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const latestTranscriptRef = useRef('');
  const submittedTurnRef = useRef(false);
  const currentSpokenTextRef = useRef('');
  const requestSeqRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const orbRafRef = useRef<number | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { liveCallRef.current = liveCallOn; }, [liveCallOn]);
  useEffect(() => { wakeWordRef.current = wakeWordOn; }, [wakeWordOn]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { botNameRef.current = botName; }, [botName]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    try {
      const savedName = localStorage.getItem(STORAGE_NAME);
      if (savedName) setBotNameState(savedName);
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

  const stopSpeaking = useCallback(() => {
    currentSpokenTextRef.current = '';
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
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

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

  const playReplyAudio = useCallback(
    async (audioBuffer: ArrayBuffer | null, replyText: string, afterSpeak?: () => void) => {
      if (mutedRef.current) {
        setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
        afterSpeak?.();
        return;
      }

      stopSpeaking();
      currentSpokenTextRef.current = replyText;

      // Ensure continuous duplex listener stays armed WHILE she speaks so user can interrupt anytime!
      if ((liveCallRef.current || wakeWordRef.current) && !recRef.current) {
        startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
      }

      if (audioBuffer && audioBuffer.byteLength > 128) {
        try {
          const ctx = await ensureAudioCtx();
          const decoded = await ctx.decodeAudioData(audioBuffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.playbackRate.value = 1.04;

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
            setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
            afterSpeak?.();
          };

          source.start(0);
          orbRafRef.current = requestAnimationFrame(animateOrb);
          return;
        } catch {
          // Fall through to guaranteed female browser fallback
        }
      }

      // Guaranteed fallback (e.g. unpaired iPhone when Gemini preview TTS quota is exhausted)
      // -> NEVER leaves user with silent text!
      setPhase('speaking');
      speakBrowserFemaleFallback(replyText, () => {
        stopSpeaking();
        setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
        afterSpeak?.();
      });
    },
    [ensureAudioCtx, stopSpeaking],
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

      const mySeq = ++requestSeqRef.current;
      abortReqRef.current?.abort();
      stopSpeaking();
      setPhase('thinking');
      setLiveTranscript('');

      const ctrl = new AbortController();
      abortReqRef.current = ctrl;

      const userTurn: NourChatTurn = { id: makeRequestId(), role: 'user', text: clean, ts: Date.now() };
      const nextHistory = [...turnsRef.current.slice(-24), userTurn];
      setTurns(nextHistory);

      let replyText = '';
      let audioBuffer: ArrayBuffer | null = null;
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
              history: nextHistory.slice(-16).map((t) => ({ role: t.role, text: t.text })),
              botName: botNameRef.current,
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
          if (data.audioBase64) audioBuffer = base64ToArrayBuffer(data.audioBase64);
        } else if (ENV_GEMINI_KEY.length >= 12) {
          const sys = `إنتي "${botNameRef.current}"، بنت مصرية عندك 24 سنة وصاحبته المقربة جداً. اتكلمي بلهجة قاهرية طبيعية وهادية ومباشرة من غير أي كليشيهات أو أوفر (ممنوع يا قمر/يا سيدي/يا بطل/فصحى). خلي ردك جملة أو جملتين بالكتير ومن غير نجوم أو إيموجي. حالة الجهاز:\n${liveContext}`;
          const now = Date.now();
          const start = clientTextCursor % CLIENT_TEXT_MODELS.length;
          clientTextCursor += 1;

          for (let i = 0; i < CLIENT_TEXT_MODELS.length; i += 1) {
            const m = CLIENT_TEXT_MODELS[(start + i) % CLIENT_TEXT_MODELS.length];
            if ((clientTextCooldown.get(m) || 0) > now) continue;
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
              {
                method: 'POST',
                signal: ctrl.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: sys }] },
                  contents: nextHistory.slice(-14).map((t) => ({
                    role: t.role === 'user' ? 'user' : 'model',
                    parts: [{ text: t.text }],
                  })),
                  generationConfig: {
                    temperature: 0.78,
                    maxOutputTokens: 80,
                    ...(m.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                  },
                }),
              },
            );
            if (res.status === 429) {
              clientTextCooldown.set(m, Date.now() + 35_000);
              continue;
            }
            if (!res.ok) continue;
            const data = (await res.json()) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const txt = data.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || '')
              .join(' ')
              .replace(/[*#_`~]/g, '')
              .trim();
            if (txt) {
              replyText = txt;
              break;
            }
          }
          if (!replyText) replyText = 'مسمعتكش كويس، قولها تاني كده؟';
          audioBuffer = await directClientTts(replyText);
        } else {
          replyText = 'وصلني بالكمبيوتر أو ضيف مفتاح جيميناي عشان نتكلم سوا!';
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        replyText = 'النت قطع ثانية، قول تاني كده؟';
      }

      if (ctrl.signal.aborted || mySeq !== requestSeqRef.current) return;

      const modelTurn: NourChatTurn = {
        id: makeRequestId(),
        role: 'model',
        text: replyText,
        ts: Date.now(),
      };
      setTurns((prev) => [...prev.slice(-30), modelTurn]);
      executeNourAction(action);

      await playReplyAudio(audioBuffer, replyText, () => {
        if (mySeq !== requestSeqRef.current) return;
        submittedTurnRef.current = false;
        latestTranscriptRef.current = '';
        if (liveCallRef.current) {
          activeListeningRef.current = true;
          setPhase('listening');
          if (!recRef.current) startRecognitionRef.current('active');
        } else if (wakeWordRef.current) {
          activeListeningRef.current = false;
          setPhase('wake_listening');
          if (!recRef.current) startRecognitionRef.current('wake');
        }
      });
    },
    [
      deck.bridgeBaseUrl,
      deck.pairing?.token,
      deck.status,
      executeNourAction,
      liveContext,
      playReplyAudio,
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
      if (phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
        setPhase(mode === 'active' ? 'listening' : 'wake_listening');
      }
      setLiveTranscript('');

      const rec = new Rec();
      rec.lang = 'ar-EG';
      // Keep mic stream continuous during Live Call & Wake Word so user can interrupt mid-sentence!
      rec.continuous = liveCallRef.current || mode === 'wake';
      rec.interimResults = true;
      let consumedIndex = 0;

      const submitCaptured = (text: string) => {
        const clean = text.trim();
        if (!clean || submittedTurnRef.current) return;
        submittedTurnRef.current = true;
        latestTranscriptRef.current = '';
        if (silenceTimerRef.current) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        soundEngine.playDetent();
        void askNour(clean);
      };

      rec.onresult = (ev) => {
        const startIdx = Math.max(ev.resultIndex, consumedIndex);
        let chunk = '';
        let hasFinal = false;
        for (let i = startIdx; i < ev.results.length; i += 1) {
          chunk += ev.results[i][0]?.transcript || '';
          if (ev.results[i].isFinal) {
            hasFinal = true;
            consumedIndex = i + 1;
          }
        }
        const trimmed = chunk.trim();
        if (!trimmed) return;

        // REAL-TIME BARGE-IN: If Nour is currently speaking or thinking and YOU start talking:
        if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
          if (phaseRef.current === 'speaking' && isLikelySelfEcho(trimmed, currentSpokenTextRef.current)) {
            return;
          }
          // Immediately cut off her speech/pending request & WAIT for you to finish speaking!
          requestSeqRef.current += 1;
          abortReqRef.current?.abort();
          stopSpeaking();
          submittedTurnRef.current = false;
          activeListeningRef.current = true;
          setPhase('listening');
        }

        setLiveTranscript(trimmed);
        latestTranscriptRef.current = trimmed;

        if (activeListeningRef.current || liveCallRef.current) {
          // Wait until user pauses speaking (620ms silence after last word, or 320ms after final)
          // so if user pauses briefly mid-thought while interrupting, we wait for their whole sentence,
          // then answer immediately!
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          const waitMs = hasFinal ? 280 : 620;
          silenceTimerRef.current = window.setTimeout(() => {
            const pending = latestTranscriptRef.current || trimmed;
            if (pending && !submittedTurnRef.current) {
              submitCaptured(pending);
            }
          }, waitMs);
          return;
        }

        const nameEsc = escapeRegExp(botNameRef.current.trim() || 'نور');
        const wakeRe = new RegExp(`(?:يا\\s*)?(?:${nameEsc}|نور|nour|noor)\\b[,،:\\s]*(.*)`, 'i');
        const m = trimmed.match(wakeRe);
        if (m) {
          const afterWake = (m[1] || '').trim();
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            soundEngine.playSuccessChime();
            submitCaptured(afterWake.length >= 2 ? afterWake : 'يا نور');
          }, hasFinal ? 250 : 600);
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
        recRef.current = null;
        // Flush any buffered speech on iOS Safari when recognition ends naturally
        if (
          (activeListeningRef.current || liveCallRef.current) &&
          latestTranscriptRef.current &&
          !submittedTurnRef.current &&
          phaseRef.current !== 'thinking' &&
          phaseRef.current !== 'speaking'
        ) {
          submitCaptured(latestTranscriptRef.current);
          return;
        }
        // Keep Live Call / Wake Word alive continuously for hours!
        if (liveCallRef.current || wakeWordRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if ((liveCallRef.current || wakeWordRef.current) && !recRef.current) {
              startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
            }
          }, 120);
        } else if (phaseRef.current !== 'thinking' && phaseRef.current !== 'speaking') {
          setPhase('idle');
        }
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch {
        recRef.current = null;
      }
    },
    [askNour, deck, stopRecognition, stopSpeaking],
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
      requestSeqRef.current += 1;
      abortReqRef.current?.abort();
      stopSpeaking();
      submittedTurnRef.current = false;
      activeListeningRef.current = true;
      setPhase('listening');
      if (!recRef.current) startRecognition('active');
      return;
    }
    if (phaseRef.current === 'listening' && !liveCallRef.current) {
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
      requestSeqRef.current += 1;
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

  // Multi-hour self-healing watchdog: guarantees mic stays armed for hours in Live Call / Wake Word
  useEffect(() => {
    if (!liveCallOn && !wakeWordOn) return;
    const id = window.setInterval(() => {
      if (!recRef.current && phaseRef.current !== 'thinking') {
        startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [liveCallOn, wakeWordOn]);

  return {
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
  };
}

export type NourVoiceController = ReturnType<typeof useNourVoice>;
