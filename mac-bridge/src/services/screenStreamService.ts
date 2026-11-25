import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Response } from 'express';
import { captureScreenPeekJpeg } from '../macos/hardware.js';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_SRC = path.resolve(__dirname, '../../native/screen_stream.m');
const NATIVE_BIN = path.join(os.tmpdir(), 'devdeck-screen-stream-v1');

export type ScreenQualityPreset = 'turbo' | 'balanced' | 'hd';

interface StreamProfile {
  width: number;
  quality: number;
  fps: number;
}

const PROFILES: Record<ScreenQualityPreset, StreamProfile> = {
  turbo: { width: 760, quality: 0.46, fps: 22 },
  balanced: { width: 960, quality: 0.6, fps: 16 },
  hd: { width: 1280, quality: 0.74, fps: 11 },
};

interface ActiveStream {
  key: string;
  proc: ChildProcess | null;
  clients: Set<Response>;
  latestFrame: Buffer | null;
  latestTs: number;
  frameCount: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
  fallbackTimer: ReturnType<typeof setInterval> | null;
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

function broadcastFrame(stream: ActiveStream, jpeg: Buffer) {
  stream.latestFrame = jpeg;
  stream.latestTs = Date.now();
  stream.frameCount += 1;
  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`,
  );
  const tail = Buffer.from('\r\n');
  for (const res of stream.clients) {
    if (res.writableEnded || res.destroyed) {
      stream.clients.delete(res);
      continue;
    }
    // Skip frame if socket backpressure is high so latency stays near-zero!
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
  activeStreams.delete(stream.key);
}

async function startCaptureLoop(stream: ActiveStream, preset: ScreenQualityPreset) {
  const prof = PROFILES[preset];
  const nativeBin = await ensureNativeStreamer();

  if (nativeBin) {
    const proc = spawn(
      nativeBin,
      [String(prof.width), String(prof.quality), String(prof.fps), '0'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    stream.proc = proc;

    let buf: Buffer = Buffer.alloc(0);
    proc.stdout.on('data', (chunk: Buffer) => {
      buf = buf.byteLength === 0 ? chunk : Buffer.concat([buf, chunk]);
      while (buf.byteLength >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0 || len > 8 * 1024 * 1024) {
          buf = Buffer.alloc(0);
          break;
        }
        if (buf.byteLength < 4 + len) break;
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        broadcastFrame(stream, frame);
      }
    });

    proc.on('exit', () => {
      if (stream.proc === proc) stream.proc = null;
      if (stream.clients.size === 0) {
        activeStreams.delete(stream.key);
      } else if (stream.frameCount === 0 && !stream.fallbackTimer) {
        // Fallback if ScreenCaptureKit permission is unavailable
        let busy = false;
        const intervalMs = Math.max(120, Math.round(1000 / Math.min(10, prof.fps)));
        stream.fallbackTimer = setInterval(() => {
          if (busy || stream.clients.size === 0) return;
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
    });
    return;
  }

  // Fallback (Windows or if clang unavailable): tight non-overlapping capture loop
  let busy = false;
  const intervalMs = Math.max(85, Math.round(1000 / Math.min(12, prof.fps)));
  stream.fallbackTimer = setInterval(() => {
    if (busy || stream.clients.size === 0) return;
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

export async function attachMjpegScreenStream(
  res: Response,
  preset: ScreenQualityPreset = 'turbo',
): Promise<void> {
  const key = preset;
  let stream = activeStreams.get(key);
  if (!stream) {
    stream = {
      key,
      proc: null,
      clients: new Set(),
      latestFrame: null,
      latestTs: 0,
      frameCount: 0,
      stopTimer: null,
      fallbackTimer: null,
    };
    activeStreams.set(key, stream);
    void startCaptureLoop(stream, preset);
  } else if (stream.stopTimer) {
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

  // Immediately push the latest cached frame if available so first paint is <5ms!
  if (stream.latestFrame) {
    const jpg = stream.latestFrame;
    res.write(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.byteLength}\r\n\r\n`,
    );
    res.write(jpg);
    res.write('\r\n');
  }

  const cleanup = () => {
    stream?.clients.delete(res);
    if (stream && stream.clients.size === 0 && !stream.stopTimer) {
      stream.stopTimer = setTimeout(() => {
        if (stream && stream.clients.size === 0) {
          stopStream(stream);
        }
      }, 1500);
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
