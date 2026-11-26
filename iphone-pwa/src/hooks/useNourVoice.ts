'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeckViewId } from '@/components/shell/LeftNavRail';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import type {ActivityWindow} from '../../../shared/activity';
import { localNourCommand } from '@/lib/nourCommands';
import { bridgeRequest } from '@/lib/bridgeRequest';
import { soundEngine } from '@/lib/soundEngine';

export type NourVoicePhase = 'idle' | 'wake_listening' | 'listening' | 'thinking' | 'speaking';

export interface NourChatTurn {
  id: string;
  role: 'user' | 'model';
  localOnly?: boolean;
  evidence?:{title:string;detail:string;ts:number}[];
  volume?:number;
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

const CLIENT_TEXT_MODELS: Array<{ id: string; thinkZero: boolean }> = [
  { id: 'gemini-3.5-flash-lite', thinkZero: false },
  { id: 'gemini-3.5-flash', thinkZero: true },
  { id: 'gemini-flash-lite-latest', thinkZero: false },
];
const clientTextCooldown = new Map<string, number>();

const CLIENT_AOEDE_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];
let clientTtsCursor = 0;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArabicForEchoCheck(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySelfEcho(heard: string, spoken: string): boolean {
  if (!spoken) return false;
  const h = normalizeArabicForEchoCheck(heard);
  const s = normalizeArabicForEchoCheck(spoken);
  if (!h || h.length < 2) return true;
  if (s.includes(h)) return true;
  const words = h.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return true;
  const matched = words.filter((w) => s.includes(w)).length;
  return matched / words.length >= 0.68;
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

async function directClientAoedeTts(text: string): Promise<{ buffer: ArrayBuffer; mime: string } | null> {
  if (ENV_GEMINI_KEY.length < 12) return null;

  for (let pass = 0; pass < 3; pass += 1) {
    const start = clientTtsCursor % CLIENT_AOEDE_MODELS.length;
    clientTtsCursor += 1;

    for (let i = 0; i < CLIENT_AOEDE_MODELS.length; i += 1) {
      const model = CLIENT_AOEDE_MODELS[(start + i) % CLIENT_AOEDE_MODELS.length];
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 7000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
          {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text }] }],
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
        if (!res.ok) continue;
        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
          }>;
        };
        const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inline?.data) continue;
        if (/pcm|L16/i.test(inline.mimeType || '')) {
          return { buffer: pcm24kBase64ToWavBytes(inline.data), mime: 'audio/wav' };
        }
        return { buffer: base64ToArrayBuffer(inline.data), mime: inline.mimeType || 'audio/wav' };
      } catch {
        window.clearTimeout(t);
      }
    }

    if (pass < 2) {
      await new Promise((r) => window.setTimeout(r, 850));
    }
  }
  return null;
}

