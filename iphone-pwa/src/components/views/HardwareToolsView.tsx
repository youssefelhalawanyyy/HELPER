'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  Flame,
  Loader2,
  Lock,
  Mic,
  MicOff,
  RotateCw,
  ScrollText,
  Smartphone,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimer, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type DialMode = 'volume' | 'brightness' | 'scroll';
type FlipAction = 'mute' | 'lock';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

export function HardwareToolsView({ deck }: { deck: DevDeckState }) {
  // --- Smart Dial State ---
  const [dialMode, setDialMode] = useState<DialMode>('volume');
  const [dialAngle, setDialAngle] = useState(0);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const lastAngleRef = useRef<number | null>(null);
  const accumDegRef = useRef(0);

  // --- Voice-to-Mac State ---
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [autoPasteVoice, setAutoPasteVoice] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const latestTranscriptRef = useRef('');

  // --- Camera Desk Scanner State ---
  const [uploadingScan, setUploadingScan] = useState(false);
  const [lastScanFile, setLastScanFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Flip-to-Mute / Lock Gesture State ---
  const [flipEnabled, setFlipEnabled] = useState(false);
  const [flipAction, setFlipAction] = useState<FlipAction>('mute');
  const [isFaceDown, setIsFaceDown] = useState(false);
  const faceDownTriggeredRef = useRef(false);

  // --- Focus Duration ---
  const [focusMinutes, setFocusMinutes] = useState(25);

  const handleDialPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    lastAngleRef.current = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    accumDegRef.current = 0;
  };

  const handleDialPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lastAngleRef.current === null || !dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);

    let diff = angle - lastAngleRef.current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    lastAngleRef.current = angle;

    setDialAngle((prev) => prev + diff);
    accumDegRef.current += diff;

    const threshold = 16;
    if (Math.abs(accumDegRef.current) >= threshold) {
      const direction = accumDegRef.current > 0 ? 1 : -1;
      accumDegRef.current = 0;
      soundEngine.playDetent();

      const delta =
        dialMode === 'volume' ? direction * 4 : dialMode === 'brightness' ? direction : direction * -4;

      deck.sendEvent({
        type: 'hardware:dial',
        payload: { mode: dialMode, delta },
      });
    }
  };

  const handleDialPointerUp = () => {
    lastAngleRef.current = null;
  };

  // --- Voice-to-Mac Handlers ---
  const startVoice = () => {
    if (listening) return;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) {
      deck.showToast(false, 'Web Speech API unavailable in this browser');
      return;
    }

    soundEngine.playClick();
    latestTranscriptRef.current = '';
    setTranscript('');
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let combined = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        combined += ev.results[i][0].transcript;
      }
      latestTranscriptRef.current = combined.trim();
      setTranscript(combined.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      if (latestTranscriptRef.current) {
        deck.sendEvent({
          type: 'voice:transcript',
          payload: {
            requestId: makeRequestId(),
            text: latestTranscriptRef.current,
            autoPaste: autoPasteVoice,
          },
        });
        soundEngine.playSuccessChime();
      }
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const stopVoice = () => {
    if (recognitionRef.current && listening) {
      recognitionRef.current.stop();
    }
  };

  // --- Camera Desk Scanner ---
  const handleScanSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !deck.bridgeBaseUrl || !deck.pairing) return;

    setUploadingScan(true);
    try {
      const imageBase64 = await compressImageFile(file);
      const res = await fetch(`${deck.bridgeBaseUrl}/api/scans`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deck.pairing.token}`,
        },
        body: JSON.stringify({ imageBase64 }),
      });
      const data = (await res.json()) as { ok: boolean; filename?: string; error?: string };
      if (res.ok && data.ok) {
        setLastScanFile(data.filename || 'Saved');
        deck.showToast(true, `Scan saved & path copied: ${data.filename}`);
        soundEngine.playSuccessChime();
      } else {
        deck.showToast(false, data.error || 'Scan upload failed');
      }
    } catch {
      deck.showToast(false, 'Could not upload scan to Mac');
    } finally {
      setUploadingScan(false);
    }
  };

  // --- Motion Gesture (Flip-to-Mute / Lock) ---
  const toggleFlipGesture = useCallback(async () => {
    soundEngine.playClick();
    if (flipEnabled) {
      setFlipEnabled(false);
      return;
    }
    const DevOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DevOrient?.requestPermission === 'function') {
      try {
        const perm = await DevOrient.requestPermission();
        if (perm !== 'granted') {
          deck.showToast(false, 'iOS Motion permission denied');
          return;
        }
      } catch {
        deck.showToast(false, 'Motion permission requires HTTPS or Safari prompt');
        return;
      }
    }
    setFlipEnabled(true);
    deck.showToast(true, `Flip face-down to ${flipAction} Mac armed`);
  }, [deck, flipAction, flipEnabled]);

  useEffect(() => {
    if (!flipEnabled) return;
    const onOrientation = (ev: DeviceOrientationEvent) => {
      const beta = ev.beta ?? 0;
      const faceDown = Math.abs(beta) > 152;
      setIsFaceDown(faceDown);
      if (faceDown && !faceDownTriggeredRef.current) {
        faceDownTriggeredRef.current = true;
        if (flipAction === 'mute') {
          deck.sendEvent({
            type: 'hardware:mute',
            payload: { requestId: makeRequestId(), muted: true },
          });
        } else {
          deck.sendEvent({ type: 'hardware:lock', payload: { requestId: makeRequestId() } });
        }
      } else if (!faceDown && Math.abs(beta) < 120) {
        faceDownTriggeredRef.current = false;
      }
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [deck, flipAction, flipEnabled]);

  const dialReadout =
    dialMode === 'volume'
      ? `${deck.mediaState.volume}%`
      : dialMode === 'brightness'
        ? `${deck.mediaState.brightness}%`
        : 'SCROLL';

  return (
    <div className="grid h-full grid-cols-12 gap-2.5 p-3">
      {/* Left: Precision Multi-Touch Smart Dial */}
      <div className="hw-panel col-span-5 flex flex-col items-center justify-between rounded-2xl p-3">
        <div className="flex w-full items-center justify-between">
          <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Smart Dial
          </span>
          <div className="flex gap-1">
            {(
              [
                { id: 'volume', icon: Volume2, label: 'Vol' },
                { id: 'brightness', icon: Sun, label: 'Bri' },
                { id: 'scroll', icon: ScrollText, label: 'Scr' },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setDialMode(m.id);
                  }}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${
                    dialMode === m.id
                      ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                      : 'border-white/10 bg-black text-zinc-400'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rotary Knob */}
        <div
          ref={dialRef}
          onPointerDown={handleDialPointerDown}
          onPointerMove={handleDialPointerMove}
          onPointerUp={handleDialPointerUp}
          onPointerCancel={handleDialPointerUp}
          className="relative my-1 flex h-[176px] w-[176px] touch-none items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_30%_25%,#222229_0%,#0B0B0E_70%)] shadow-[inset_0_2px_10px_rgba(255,255,255,0.08),0_12px_30px_rgba(0,0,0,0.85)]"
        >
          {/* Rotating physical indicator ring */}
          <div
            className="pointer-events-none absolute inset-3 rounded-full border border-dashed border-white/15"
            style={{ transform: `rotate(${dialAngle}deg)` }}
          >
            <span className="absolute top-1.5 left-1/2 h-3 w-1.5 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_#06B6D4]" />
          </div>

          <div className="pointer-events-none flex h-[104px] w-[104px] flex-col items-center justify-center rounded-full border border-white/[0.08] bg-black/90 shadow-inner">
            <RotateCw className="mb-0.5 h-3.5 w-3.5 text-cyan-400/80" />
            <span className="font-mono-tech text-lg font-bold tracking-tight text-white">
              {dialReadout}
            </span>
            <span className="font-mono-tech text-[9px] uppercase text-zinc-500">{dialMode}</span>
          </div>
        </div>

        <div className="flex w-full items-center justify-between text-[10px] text-zinc-500">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              deck.sendEvent({
                type: 'hardware:mute',
                payload: { requestId: makeRequestId(), muted: !deck.mediaState.muted },
              });
            }}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 ${
              deck.mediaState.muted
                ? 'border-red-500/40 bg-red-500/15 text-red-300'
                : 'border-white/10 bg-black text-zinc-300'
            }`}
          >
            {deck.mediaState.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            {deck.mediaState.muted ? 'Muted' : 'Mute'}
          </button>
          <span className="font-mono-tech">Spin with 1 finger</span>
        </div>
      </div>

      {/* Right: 2x2 Hardware & Sensor Modules */}
      <div className="col-span-7 grid grid-cols-2 grid-rows-2 gap-2.5">
        {/* 1. Voice-to-Mac AI Prompt */}
        <div className="hw-panel flex flex-col justify-between rounded-xl p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Voice-to-Mac</span>
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">
              <input
                type="checkbox"
                checked={autoPasteVoice}
                onChange={(e) => setAutoPasteVoice(e.target.checked)}
                className="accent-cyan-400"
              />
              Auto-paste
            </label>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onPointerDown={startVoice}
            onPointerUp={stopVoice}
            onPointerLeave={stopVoice}
            className={`my-1 flex flex-1 touch-none flex-col items-center justify-center rounded-xl border transition-all ${
              listening
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_20px_rgba(6,182,212,0.35)]'
                : 'hw-key text-zinc-200'
            }`}
          >
            {listening ? <Mic className="h-5 w-5 animate-pulse text-cyan-300" /> : <MicOff className="h-5 w-5 text-cyan-400" />}
            <span className="mt-1 text-[11px] font-semibold">
              {listening ? 'Listening… Release to Send' : 'Hold to Talk'}
            </span>
          </motion.button>

          <div className="font-mono-tech truncate text-[10px] text-zinc-500">
            {transcript || 'Transcribes directly to Mac clipboard'}
          </div>
        </div>

        {/* 2. Camera-to-Mac Desk Scanner */}
        <div className="hw-panel flex flex-col justify-between rounded-xl p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Desk Scanner</span>
            <span className="font-mono-tech text-[9px] text-emerald-400">/scans</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleScanSelected}
            className="hidden"
          />

          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={uploadingScan}
            onClick={() => {
              soundEngine.playClick();
              fileInputRef.current?.click();
            }}
            className="hw-key my-1 flex flex-1 flex-col items-center justify-center rounded-xl text-zinc-200"
          >
            {uploadingScan ? (
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            ) : (
              <Camera className="h-5 w-5 text-emerald-400" />
            )}
            <span className="mt-1 text-[11px] font-semibold">
              {uploadingScan ? 'Sending to Mac…' : 'Snap Whiteboard'}
            </span>
          </motion.button>

          <div className="font-mono-tech truncate text-[10px] text-zinc-500">
            {lastScanFile ? `Saved: ${lastScanFile}` : 'Compresses & copies Mac file path'}
          </div>
        </div>

        {/* 3. Motion Gesture (Flip-to-Mute / Lock) */}
        <div className="hw-panel flex flex-col justify-between rounded-xl p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Flip Gesture</span>
            <div className="flex rounded border border-white/10 bg-black p-0.5 text-[9px]">
              <button
                type="button"
                onClick={() => setFlipAction('mute')}
                className={`rounded px-1.5 py-0.5 ${
                  flipAction === 'mute' ? 'bg-violet-500 text-black font-semibold' : 'text-zinc-400'
                }`}
              >
                Mute
              </button>
              <button
                type="button"
                onClick={() => setFlipAction('lock')}
                className={`rounded px-1.5 py-0.5 ${
                  flipAction === 'lock' ? 'bg-red-500 text-black font-semibold' : 'text-zinc-400'
                }`}
              >
                Lock
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void toggleFlipGesture()}
            className={`my-1 flex flex-1 items-center justify-center gap-2 rounded-xl border text-xs font-semibold transition-colors ${
              flipEnabled
                ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                : 'hw-key text-zinc-300'
            }`}
          >
            {flipAction === 'lock' ? <Lock className="h-4 w-4 text-red-400" /> : <Smartphone className="h-4 w-4 text-violet-400" />}
            <span>{flipEnabled ? (isFaceDown ? 'Face-Down!' : 'Armed') : 'Enable Sensor'}</span>
          </button>

          <div className="font-mono-tech truncate text-[10px] text-zinc-500">
            Flip iPhone face-down to {flipAction} Mac
          </div>
        </div>

        {/* 4. Deep Work Focus Switch */}
        <div className="hw-panel flex flex-col justify-between rounded-xl p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Deep Work Focus</span>
            <div className="flex gap-1">
              {[15, 25, 45].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFocusMinutes(m)}
                  className={`font-mono-tech rounded px-1.5 py-0.5 text-[9px] ${
                    focusMinutes === m
                      ? 'bg-amber-500 text-black font-bold'
                      : 'bg-black text-zinc-400'
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              if (deck.focusState.active) {
                deck.sendEvent({ type: 'focus:stop', payload: { requestId: makeRequestId() } });
              } else {
                deck.sendEvent({
                  type: 'focus:start',
                  payload: { requestId: makeRequestId(), durationMin: focusMinutes },
                });
              }
            }}
            className={`my-1 flex flex-1 items-center justify-center gap-2 rounded-xl border text-xs font-semibold transition-colors ${
              deck.focusState.active
                ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                : 'hw-key text-zinc-200'
            }`}
          >
            <Flame className={`h-4 w-4 ${deck.focusState.active ? 'text-amber-300' : 'text-amber-500'}`} />
            <span className="font-mono-tech">
              {deck.focusState.active ? `STOP (${formatTimer(deck.focusState.remainingSec)})` : `Start ${focusMinutes}m DND`}
            </span>
          </button>

          <div className="font-mono-tech truncate text-[10px] text-zinc-500">
            Triggers macOS Focus / mutes alerts
          </div>
        </div>
      </div>
    </div>
  );
}
