import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_BUSINESS } from './db';
import { dayKeyOf } from './format';
import { sync, type SyncStatus } from './sync/engine';
import type { Business, DeviceSettings, Order, Person } from './types';

export function useBusiness(): Business {
  const row = useLiveQuery(() => db.config.get('business'), []);
  return { ...DEFAULT_BUSINESS, ...(row ?? {}) };
}

export function useDeviceSettings(): DeviceSettings | undefined {
  // solo lectura: getDevice() (que puede escribir) se llama al arrancar, fuera de liveQuery
  const row = useLiveQuery(async () => (await db.kv.get('device'))?.value as DeviceSettings | undefined, []);
  return row;
}

export function usePeople(): Person[] {
  return useLiveQuery(async () => (await db.people.toArray()).filter((p) => p.active && !p.deleted).sort((a, b) => a.createdAt - b.createdAt), []) ?? [];
}

export function useMe(): Person | undefined {
  const dev = useDeviceSettings();
  return useLiveQuery(() => (dev?.personId ? db.people.get(dev.personId) : undefined), [dev?.personId]);
}

export function useNow(ms = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTodayKey(): string {
  const b = useBusiness();
  const now = useNow(60000);
  return dayKeyOf(now, b.dayCutoffHour);
}

/** Pedidos activos (no entregados ni cancelados), en vivo desde cualquier teléfono. */
export function useActiveOrders(): Order[] {
  return useLiveQuery(() => db.orders.where('status').anyOf('preparando', 'listo', 'enviado').sortBy('createdAt'), []) ?? [];
}

export function useDueOrders(): Order[] {
  return useLiveQuery(async () => (await db.orders.where('payStatus').equals('pendiente').sortBy('createdAt')).filter((o) => o.status !== 'cancelado' && !o.deleted), []) ?? [];
}

export function useTodayOrders(dayKey: string): Order[] {
  return useLiveQuery(() => db.orders.where('dayKey').equals(dayKey).toArray(), [dayKey]) ?? [];
}

export function useSync(): SyncStatus {
  const [s, setS] = useState(sync.status);
  useEffect(() => {
    const off = sync.subscribe(setS);
    return () => {
      off();
    };
  }, []);
  return s;
}

/** Número que "cuenta" hasta su valor (sensación de premio). */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** Ranking de productos de los últimos 14 días (para mostrar primero lo que más sale). */
export function useTopProducts(limit = 6): string[] {
  return (
    useLiveQuery(async () => {
      const since = Date.now() - 14 * 86400000;
      const orders = await db.orders.where('createdAt').above(since).toArray();
      const m = new Map<string, number>();
      orders.filter((o) => o.status !== 'cancelado').forEach((o) => o.items.forEach((i) => m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty)));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    }, [limit]) ?? []
  );
}
