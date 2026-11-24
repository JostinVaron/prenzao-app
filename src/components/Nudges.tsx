import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, PackageCheck } from 'lucide-react';
import { db } from '../lib/db';
import { elapsedLabel, money } from '../lib/format';
import { advanceOrder, itemsSummary, snoozeOrder } from '../lib/orders';
import { haptic } from '../lib/platform';
import { useNow, useSettings } from '../lib/hooks';
import type { Order, Settings } from '../lib/types';
import { ChargeSheet } from '../screens/Pedidos';
import { useBackHandler } from './ui';

type Nudge = { kind: 'pay' | 'delivered'; order: Order };

async function findNudge(s: Settings, now: number): Promise<Nudge | null> {
  const pend = (await db.orders.where('payStatus').equals('pendiente').sortBy('createdAt')).filter((o) => o.status !== 'cancelado');
  for (const o of pend) {
    // domicilio aún en cocina: no tiene sentido pedir el pago todavía
    if (o.channel === 'domicilio' && (o.status === 'preparando' || o.status === 'listo')) continue;
    if (now - (o.lastNudgeAt ?? o.createdAt) >= s.reminderMinutes * 60000) return { kind: 'pay', order: o };
  }
  const act = await db.orders.where('status').anyOf('listo', 'enviado').sortBy('statusAt');
  for (const o of act) {
    const wait = (o.status === 'listo' && o.channel === 'mostrador' ? s.readyMinutes : o.status === 'enviado' ? s.deliveryMinutes : Infinity) * 60000;
    if (now - (o.lastNudgeAt ?? o.statusAt) >= wait) return { kind: 'delivered', order: o };
  }
  return null;
}

/** Motor "a prueba de no usarla": insiste hasta que alguien confirme pagos y entregas. */
export function Nudges() {
  const s = useSettings();
  const now = useNow(20000);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [charge, setCharge] = useState<Order | null>(null);

  useEffect(() => {
    if (nudge || charge) return;
    let alive = true;
    findNudge(s, Date.now()).then((n) => {
      if (alive && n) {
        haptic.warn();
        setNudge(n);
      }
    });
    return () => {
      alive = false;
    };
  }, [now, nudge, charge, s.reminderMinutes, s.readyMinutes, s.deliveryMinutes]);

  useBackHandler(!!nudge, () => later());

  const later = async () => {
    if (!nudge) return;
    await snoozeOrder(nudge.order.id);
    setNudge(null);
  };

  return (
    <>
      {nudge &&
        createPortal(
          <div className="nudge-root">
            <div className="nudge-backdrop" />
            <div className={`nudge ${nudge.kind}`}>
              <div className="nudge-icon">{nudge.kind === 'pay' ? <BellRing size={28} /> : <PackageCheck size={28} />}</div>
              <div className="nudge-title">
                {nudge.kind === 'pay' ? `¿Ya pagaron el pedido #${nudge.order.number}?` : `¿Ya se entregó el pedido #${nudge.order.number}?`}
              </div>
              <div className="nudge-sub">
                {money(nudge.order.total)} · hace {elapsedLabel(nudge.kind === 'pay' ? nudge.order.createdAt : nudge.order.statusAt)}
                {nudge.order.customer?.name ? ` · ${nudge.order.customer.name}` : ''}
              </div>
              <div className="nudge-items">{itemsSummary(nudge.order.items)}</div>
              <div className="nudge-actions">
                <button className="btn btn-plain" onClick={later}>Aún no</button>
                {nudge.kind === 'pay' ? (
                  <button className="btn btn-primary" onClick={() => { setCharge(nudge.order); setNudge(null); }}>Sí, confirmar pago</button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      await advanceOrder(nudge.order.id, 'entregado');
                      haptic.success();
                      setNudge(null);
                    }}
                  >
                    Sí, entregado
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      <ChargeSheet order={charge} onClose={() => setCharge(null)} />
    </>
  );
}
