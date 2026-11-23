'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

/**
 * Dual-layer mobile Keep-Awake hook:
 * 1. Native Screen Wake Lock API (`navigator.wakeLock.request('screen')`)
 * 2. Silent looping inline H.264 MP4 fallback (`/keepawake.mp4`) for iOS Safari /
 *    Home Screen standalone PWAs where WebKit can ignore or drop Screen Wake Lock.
 *
 * Automatically acquires on load + first touch, re-acquires on visibility/focus/pageshow,
 * self-heals every 20s while visible, and pauses cleanly when backgrounded to save battery.
 */
export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(true);

  const ensureKeepAwakeVideo = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined') return false;
    try {
      let video = videoRef.current;
      if (!video) {
        video = document.createElement('video');
        video.src = '/keepawake.mp4';
        video.loop = true;
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
        // Must remain rendered (1x1 at near-zero opacity) so iOS WebKit treats it as active playback
        Object.assign(video.style, {
          position: 'fixed',
          bottom: '0px',
          right: '0px',
          width: '1px',
          height: '1px',
          opacity: '0.001',
          pointerEvents: 'none',
          zIndex: '-1',
        });
        document.body.appendChild(video);
        videoRef.current = video;
      }

      if (video.paused) {
        await video.play();
      }
      return !video.paused;
    } catch {
      return false;
    }
  }, []);

  const requestLock = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (typeof navigator === 'undefined') return;

    let locked = false;

    // Layer 1: Native Screen Wake Lock API
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (nav.wakeLock) {
      setSupported(true);
      try {
        if (!sentinelRef.current || sentinelRef.current.released) {
          const sentinel = await nav.wakeLock.request('screen');
          sentinelRef.current = sentinel;
          sentinel.addEventListener('release', () => {
            if (sentinelRef.current === sentinel) {
              sentinelRef.current = null;
            }
            const videoPlaying = Boolean(videoRef.current && !videoRef.current.paused);
            setActive(videoPlaying);
          });
        }
        locked = Boolean(sentinelRef.current && !sentinelRef.current.released);
      } catch {
        // iOS standalone PWA or pre-gesture call may reject; Layer 2 handles it
      }
    }

    // Layer 2: Silent inline H.264 video fallback (prevents iPhone Auto-Lock in Safari & PWA)
    const videoOk = await ensureKeepAwakeVideo();
    if (videoOk) {
      setSupported(true);
      locked = true;
    }

    setActive(locked);
  }, [ensureKeepAwakeVideo]);

  useEffect(() => {
    void requestLock();

    const onUserGesture = () => {
      const hasNative = Boolean(sentinelRef.current && !sentinelRef.current.released);
      const hasVideo = Boolean(videoRef.current && !videoRef.current.paused);
      if (!hasNative || !hasVideo) {
        void requestLock();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestLock();
      } else {
        // Pause fallback video when app is backgrounded so battery isn't drained
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
      }
    };

    const onFocusOrShow = () => {
      if (document.visibilityState === 'visible') {
        void requestLock();
      }
    };

    // Self-heal every 20s in case iOS silently releases wake lock
    const watchdog = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const hasNative = Boolean(sentinelRef.current && !sentinelRef.current.released);
      const hasVideo = Boolean(videoRef.current && !videoRef.current.paused);
      if (!hasNative || !hasVideo) {
        void requestLock();
      }
    }, 20_000);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocusOrShow);
    window.addEventListener('pageshow', onFocusOrShow);
    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('touchstart', onUserGesture, { passive: true });

    return () => {
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocusOrShow);
      window.removeEventListener('pageshow', onFocusOrShow);
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('touchstart', onUserGesture);
      if (sentinelRef.current && !sentinelRef.current.released) {
        void sentinelRef.current.release();
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, [requestLock]);

  return { active, supported, requestLock };
}
