export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('es-CO')}`;
}

/** Día operativo: antes de la hora de corte, cuenta como el día anterior. */
export function dayKeyOf(ts: number, cutoffHour = 4): string {
  const d = new Date(ts);
  if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDayKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays, 12);
  return dayKeyOf(dt.getTime(), 0);
}

export function timeHM(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Hoy';
  if (key === shiftDayKey(todayKey, -1)) return 'Ayer';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });
}

export function minutesSince(ts: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - ts) / 60000));
}

export function elapsedLabel(ts: number, now = Date.now()): string {
  const m = minutesSince(ts, now);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}
