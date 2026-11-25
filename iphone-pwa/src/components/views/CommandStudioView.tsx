'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  ClipboardPaste,
  KeyRound,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Square,
  Video,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type StudioTab = 'meeting' | 'continuity' | 'otp';

export function CommandStudioView({ deck }: { deck: DevDeckState }) {
  const [tab, setTab] = useState<StudioTab>('meeting');
  const [meetingActive, setMeetingActive] = useState(false);

  // Continuity Studio state
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dictating, setDictating] = useState(false);
  const camInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 2FA / OTP Auto-Type state
  const [otpCode, setOtpCode] = useState('');

  const isConnected =
    deck.status === 'connected' && Boolean(deck.bridgeBaseUrl && deck.pairing?.token);

  const authHeaders = {
    'content-type': 'application/json',
    authorization: `Bearer ${deck.pairing?.token || ''}`,
  };

  const runMeetingAction = async (action: 'start' | 'mic' | 'camera' | 'leave') => {
    if (!isConnected || !deck.bridgeBaseUrl) return;
    soundEngine.playClick();
    if (action === 'start') {
      setMeetingActive((v) => !v);
      deck.sendEvent({
        type: 'focus:start',
        payload: { requestId: makeRequestId(), durationMin: 60 },
      });
    }
    if (action === 'mic') {
      deck.sendEvent({ type: 'system:toggleMic', payload: { requestId: makeRequestId() } });
      return;
    }
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/meeting/action`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action }),
      });
      const d = (await res.json()) as { ok?: boolean; message?: string };
      deck.showToast(Boolean(d.ok), d.message || `Meeting: ${action}`);
    } catch {
      deck.showToast(false, 'Meeting action failed');
    }
  };

  const uploadBlobToDocuments = async (blob: Blob, filename: string) => {
    if (!isConnected || !deck.bridgeBaseUrl) return;
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Read failed'));
        r.readAsDataURL(blob);
      });
      const res = await fetch(`${deck.bridgeBaseUrl}/api/files/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ root: 'documents', dir: '', filename, data: base64 }),
      });
      const d = (await res.json()) as { ok?: boolean; filename?: string; error?: string };
      if (!d.ok) throw new Error(d.error || 'Upload failed');
      deck.showToast(true, `Saved ${d.filename || filename} to ~/Documents!`);
      soundEngine.playSuccessChime();
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const toggleVoiceMemo = async () => {
    soundEngine.playClick();
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        void uploadBlobToDocuments(blob, `VoiceMemo-${Date.now()}.${ext}`);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      deck.showToast(false, 'Microphone permission denied');
    }
  };

  const dictateToMac = () => {
    soundEngine.playClick();
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRec) {
      deck.showToast(false, 'Speech recognition unavailable on this browser');
      return;
    }
    const rec = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      start: () => void;
    };
    rec.lang = 'en-US';
    rec.interimResults = false;
    setDictating(true);
    rec.onresult = (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        deck.sendEvent({
          type: 'hardware:type',
          payload: { requestId: makeRequestId(), text: transcript, enter: false },
        });
        deck.showToast(true, `Typed: "${transcript.slice(0, 40)}"`);
      }
    };
    rec.onend = () => setDictating(false);
    rec.start();
  };

  const submitOtp = (pressEnter: boolean) => {
    const clean = otpCode.trim();
    if (!clean) return;
    soundEngine.playClick();
    deck.sendEvent({
      type: 'hardware:type',
      payload: { requestId: makeRequestId(), text: clean, enter: pressEnter },
    });
    deck.showToast(true, `Auto-typed 2FA code (${clean.length} chars)`);
    setOtpCode('');
  };

  const micMuted = Boolean(deck.macTelemetry?.micMuted);

  return (
    <div className="tile flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#ff5d6c] via-[#fbbf24] to-[#88f1d1]" />

      {/* 3-Mode Studio Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-black/75 p-0.5">
          {(
            [
              ['meeting', 'Meeting Bar', Video, '#ff5d6c'],
              ['continuity', 'Continuity Cam & Mic', Camera, '#88f1d1'],
              ['otp', '2FA / OTP Auto-Type', KeyRound, '#fbbf24'],
            ] as const
          ).map(([id, label, Icon, col]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setTab(id);
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
              style={{
                background: tab === id ? '#172b34' : 'transparent',
                color: tab === id ? col : '#7c8190',
              }}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: MEETING & FOCUS COMMAND BAR */}
      {tab === 'meeting' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-12">
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={!isConnected}
            onClick={() => void runMeetingAction('mic')}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 sm:col-span-5 disabled:opacity-40"
            style={{
              borderColor: micMuted ? '#ff5d6c' : '#34d399',
              background: micMuted ? 'rgba(255,93,108,0.18)' : 'rgba(52,211,153,0.16)',
              color: micMuted ? '#ff5d6c' : '#34d399',
            }}
          >
            {micMuted ? <MicOff className="h-10 w-10" /> : <Mic className="h-10 w-10" />}
            <div className="disp text-[20px]">{micMuted ? 'MIC MUTED' : 'MIC LIVE'}</div>
            <div className="text-[10px] opacity-80">Tap to toggle system microphone</div>
          </motion.button>

          <div className="grid grid-cols-2 gap-2 sm:col-span-7">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={!isConnected}
              onClick={() => void runMeetingAction('start')}
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#fbbf24]/40 bg-[#fbbf24]/14 p-3 text-[#fbbf24] disabled:opacity-40"
            >
              <Video className="h-6 w-6" />
              <span className="text-xs font-extrabold">
                {meetingActive ? 'MEETING MODE ON' : 'START MEETING MODE'}
              </span>
              <span className="text-[9px] text-[#cbd5e1]">Enables DND &amp; pauses music</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={!isConnected}
              onClick={() => void runMeetingAction('camera')}
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#7dd3fc]/40 bg-[#7dd3fc]/14 p-3 text-[#7dd3fc] disabled:opacity-40"
            >
              <Camera className="h-6 w-6" />
              <span className="text-xs font-extrabold">CAMERA TOGGLE</span>
              <span className="text-[9px] text-[#cbd5e1]">Zoom / Meet / Teams (⌘E)</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={!isConnected}
              onClick={() => void runMeetingAction('leave')}
              className="col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-[#ff5d6c]/45 bg-[#ff5d6c]/16 py-3 text-xs font-extrabold text-[#ff5d6c] disabled:opacity-40"
            >
              <PhoneOff className="h-5 w-5" />
              LEAVE CALL / CLOSE MEETING TAB (⌘W)
            </motion.button>
          </div>
        </div>
      )}

      {/* TAB 2: CONTINUITY CAMERA & VOICE MEMO STUDIO */}
      {tab === 'continuity' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
          <input
            ref={camInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadBlobToDocuments(f, `CamSnap-${Date.now()}.jpg`);
            }}
            className="hidden"
          />

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={!isConnected || uploading}
            onClick={() => camInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#88f1d1]/40 bg-[#88f1d1]/12 p-4 text-center disabled:opacity-40"
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-[#88f1d1]" />
            ) : (
              <Camera className="h-8 w-8 text-[#88f1d1]" />
            )}
            <div className="text-xs font-extrabold text-white">Wireless Camera Snapshot</div>
            <div className="text-[9.5px] text-[#9cb4bb]">
              Snap a photo on iPhone → drops straight into <code>~/Documents</code>
            </div>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={!isConnected || uploading}
            onClick={() => void toggleVoiceMemo()}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center disabled:opacity-40"
            style={{
              borderColor: recording ? '#ff5d6c' : 'rgba(125,211,252,0.4)',
              background: recording ? 'rgba(255,93,108,0.2)' : 'rgba(125,211,252,0.12)',
            }}
          >
            {recording ? (
              <Square className="h-8 w-8 fill-current text-[#ff5d6c]" />
            ) : (
              <Mic className="h-8 w-8 text-[#7dd3fc]" />
            )}
            <div className="text-xs font-extrabold text-white">
              {recording ? 'STOP & SAVE VOICE MEMO' : 'Voice Memo → Documents'}
            </div>
            <div className="text-[9.5px] text-[#9cb4bb]">
              Record audio on iPhone → saves automatically to <code>~/Documents</code>
            </div>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={!isConnected || dictating}
            onClick={dictateToMac}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#a78bfa]/40 bg-[#a78bfa]/14 p-4 text-center disabled:opacity-40"
          >
            <Mic className={`h-8 w-8 text-[#c4b5fd] ${dictating ? 'animate-pulse' : ''}`} />
            <div className="text-xs font-extrabold text-white">
              {dictating ? 'LISTENING… SPEAK NOW' : 'Transcribe to Active App'}
            </div>
            <div className="text-[9.5px] text-[#9cb4bb]">
              Speak on iPhone → types directly wherever your computer cursor is
            </div>
          </motion.button>
        </div>
      )}

      {/* TAB 3: 2FA / OTP AUTO-TYPE */}
      {tab === 'otp' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-[#fbbf24]/30 bg-[#08131a] p-4 text-center">
          <KeyRound className="h-8 w-8 text-[#fbbf24]" />
          <div>
            <div className="disp text-[18px] text-white">2FA / OTP Auto-Type to Computer</div>
            <div className="text-[10px] text-[#9cb4bb]">
              Paste your 6-digit SMS or Authenticator code on iPhone and type it directly into your Mac/PC login box
            </div>
          </div>

          <div className="flex w-full max-w-md items-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="123456"
              className="font-mono-tech h-10 min-w-0 flex-1 rounded-xl border border-[#fbbf24]/40 bg-black/80 px-3 text-center text-lg font-extrabold tracking-[0.28em] text-[#fde68a] outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                soundEngine.playClick();
                try {
                  const t = await navigator.clipboard.readText();
                  if (t) setOtpCode(t.trim());
                } catch {
                  deck.showToast(false, 'Tap inside the box and paste directly');
                }
              }}
              className="flex h-10 items-center gap-1 rounded-xl border border-white/15 bg-white/[0.06] px-3 text-[10px] font-extrabold text-white"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-[#7dd3fc]" />
              PASTE
            </button>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              disabled={!isConnected || !otpCode.trim()}
              onClick={() => submitOtp(false)}
              className="rounded-xl border border-white/15 bg-white/[0.08] px-4 py-2 text-[10.5px] font-extrabold text-white disabled:opacity-40"
            >
              TYPE ONLY
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              disabled={!isConnected || !otpCode.trim()}
              onClick={() => submitOtp(true)}
              className="flex items-center gap-1.5 rounded-xl bg-[#fbbf24] px-5 py-2 text-[10.5px] font-extrabold text-[#161004] disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              AUTO-TYPE &amp; PRESS ENTER
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
}
