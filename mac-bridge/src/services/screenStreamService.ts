import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Response } from 'express';
import si from 'systeminformation';
import { captureScreenPeekJpeg } from '../macos/hardware.js';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_SRC = path.resolve(__dirname, '../../native/screen_stream.m');
const NATIVE_BIN = path.join(os.tmpdir(), 'devdeck-screen-stream-v2');

export type ScreenQualityPreset = 'turbo' | 'balanced' | 'hd';

interface StreamProfile {
  width: number;
  quality: number;
  fps: number;
}

const PROFILES: Record<ScreenQualityPreset, StreamProfile> = {
  turbo: { width: 760, quality: 0.48, fps: 24 },
  balanced: { width: 960, quality: 0.62, fps: 18 },
  hd: { width: 1280, quality: 0.76, fps: 12 },
};

interface ActiveStream {
  key: string;
  proc: ChildProcess | null;
  clients: Set<Response>;
  latestFrame: Buffer | null;
  latestTs: number;
  frameCount: number;
  lastAccessTs: number;
  permissionDenied: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  waiters: Array<(frame: Buffer | null) => void>;
}

const activeStreams = new Map<string, ActiveStream>();
let compilePromise: Promise<string | null> | null = null;

async function ensureNativeStreamer(): Promise<string | null> {
  if (IS_WIN) return null;
  if (compilePromise) return compilePromise;
  compilePromise = (async () => {
    try {
      const srcStat = fs.existsSync(NATIVE_SRC) ? fs.statSync(NATIVE_SRC) : null;
      const binStat = fs.existsSync(NATIVE_BIN) ? fs.statSync(NATIVE_BIN) : null;
      if (binStat && srcStat && binStat.mtimeMs >= srcStat.mtimeMs) {
        return NATIVE_BIN;
      }
      if (!srcStat) return null;
      await execFileAsync(
        'clang',
        [
          '-O3',
          '-fobjc-arc',
          '-framework',
          'Foundation',
          '-framework',
          'CoreGraphics',
          '-framework',
          'CoreImage',
          '-framework',
          'CoreMedia',
          '-framework',
          'CoreVideo',
          '-framework',
          'ImageIO',
          '-framework',
          'ScreenCaptureKit',
          NATIVE_SRC,
          '-o',
          NATIVE_BIN,
        ],
        { timeout: 15000 },
      );
      return fs.existsSync(NATIVE_BIN) ? NATIVE_BIN : null;
    } catch {
      return null;
    }
  })();
  return compilePromise;
}

