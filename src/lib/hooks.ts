import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from './db';
import { dayKeyOf } from './format';
import type { Settings } from './types';

export function useSettings(): Settings {
  const row = useLiveQuery(() => db.kv.get('settings'), []);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

/** Reloj que re-renderiza cada `ms` (para tiempos transcurridos en vivo). */
export function useNow(ms = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTodayKey(): string {
  const s = useSettings();
  const now = useNow(60000);
  return dayKeyOf(now, s.dayCutoffHour);
}