export function useNourVoice(deck: DevDeckState, onNavigate: (view: DeckViewId) => void, privateDisplay=false) {
  const [botName, setBotNameState] = useState('نور');
  const [phase, setPhase] = useState<NourVoicePhase>('idle');
  const [liveCallOn, setLiveCallOn] = useState(false);
  const [wakeWordOn, setWakeWordOn] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [orbEnergy, setOrbEnergy] = useState(0);
  const [turns, setTurns] = useState<NourChatTurn[]>([]);
  const [spokenAlerts, setSpokenAlerts] = useState(false);
  useEffect(() => {
    setSpokenAlerts(localStorage.getItem('devdeck.nour.alerts') === 'on');
  }, []);
  const toggleAlerts = () => {
    const next = !spokenAlerts;
    localStorage.setItem('devdeck.nour.alerts', next ? 'on' : 'off');
    setSpokenAlerts(next);
  };
  const [showSubtitles, setShowSubtitles] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<NourVoicePhase>('idle');
  const liveCallRef = useRef(false);
  const wakeWordRef = useRef(false);
  const activeListeningRef = useRef(false);
  const turnsRef = useRef<NourChatTurn[]>([]);
  const botNameRef = useRef('نور');
  const nativeSpeech = useRef<SpeechSynthesisUtterance | null>(null);
  const mutedRef = useRef(false);
  const abortReqRef = useRef<AbortController | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const latestTranscriptRef = useRef('');
  const submittedTurnRef = useRef(false);
  const lastSubmittedRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });
  const currentSpokenTextRef = useRef('');
  const requestSeqRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const htmlAudioUrlRef = useRef<string | null>(null);
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
    if (!htmlAudioRef.current && typeof Audio !== 'undefined') {
      const el = new Audio();
      el.setAttribute('playsinline', '');
      htmlAudioRef.current = el;
    }
    return audioCtxRef.current;
  }, []);

  const stopSpeaking = useCallback(() => {
    if (nativeSpeech.current) {
      nativeSpeech.current.onend = nativeSpeech.current.onerror = null;
      nativeSpeech.current = null;
      window.speechSynthesis.cancel();
    }
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
    if (htmlAudioRef.current) {
      try {
        htmlAudioRef.current.onended = null;
        htmlAudioRef.current.onerror = null;
        htmlAudioRef.current.pause();
        htmlAudioRef.current.removeAttribute('src');
      } catch {
        // Ignore
      }
    }
    if (htmlAudioUrlRef.current) {
      URL.revokeObjectURL(htmlAudioUrlRef.current);
      htmlAudioUrlRef.current = null;
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
        recRef.current.onresult = null;
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
    async (
      audioBuffer: ArrayBuffer | null,
      audioMime: string,
      replyText: string,
      afterSpeak?: () => void,
    ) => {
      if (!mutedRef.current && !audioBuffer && 'speechSynthesis' in window && replyText) {
        stopSpeaking();
        const utterance = new SpeechSynthesisUtterance(replyText);
        nativeSpeech.current = utterance;
        utterance.lang = /[ء-ي]/.test(replyText) ? 'ar-EG' : 'en-US';
        currentSpokenTextRef.current = replyText;
        setPhase('speaking');
        utterance.onend = utterance.onerror = () => {
          nativeSpeech.current = null;
          setPhase('idle');
          afterSpeak?.();
        };
        window.speechSynthesis.speak(utterance);
        return;
      }
      if (mutedRef.current || !audioBuffer || audioBuffer.byteLength < 128) {
        setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
        afterSpeak?.();
        return;
      }

      stopSpeaking();
      currentSpokenTextRef.current = replyText;

      // Start fresh barge-in listener while she talks so talking over her stops her & listens!
      if ((liveCallRef.current || wakeWordRef.current) && !recRef.current) {
        startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
      }

      // 1. Pure 1.0x WebAudio playback (zero pitch/speed distortion + real-time orb meter)
      try {
        const ctx = await ensureAudioCtx();
        const decoded = await ctx.decodeAudioData(audioBuffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.playbackRate.value = 1.0;

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
        // 2. Native HTMLAudioElement fallback for Safari MP3 streams (NEVER uses robotic speechSynthesis!)
      }

      try {
        await ensureAudioCtx();
        const el = htmlAudioRef.current || new Audio();
        htmlAudioRef.current = el;
        const blob = new Blob([audioBuffer], { type: audioMime || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        htmlAudioUrlRef.current = url;
        el.src = url;
        el.playbackRate = 1.0;
        setPhase('speaking');
        setOrbEnergy(0.45);
        const finish = () => {
          stopSpeaking();
          setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
          afterSpeak?.();
        };
        el.onended = finish;
        el.onerror = finish;
        await el.play();
      } catch {
        stopSpeaking();
        setPhase(liveCallRef.current ? 'listening' : wakeWordRef.current ? 'wake_listening' : 'idle');
        afterSpeak?.();
      }
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

      // Normalized Arabic deduplication guard: prevents any duplicate or split re-send within 5s!
      const normClean = normalizeArabicForEchoCheck(clean);
      const nowTs = Date.now();
      if (
        normClean &&
        normClean === lastSubmittedRef.current.text &&
        nowTs - lastSubmittedRef.current.ts < 5000
      ) {
        return;
      }
      lastSubmittedRef.current = { text: normClean, ts: nowTs };

      const mySeq = ++requestSeqRef.current;
      abortReqRef.current?.abort();
      stopSpeaking();
      // Cleanly close previous recognition utterance so buffered results can NEVER re-fire a 2nd time!
      stopRecognition();
      setPhase('thinking');
      setLiveTranscript('');

      const ctrl = new AbortController();
      abortReqRef.current = ctrl;

      const userTurn: NourChatTurn = { id: makeRequestId(), role: 'user', text: clean, ts: nowTs };
      const nextHistory = [...turnsRef.current.slice(-24), userTurn];
      setTurns(nextHistory);

      let replyText = '';
      let audioBuffer: ArrayBuffer | null = null;
      let audioMime = 'audio/wav';
      let action: string | null = null;

      let evidence:NourChatTurn['evidence'];
      let volume:number|undefined;
      try {
        const historyIntent=/what(?:.s| has)? changed|what happened|(?:ايه|إيه|ايش|ماذا).*(?:حصل|اتغير|تغير|حدث)/i.test(clean);
        const volumeIntent=/(?:volume|صوت)/i.test(clean)&&/(?:half|النص|نص|50%|٥٠)/i.test(clean);
        const local=historyIntent||volumeIntent?null:localNourCommand(clean,deck,onNavigate);
        if(historyIntent){
          userTurn.localOnly=true;
          const data=await bridgeRequest<ActivityWindow>(deck,'activity?minutes=10',undefined,ctrl.signal);
          evidence=data.events.slice(-3).reverse().map(e=>({title:e.title,detail:e.kind+' · '+new Date(e.ts).toLocaleTimeString(),ts:e.ts}));
          const peak=data.readings.filter(r=>r.heat!=null).sort((a,b)=>b.heat!-a.heat!)[0];
          const arabic=/[ء-ي]/.test(clean);
          if(peak)evidence.push({title:arabic?'أعلى حرارة كانت '+peak.heat+' درجة':'Peak CPU temperature was '+peak.heat+' °C',detail:new Date(peak.ts).toLocaleTimeString()+' · '+(peak.cpu??'—')+'% CPU · '+(peak.rpm??'—')+' RPM · '+peak.apps.join(', '),ts:peak.ts});
          replyText=evidence.length?(arabic?'آخر عشر دقايق: ':'Last ten minutes: ')+evidence.map(e=>e.title).join('. '):(arabic?'مفيش أحداث مسجلة آخر عشر دقايق.':'No events were recorded in the last ten minutes.');
        }else if(volumeIntent){
          userTurn.localOnly=true;
          const result=await bridgeRequest<{value:number}>(deck,'volume',{value:50},ctrl.signal);
          volume=result.value;replyText=/[ء-ي]/.test(clean)?'الصوت دلوقتي '+volume+' في المية.':'Volume set to '+volume+'%.';
        }else if (local !== null) {
          userTurn.localOnly = true;
          replyText = local;
        } else if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
          const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/nour/chat`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${deck.pairing.token}`,
            },
            body: JSON.stringify({
              message: clean,
              history: nextHistory
                .filter((t) => !t.localOnly)
                .slice(-16)
                .map((t) => ({ role: t.role, text: t.text })),
              botName: botNameRef.current,
              liveContext,
            }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            reply: string;
            audioBase64?: string;
            audioMime?: string;
            action?: string | null;
          };
          replyText = data.reply;
          action = data.action || null;
          audioMime = data.audioMime || 'audio/wav';
          if (data.audioBase64) audioBuffer = base64ToArrayBuffer(data.audioBase64);
        } else if (ENV_GEMINI_KEY.length >= 12) {
          const sys = `إنتي "${botNameRef.current}"، بنت مصرية قاهرية عندك 24 سنة وصاحبته المقربة جداً. اتكلمي عامية مصرية قاهرية صافية 100% بتشكيل خفيف على الكلمات المصرية (زي إزَّيَّك، عَامِل إيه، بُص بقى، دِلوَقتي) ومن غير أي فصحى أو كليشيهات. خلي ردك جملة أو جملتين بالكتير ومن غير نجوم أو إيموجي. حالة الجهاز:\n${liveContext}`;
          const now = Date.now();
          for (let i = 0; i < CLIENT_TEXT_MODELS.length; i += 1) {
            const spec = CLIENT_TEXT_MODELS[i];
            if ((clientTextCooldown.get(spec.id) || 0) > now) continue;
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${spec.id}:generateContent?key=${encodeURIComponent(ENV_GEMINI_KEY)}`,
              {
                method: 'POST',
                signal: ctrl.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: sys }] },
                  contents: nextHistory
                    .filter((t) => !t.localOnly)
                    .slice(-14)
                    .map((t) => ({
                      role: t.role === 'user' ? 'user' : 'model',
                      parts: [{ text: t.text }],
                    })),
                  generationConfig: {
                    temperature: 0.78,
                    maxOutputTokens: 80,
                    ...(spec.thinkZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                  },
                }),
              },
            );
            if (res.status === 429 || res.status === 404) {
              clientTextCooldown.set(spec.id, Date.now() + 45_000);
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
          const ttsRes = await directClientAoedeTts(replyText);
          if (ttsRes) {
            audioBuffer = ttsRes.buffer;
            audioMime = ttsRes.mime;
          }
        } else {
          replyText = 'وصلني بالكمبيوتر أو ضيف مفتاح جيميناي عشان نتكلم سوا!';
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if(userTurn.localOnly)replyText=(err as Error).message;else replyText = 'النت قطع ثانية، قول تاني كده؟';
      }

      if (ctrl.signal.aborted || mySeq !== requestSeqRef.current) return;

      const modelTurn: NourChatTurn = {
        id: makeRequestId(),
        role: 'model',
        text: replyText,
        localOnly: userTurn.localOnly, evidence,volume,
        ts: Date.now(),
      };
      setTurns((prev) => [...prev.slice(-30), modelTurn]);
      executeNourAction(action);

      await playReplyAudio(audioBuffer, audioMime, replyText, () => {
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
    [deck, onNavigate, executeNourAction, liveContext, playReplyAudio, stopRecognition, stopSpeaking],
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
      // Single-utterance mode when actively listening -> WebKit waits for your FULL sentence
      // and fires once cleanly instead of splitting mid-breath into 2 prompts!
      rec.continuous = mode === 'wake' && !activeListeningRef.current;
      rec.interimResults = true;
      let sessionCommitted = false;

      const submitCaptured = (text: string) => {
        const clean = text.trim();
        if (!clean || sessionCommitted || submittedTurnRef.current) return;
        sessionCommitted = true;
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
        if (sessionCommitted || submittedTurnRef.current) return;
        let full = '';
        for (let i = 0; i < ev.results.length; i += 1) {
          full += ev.results[i][0]?.transcript || '';
        }
        const trimmed = full.trim();
        if (!trimmed) return;

        // REAL-TIME BARGE-IN: user speaks while Nour is speaking -> immediately pause & listen!
        if (phaseRef.current === 'speaking') {
          if (isLikelySelfEcho(trimmed, currentSpokenTextRef.current)) {
            return;
          }
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
          // Comfortable 900ms pause window after your last word so mid-sentence breaths NEVER split into 2 sends!
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            const pending = latestTranscriptRef.current;
            if (pending && !sessionCommitted && !submittedTurnRef.current) {
              submitCaptured(pending);
            }
          }, 900);
          return;
        }

        const nameEsc = escapeRegExp(botNameRef.current.trim() || 'نور');
        const wakeRe = new RegExp(`(?:يا\\s*)?(?:${nameEsc}|نور|nour|noor)(?=$|[,،:\\s])[,،:\\s]*(.*)`, 'i');
        const m = trimmed.match(wakeRe);
        if (m) {
          const afterWake = (m[1] || '').trim();
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            soundEngine.playSuccessChime();
            submitCaptured(afterWake.length >= 2 ? afterWake : 'يا نور');
          }, 850);
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
        if (
          !sessionCommitted &&
          !submittedTurnRef.current &&
          (activeListeningRef.current || liveCallRef.current) &&
          latestTranscriptRef.current &&
          phaseRef.current !== 'thinking' &&
          phaseRef.current !== 'speaking'
        ) {
          submitCaptured(latestTranscriptRef.current);
          return;
        }
        if ((liveCallRef.current || wakeWordRef.current) && phaseRef.current !== 'thinking') {
          restartTimerRef.current = window.setTimeout(() => {
            if ((liveCallRef.current || wakeWordRef.current) && !recRef.current && phaseRef.current !== 'thinking') {
              startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
            }
          }, 180);
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

  useEffect(() => {
    if (!liveCallOn && !wakeWordOn) return;
    const id = window.setInterval(() => {
      if (!recRef.current && phaseRef.current !== 'thinking') {
        startRecognitionRef.current(liveCallRef.current ? 'active' : 'wake');
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [liveCallOn, wakeWordOn]);

  const spokenEvent = useRef('');
  useEffect(()=>{if(!privateDisplay)return;
    requestSeqRef.current++;abortReqRef.current?.abort();liveCallRef.current=false;wakeWordRef.current=false;
    setLiveCallOn(false);setWakeWordOn(false);stopRecognition();stopSpeaking();setPhase('idle');
  },[privateDisplay,stopRecognition,stopSpeaking]);
  const allowAlert = useRef(false);
  useEffect(() => {
    allowAlert.current = spokenAlerts && !muted && !privateDisplay;
    return () => {
      allowAlert.current = false;
    };
  }, [spokenAlerts, muted,privateDisplay]);
  useEffect(() => {
    const alert = deck.alertFlash;
    if (privateDisplay || !alert || alert.id === spokenEvent.current || !spokenAlerts || muted) return;
    const message = alert.message;
    const percent = message.match(/(\d+)%/)?.[1];
    const text =
      /battery/i.test(message) && percent
        ? 'البطارية وصلت ' + percent + ' في المية.'
        : /^Website /i.test(message)
          ? message.includes('recovered')
            ? 'الموقع رجع يشتغل.'
            : message.includes('certificate')
              ? 'شهادة الموقع قربت تنتهي.'
              : 'الموقع مش بيرد.'
          : /build|compiled|built in/i.test(message)
            ? alert.kind === 'error'
              ? 'البيلد فشل.'
              : 'البيلد خلص.'
            : '';
    if (!text) return;
    spokenEvent.current = alert.id;
    const idle = () =>
      !liveCallRef.current && !wakeWordRef.current && phaseRef.current === 'idle' && !mutedRef.current;
    if (!idle()) return;
    const sequence = requestSeqRef.current;
    const bridge = { bridgeBaseUrl: deck.bridgeBaseUrl, pairing: deck.pairing };
    void (async () => {
      let buffer: ArrayBuffer | null = null;
      let mime = 'audio/wav';
      try {
        const audio = await bridgeRequest<{ audioBase64?: string; audioMime?: string }>(
          bridge,
          'nour/speak',
          { text },
          AbortSignal.timeout(3500),
        );
        if (audio.audioBase64) {
          buffer = base64ToArrayBuffer(audio.audioBase64);
          mime = audio.audioMime || mime;
        }
      } catch {}
      if (
        allowAlert.current &&
        spokenEvent.current === alert.id &&
        sequence === requestSeqRef.current &&
        idle()
      )
        await playReplyAudio(buffer, mime, text);
    })();
  }, [deck.alertFlash, spokenAlerts, muted, playReplyAudio, deck.bridgeBaseUrl, deck.pairing?.token]);
  return {
    botName,
    spokenAlerts,
    toggleAlerts,
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
