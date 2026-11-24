// Fusión determinista: dos teléfonos que reciben los mismos cambios llegan al mismo estado,
// sin importar el orden en que lleguen (convergencia tipo CRDT).
import type { Order, StatusEvent, SyncTable } from '../types';
import { hlcMax } from '../hlc';

type Row = Record<string, unknown> & { id: string; _hlc?: string };

const RANK: Record<string, number> = { preparando: 1, listo: 2, enviado: 3, entregado: 4, cancelado: 5 };

export function merge(table: SyncTable, local: Row | undefined, remote: Row): Row {
  if (!local) return remote;
  if (table === 'orders') return mergeOrder(local as unknown as Order, remote as unknown as Order) as unknown as Row;
  const newer = (remote._hlc ?? '') > (local._hlc ?? '') ? remote : local;
  const out: Row = { ...newer };
  if (table === 'expenses' && local.photo && !out.photo) out.photo = local.photo; // la foto completa no viaja
  if (local.deleted || remote.deleted) out.deleted = 1;
  return out;
}

function mergeOrder(a: Order, b: Order): Order {
  const newer = (b._hlc ?? '') > (a._hlc ?? '') ? b : a;
  const out: Order = { ...newer };
  // Estado: siempre avanza (preparando → listo → enviado → entregado), cancelado es final
  const sWin = RANK[b.status] > RANK[a.status] ? b : RANK[a.status] > RANK[b.status] ? a : newer;
  out.status = sWin.status;
  out.statusAt = sWin.statusAt;
  // Pago: una vez pagado, queda pagado
  const pWin = b.payStatus === 'pagado' && a.payStatus !== 'pagado' ? b : a.payStatus === 'pagado' && b.payStatus !== 'pagado' ? a : newer;
  out.payStatus = pWin.payStatus;
  out.payMethod = pWin.payMethod;
  out.payAccount = pWin.payAccount;
  out.cashReceived = pWin.cashReceived;
  out.paidAt = pWin.paidAt;
  if (out.status === 'cancelado') out.cancelReason = a.cancelReason ?? b.cancelReason;
  // Bitácora: unión sin duplicados
  const seen = new Map<string, StatusEvent>();
  [...(a.log ?? []), ...(b.log ?? [])].forEach((e) => seen.set(`${e.status}|${e.at}|${e.detail ?? ''}`, e));
  out.log = [...seen.values()].sort((x, y) => x.at - y.at);
  out.lastNudgeAt = Math.max(a.lastNudgeAt ?? 0, b.lastNudgeAt ?? 0) || undefined;
  out.updatedAt = Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0);
  out._hlc = hlcMax(a._hlc, b._hlc);
  return out;
}

/** Comparación estable (ignora orden de llaves y campos locales). */
export function sameContent(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}

function canon(v: unknown): string {
  return JSON.stringify(v, (k, val) => {
    if (k === 'photo' || k === 'lastNudgeAt') return undefined;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as object)
        .sort()
        .reduce((o, key) => ((o as Record<string, unknown>)[key] = (val as Record<string, unknown>)[key], o), {} as Record<string, unknown>);
    }
    return val;
  });
}
