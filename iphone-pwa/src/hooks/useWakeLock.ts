'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

/**
 * In-memory 1.8 KB MP4 containing BOTH an H.264 video track (avc1) AND a 100% silent
 * AAC audio track (mp4a). Required because iOS WebKit intentionally treats video-only
 * muted streams as animated GIFs and does NOT disable iOS Auto-Lock unless the media
 * element has both video and audio tracks and remains non-occluded in the viewport.
 */
const KEEPAWAKE_MP4_DATA_URI =
  'data:video/mp4;base64,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';

/**
 * Multi-layer Mobile Screen Keep-Awake hook:
 * 1. Native Screen Wake Lock API (`navigator.wakeLock.request('screen')`) called
 *    synchronously on user activation and actively renewed every 12s (before iOS's
 *    minimum 30s Auto-Lock timer can fire, working around iOS standalone PWA drops).
 * 2. Pre-mounted in-memory H.264 + silent AAC `<video>` element with continuous
 *    `timeupdate` seek-looping (`NoSleep.js` technique) so iOS WebKit's
 *    `HTMLMediaElement::shouldDisableSleep()` stays asserted continuously.
 */
export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gestureUnlockedRef = useRef(false);
  const lastGestureAcquireTsRef = useRef(0);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(true);

  const getOrCreateVideo = useCallback((): HTMLVideoElement | null => {
    if (typeof document === 'undefined') return null;
    if (videoRef.current) return videoRef.current;

    const video = document.createElement('video');
    video.src = KEEPAWAKE_MP4_DATA_URI;
    video.loop = true;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0.01;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('disableremoteplayback', 'true');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;

    // Seek back before reaching EOF so iOS WebKit never drops the sleep lock on loop boundary
    video.addEventListener('timeupdate', () => {
      if (video.currentTime > 1.25) {
        video.currentTime = 0.05;
      }
    });

    // Keep inside viewport with zIndex >= 1 & opacity >= 0.015 so WebKit never treats it as occluded
    Object.assign(video.style, {
      position: 'fixed',
      bottom: '1px',
      left: '1px',
      width: '4px',
      height: '4px',
      opacity: '0.015',
      pointerEvents: 'none',
      zIndex: '1',
    });

    document.body.appendChild(video);
    video.load();
    videoRef.current = video;
    return video;
  }, []);

  const acquireWakeLock = useCallback(
    (fromUserGesture = false, forceRenewSentinel = false) => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (typeof navigator === 'undefined') return;

      // 1. Trigger <video>.play() SYNCHRONOUSLY inside the user gesture stack (before any await!)
      const video = getOrCreateVideo();
      let videoPromise: Promise<boolean> = Promise.resolve(false);
      if (video) {
        if (fromUserGesture && !gestureUnlockedRef.current) {
          // Unlock unmuted 0.01-volume silent AAC track on first user gesture so iOS disables sleep
          video.muted = false;
          video.volume = 0.01;
        }
        if (video.paused || (fromUserGesture && !gestureUnlockedRef.current)) {
          const playCall = video.play();
          if (playCall && typeof playCall.then === 'function') {
            videoPromise = playCall
              .then(() => {
                if (fromUserGesture) gestureUnlockedRef.current = true;
                return true;
              })
              .catch(async () => {
                // If unmuted play was blocked, immediately fall back to muted play
                video.muted = true;
                try {
                  await video.play();
                  return !video.paused;
                } catch {
                  return false;
                }
              });
          } else {
            videoPromise = Promise.resolve(!video.paused);
          }
        } else {
          videoPromise = Promise.resolve(true);
        }
      }

      // 2. Request native Screen Wake Lock SYNCHRONOUSLY in parallel (before any await!)
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      let nativePromise: Promise<boolean> = Promise.resolve(false);
      if (nav.wakeLock) {
        setSupported(true);
        const existing = sentinelRef.current;
        if (!existing || existing.released || forceRenewSentinel) {
          nativePromise = nav.wakeLock
            .request('screen')
            .then((nextSentinel) => {
              const prev = sentinelRef.current;
              sentinelRef.current = nextSentinel;
              if (prev && prev !== nextSentinel && !prev.released) {
                void prev.release().catch(() => {});
              }
              nextSentinel.addEventListener('release', () => {
                if (sentinelRef.current === nextSentinel) {
                  sentinelRef.current = null;
                }
              });
              return true;
            })
            .catch(() => Boolean(sentinelRef.current && !sentinelRef.current.released));
        } else {
          nativePromise = Promise.resolve(true);
        }
      }

      void Promise.all([nativePromise, videoPromise]).then(([nativeOk, videoOk]) => {
        if (nativeOk || videoOk) {
          setSupported(true);
          setActive(true);
        } else {
          setActive(false);
        }
      });
    },
    [getOrCreateVideo],
  );

  useEffect(() => {
    // Pre-mount video element immediately so it is buffered before the first tap
    getOrCreateVideo();
    acquireWakeLock(false, false);

    // iOS WebKit grants transient user activation on click / touchend / pointerup / keydown
    const onUserActivation = () => {
      const now = Date.now();
      const hasNative = Boolean(sentinelRef.current && !sentinelRef.current.released);
      const hasVideo = Boolean(videoRef.current && !videoRef.current.paused);
      if (
        !gestureUnlockedRef.current ||
        !hasNative ||
        !hasVideo ||
        now - lastGestureAcquireTsRef.current > 6000
      ) {
        lastGestureAcquireTsRef.current = now;
        acquireWakeLock(true, !hasNative);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock(false, true);
      } else {
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
      }
    };

    const onFocusOrShow = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock(false, true);
      }
    };

    // Actively renew every 12s while visible (well below iOS's minimum 30s Auto-Lock timeout)
    const watchdog = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      acquireWakeLock(false, true);
    }, 12_000);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocusOrShow);
    window.addEventListener('pageshow', onFocusOrShow);
    window.addEventListener('click', onUserActivation, { capture: true, passive: true });
    window.addEventListener('touchend', onUserActivation, { capture: true, passive: true });
    window.addEventListener('pointerup', onUserActivation, { capture: true, passive: true });
    window.addEventListener('pointerdown', onUserActivation, { capture: true, passive: true });
    window.addEventListener('keydown', onUserActivation, { capture: true, passive: true });

    return () => {
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocusOrShow);
      window.removeEventListener('pageshow', onFocusOrShow);
      window.removeEventListener('click', onUserActivation, { capture: true });
      window.removeEventListener('touchend', onUserActivation, { capture: true });
      window.removeEventListener('pointerup', onUserActivation, { capture: true });
      window.removeEventListener('pointerdown', onUserActivation, { capture: true });
      window.removeEventListener('keydown', onUserActivation, { capture: true });
      if (sentinelRef.current && !sentinelRef.current.released) {
        void sentinelRef.current.release().catch(() => {});
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, [acquireWakeLock, getOrCreateVideo]);

  return { active, supported, requestLock: () => acquireWakeLock(true, true) };
}
