'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'devdeck.clock.breakUntil';

export function useDeskBreak(onComplete: () => void) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const changeDeadline = useCallback((value: number | null) => {
    setDeadline(value);
    try {
      if (value === null) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, String(value));
    } catch { /* The timer still works in memory. */ }
  }, []);

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setDeadline(saved);
    } catch { /* Storage can be unavailable in private browsing. */ }
  }, []);

  useEffect(() => {
    if (deadline === null) return;
    let finished = false;
    let timer: number;
    const check = () => {
      window.clearTimeout(timer);
      if (finished) return;
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(check, Math.min(remaining, 2_147_483_647));
        return;
      }
      finished = true;
      changeDeadline(null);
      onComplete();
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [deadline, changeDeadline, onComplete]);

  return { deadline, changeDeadline };
}