export async function checkScreenCapturePermission(): Promise<boolean> {
  if (IS_WIN) return true;
  const bin = await ensureNativeStreamer();
  if (!bin) return true;
  try {
    await execFileAsync(bin, ['--check'], { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

export async function requestScreenCapturePermission(): Promise<{ ok: boolean; granted: boolean; message: string }> {
  if (IS_WIN) return { ok: true, granted: true, message: 'Windows screen capture is ready' };
  const bin = await ensureNativeStreamer();
  if (bin) {
    try {
      await execFileAsync(bin, ['--request'], { timeout: 2500 });
      return { ok: true, granted: true, message: 'Screen Recording permission already granted!' };
    } catch {
      // Permission not yet granted — open macOS System Settings directly to Screen Recording
    }
  }
  await execFileAsync('open', [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ]).catch(() => {});
  return {
    ok: true,
    granted: false,
    message: 'Opened macOS Screen Recording Settings — enable your terminal/IDE toggle, then tap Retry.',
  };
}

function broadcastFrame(stream: ActiveStream, jpeg: Buffer) {
  stream.latestFrame = jpeg;
  stream.latestTs = Date.now();
  stream.frameCount += 1;
  stream.permissionDenied = false;

  if (stream.waiters.length > 0) {
    const waiters = stream.waiters.splice(0, stream.waiters.length);
    for (const resolve of waiters) resolve(jpeg);
  }

  if (stream.clients.size === 0) return;
  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`,
  );
  const tail = Buffer.from('\r\n');
  for (const res of stream.clients) {
    if (res.writableEnded || res.destroyed) {
      stream.clients.delete(res);
      continue;
    }
    if ((res.socket?.writableLength ?? 0) > 120 * 1024) continue;
    try {
      res.write(header);
      res.write(jpeg);
      res.write(tail);
    } catch {
      stream.clients.delete(res);
    }
  }
}

function stopStream(stream: ActiveStream) {
  if (stream.stopTimer) {
    clearTimeout(stream.stopTimer);
    stream.stopTimer = null;
  }
  if (stream.fallbackTimer) {
    clearInterval(stream.fallbackTimer);
    stream.fallbackTimer = null;
  }
  if (stream.proc && !stream.proc.killed) {
    try {
      stream.proc.kill('SIGTERM');
    } catch {
      // Ignore
    }
  }
  stream.proc = null;
  const waiters = stream.waiters.splice(0, stream.waiters.length);
  for (const resolve of waiters) resolve(null);
  activeStreams.delete(stream.key);
}

function scheduleAutoStop(stream: ActiveStream) {
  if (stream.stopTimer) clearTimeout(stream.stopTimer);
  stream.stopTimer = setTimeout(() => {
    stream.stopTimer = null;
    if (stream.clients.size === 0 && Date.now() - stream.lastAccessTs >= 2500) {
      stopStream(stream);
    } else if (stream.clients.size === 0) {
      scheduleAutoStop(stream);
    }
  }, 2600);
}

export async function listScreenDisplays(): Promise<Array<{ index: number; label: string }>> {
  try {
    const gfx = await si.graphics();
    const list = (gfx.displays || []).map((d, idx) => {
      const w = d.currentResX || d.resolutionX || 0;
      const h = d.currentResY || d.resolutionY || 0;
      const res = w && h ? ` (${w}×${h})` : '';
      return { index: idx, label: `Display ${idx + 1}${res}` };
    });
    if (list.length > 0) return list;
  } catch {
    // Fallback
  }
  return [{ index: 0, label: 'Display 1' }];
}

async function startCaptureLoop(
  stream: ActiveStream,
  preset: ScreenQualityPreset,
  displayIdx = 0,
) {
  const prof = PROFILES[preset];
  const nativeBin = await ensureNativeStreamer();

  if (nativeBin) {
    const proc = spawn(
      nativeBin,
      [String(prof.width), String(prof.quality), String(prof.fps), String(Math.max(0, displayIdx))],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    stream.proc = proc;

    let buf: Buffer = Buffer.alloc(0);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf = buf.byteLength === 0 ? chunk : Buffer.concat([buf, chunk]);
      while (buf.byteLength >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0 || len > 10 * 1024 * 1024) {
          buf = Buffer.alloc(0);
          break;
        }
        if (buf.byteLength < 4 + len) break;
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        broadcastFrame(stream, frame);
      }
    });

    proc.on('exit', (code) => {
      if (stream.proc === proc) stream.proc = null;
      if (code === 10 || code === 2) {
        stream.permissionDenied = true;
        const waiters = stream.waiters.splice(0, stream.waiters.length);
        for (const resolve of waiters) resolve(null);
        activeStreams.delete(stream.key);
        return;
      }
      if (stream.clients.size === 0 && Date.now() - stream.lastAccessTs >= 2500) {
        activeStreams.delete(stream.key);
      }
    });
    return;
  }

  // Windows / non-clang fallback
  let busy = false;
  const intervalMs = Math.max(80, Math.round(1000 / Math.min(14, prof.fps)));
  stream.fallbackTimer = setInterval(() => {
    if (busy) return;
    if (stream.clients.size === 0 && Date.now() - stream.lastAccessTs >= 2500) {
      stopStream(stream);
      return;
    }
    busy = true;
    void captureScreenPeekJpeg(prof.width)
      .then((jpg) => {
        if (jpg && jpg.byteLength > 0) broadcastFrame(stream, jpg);
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
}

function getOrStartStream(preset: ScreenQualityPreset, displayIdx = 0): ActiveStream {
  const key = `${preset}:${Math.max(0, displayIdx)}`;
  let stream = activeStreams.get(key);
  if (!stream) {
    stream = {
      key,
      proc: null,
      clients: new Set(),
      latestFrame: null,
      latestTs: 0,
      frameCount: 0,
      lastAccessTs: Date.now(),
      permissionDenied: false,
      stopTimer: null,
      fallbackTimer: null,
      waiters: [],
    };
    activeStreams.set(key, stream);
    void startCaptureLoop(stream, preset, displayIdx);
  }
  stream.lastAccessTs = Date.now();
  return stream;
}

/**
 * Ultra-fast RAM-cached frame getter for iOS Safari & Cloudflare HTTPS tunnels (zero MJPEG buffering!).
 * Keeps the ScreenCaptureKit GPU daemon warm while frames are actively polled and auto-stops 2.6s after idle.
 */
export async function getLiveScreenFrame(
  preset: ScreenQualityPreset = 'turbo',
  lastSeq = 0,
  displayIdx = 0,
): Promise<{ frame: Buffer | null; seq: number; permissionDenied: boolean }> {
  const hasPerm = await checkScreenCapturePermission();
  if (!hasPerm) {
    return { frame: null, seq: 0, permissionDenied: true };
  }

  const stream = getOrStartStream(preset, displayIdx);
  scheduleAutoStop(stream);

  // If we already have a newer frame in RAM, return it in <1ms!
  if (stream.latestFrame && stream.frameCount > lastSeq) {
    return { frame: stream.latestFrame, seq: stream.frameCount, permissionDenied: false };
  }

  // Otherwise wait up to 900ms for the next GPU frame (normally arrives in 15-45ms!)
  const frame = await new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      const idx = stream.waiters.indexOf(onFrame);
      if (idx >= 0) stream.waiters.splice(idx, 1);
      resolve(stream.latestFrame);
    }, 900);
    const onFrame = (buf: Buffer | null) => {
      clearTimeout(timer);
      resolve(buf);
    };
    stream.waiters.push(onFrame);
  });

  return {
    frame,
    seq: stream.frameCount,
    permissionDenied: stream.permissionDenied,
  };
}

export async function attachMjpegScreenStream(
  res: Response,
  preset: ScreenQualityPreset = 'turbo',
  displayIdx = 0,
): Promise<void> {
  const hasPerm = await checkScreenCapturePermission();
  if (!hasPerm) {
    res.status(403).json({
      ok: false,
      permissionDenied: true,
      error: 'macOS Screen Recording permission required',
    });
    return;
  }

  const stream = getOrStartStream(preset, displayIdx);
  if (stream.stopTimer) {
    clearTimeout(stream.stopTimer);
    stream.stopTimer = null;
  }

  res.status(200);
  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);

  stream.clients.add(res);

  if (stream.latestFrame) {
    const jpg = stream.latestFrame;
    res.write(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.byteLength}\r\n\r\n`,
    );
    res.write(jpg);
    res.write('\r\n');
  }

  const cleanup = () => {
    stream.clients.delete(res);
    if (stream.clients.size === 0) {
      stream.lastAccessTs = Date.now();
      scheduleAutoStop(stream);
    }
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function getLatestCachedScreenFrame(): Buffer | null {
  for (const s of activeStreams.values()) {
    if (s.latestFrame && Date.now() - s.latestTs < 1000) {
      return s.latestFrame;
    }
  }
  return null;
}
