import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { db, getDevice } from '../lib/db';
import { elapsedLabel, money } from '../lib/format';
import { advanceOrder, itemsSummary, snoozeOrder } from '../lib/orders';
import { haptic, notifyNow, speak } from '../lib/platform';
import { sfx } from '../lib/sound';
import { useActiveOrders, useBusiness, useDeviceSettings, useNow } from '../lib/hooks';
import type { Business, Mode, Order } from '../lib/types';
import { useBack } from './kit';
import { ChargeFlow } from './pay';

type Nudge = { kind: 'pay' | 'delivered'; order: Order };

async function findNudge(b: Business, now: number): Promise<Nudge | null> {
  const due = (await db.orders.where('payStatus').equals('pendiente').sortBy('createdAt')).filter((o) => o.status !== 'cancelado');
  for (const o of due) {
    if (o.channel === 'domicilio' && o.status !== 'entregado') continue; // el domicilio se cobra al entregar
    if (now - (o.lastNudgeAt ?? o.createdAt) >= b.reminderMinutes * 60000) return { kind: 'pay', order: o };
  }
  const act = await db.orders.where('status').anyOf('listo', 'enviado').sortBy('statusAt');
  for (const o of act) {
    const wait = (o.status === 'listo' && o.channel === 'mostrador' ? b.readyMinutes : o.status === 'enviado' ? b.deliveryMinutes : Infinity) * 60000;
    if (now - (o.lastNudgeAt ?? o.statusAt) >= wait) return { kind: 'delivered', order: o };
  }
  return null;
}

/** Insiste (con cariño) hasta que alguien confirme cobros y entregas. Nada queda en el aire. */
export function Nudges({ paused }: { paused: boolean }) {
  const b = useBusiness();
  const now = useNow(20000);
  const [n, setN] = useState<Nudge | null>(null);
  const [charge, setCharge] = useState<Order | null>(null);
  useEffect(() => {
    if (n || charge || paused) return;
    let alive = true;
    findNudge(b, Date.now()).then((x) => {
      if (alive && x) {
        haptic.warn();
        sfx.warn();
        setN(x);
      }
    });
    return () => {
      alive = false;
    };
  }, [now, n, charge, paused]);
  const later = async () => {
    if (n) await snoozeOrder(n.order.id);
    setN(null);
  };
  useBack(!!n, later);
  return (
    <>
      {n &&
        createPortal(
          <div className="nudge-root">
            <div className="nudge-bg" onClick={later} />
            <div className={`nudge ${n.kind}`}>
              <div className="nudge-ico">{n.kind === 'pay' ? '💰' : '📦'}</div>
              <h3>{n.kind === 'pay' ? `¿Ya pagaron el #${n.order.number}?` : `¿Ya se entregó el #${n.order.number}?`}</h3>
              <div className="muted" style={{ fontWeight: 650 }}>{money(n.order.total)} · hace {elapsedLabel(n.kind === 'pay' ? n.order.createdAt : n.order.statusAt)}{n.order.customer?.name ? ` · ${n.order.customer.name}` : ''}</div>
              <div className="nudge-items">{itemsSummary(n.order.items)}</div>
              <div className="nudge-actions">
                <button className="btn btn-soft" onClick={later}>Aún no</button>
                {n.kind === 'pay' ? (
                  <button className="btn btn-ok" onClick={() => { setCharge(n.order); setN(null); }}>Sí, cobrar</button>
                ) : (
                  <button className="btn btn-ok" onClick={async () => { await advanceOrder(n.order.id, 'entregado'); sfx.done(); haptic.success(); setN(null); }}>Sí, entregado</button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      <ChargeFlow order={charge} onClose={() => setCharge(null)} />
    </>
  );
}

/** Campana + voz cuando entra un pedido (de cualquier teléfono) o cuando cocina lo marca listo. */
export function Announcer({ mode }: { mode: Mode }) {
  const orders = useActiveOrders();
  const dev = useDeviceSettings();
  const known = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = known.current;
    const next = new Map(orders.map((o) => [o.id, o.status]));
    known.current = next;
    if (!prev) return; // primera carga: no anunciar lo que ya estaba
    (async () => {
      const me = (await getDevice()).deviceId;
      for (const o of orders) {
        const before = prev.get(o.id);
        if (!before && o.status === 'preparando') {
          const mine = o.device === me;
          if (!mine || mode === 'cocina') sfx.bell();
          if (!mine) haptic.warn();
          const sayIt = `Nuevo pedido ${o.number}${o.channel === 'domicilio' ? ', domicilio' : ''}: ${o.items.map((i) => `${i.qty} ${i.name}`).join(', ')}`;
          if (dev?.voiceOn && (mode === 'cocina' || (!mine && mode !== 'vender'))) speak(sayIt);
          if (!mine) notifyNow(`🔥 Pedido #${o.number}`, itemsSummary(o.items), o.id);
        } else if (before === 'preparando' && o.status === 'listo' && mode !== 'cocina') {
          sfx.done();
          haptic.success();
          notifyNow(`✅ #${o.number} listo`, o.channel === 'domicilio' ? 'Para salir a domicilio' : 'Para entregar', o.id + 'l');
        }
      }
    })();
  }, [orders.map((o) => o.id + o.status).join()]);
  return null;
}
