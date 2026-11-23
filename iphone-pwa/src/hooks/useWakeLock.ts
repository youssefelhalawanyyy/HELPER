'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  const requestLock = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) {
      setSupported(false);
      return;
    }
    setSupported(true);
    try {
      const sentinel = await nav.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener('release', () => {
        setActive(false);
      });
    } catch {
      setActive(false);
    }
  }, []);

  useEffect(() => {
    void requestLock();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestLock();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinelRef.current && !sentinelRef.current.released) {
        void sentinelRef.current.release();
      }
    };
  }, [requestLock]);

  return { active, supported, requestLock };
}
