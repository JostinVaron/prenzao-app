import { useEffect, useMemo, useState } from 'react';
import { advanceOrder } from '../lib/orders';
import { haptic, keepAwake, speak } from '../lib/platform';
import { sfx } from '../lib/sound';
import { minutesSince } from '../lib/format';
import { setDevice } from '../lib/db';
import { useActiveOrders, useBusiness, useDeviceSettings, useNow } from '../lib/hooks';
import type { Order } from '../lib/types';
import { Empty } from '../ui/kit';
import { burst } from '../ui/celebrate';

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Cocina() {
  const biz = useBusiness();
  const dev = useDeviceSettings();
  const now = useNow(1000);
  const all = useActiveOrders();
  const queue = useMemo(() => all.filter((o) => o.status === 'preparando').sort((a, b) => Number(!!b.customer?.urgent) - Number(!!a.customer?.urgent) || a.createdAt - b.createdAt), [all]);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [doneToday, setDoneToday] = useState(0);

  useEffect(() => {
    keepAwake(true);
    return () => {
      keepAwake(false);
    };
  }, []);

  // resumen de producción: cuántos de cada cosa hay que hacer
  const summary = useMemo(() => {
    const m = new Map<string, { name: string; qty: number }>();
    queue.forEach((o) => o.items.forEach((i) => {
      const cur = m.get(i.productId) ?? { name: i.name, qty: 0 };
      cur.qty += i.qty;
      m.set(i.productId, cur);
    }));
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [queue]);

  const done = (o: Order) => {
    haptic.success();
    sfx.done();
    setLeaving(new Set(leaving).add(o.id));
    setDoneToday((n) => n + 1);
    const fast = minutesSince(o.createdAt) < biz.prepTargetMin;
    if (fast) burst('small');
    if (dev?.voiceOn) speak(`Pedido ${o.number} listo${o.customer?.name ? `, de ${o.customer.name.split(' ')[0]}` : ''}`);
    setTimeout(() => advanceOrder(o.id, 'listo'), 380);
  };

  const target = biz.prepTargetMin * 60000;

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hello">
        <div className="grow">
          <div className="hello-title" style={{ color: '#fff' }}>Cocina 🔥</div>
          <div className="hello-sub">{queue.length ? `${queue.length} ${queue.length === 1 ? 'pedido' : 'pedidos'} en fila` : 'Fila vacía'}{doneToday ? ` · ${doneToday} despachados en este turno` : ''}</div>
        </div>
        <button className="icon-btn" aria-label="Voz" onClick={() => { setDevice({ voiceOn: !dev?.voiceOn }); haptic.tap(); }}>{dev?.voiceOn ? '🔊' : '🔇'}</button>
      </div>

      {summary.length > 0 && (
        <div className="kds-summary">
          {summary.map((s) => <div key={s.name} className="kds-sum"><b>{s.qty}</b>{s.name}</div>)}
        </div>
      )}

      {queue.length === 0 && <Empty icon="👨‍🍳" title="Todo despachado" text="Cuando entre un pedido suena la campana y lo anuncio en voz alta." />}

      <div className="kds">
        {queue.map((o) => {
          const el = now - o.createdAt;
          const pct = Math.min(1, el / target);
          const tone = el > target * 1.6 ? 'late' : el > target ? 'warm' : '';
          return (
            <article key={o.id} className={`kcard ${now - o.createdAt < 20000 ? 'new' : ''} ${leaving.has(o.id) ? 'leaving' : ''}`}>
              <div className="k-head">
                <div className="k-num">#{o.number}</div>
                <div className="o-tags" style={{ flex: 'none' }}>
                  {o.channel === 'domicilio' ? <span className="tag dom">🛵 Domicilio</span> : <span className="tag">🏪 Aquí</span>}
                  {o.customer?.urgent && <span className="tag urg">⚡ Urgente</span>}
                </div>
                <div className="k-time" style={{ color: tone === 'late' ? '#ff6b61' : tone === 'warm' ? '#ffc94d' : '#fff' }}>
                  {clock(el)}<small>{tone === 'late' ? 'atrasado' : 'tiempo'}</small>
                </div>
              </div>
              <div className="k-bar"><i className={tone} style={{ width: `${pct * 100}%` }} /></div>
              <div className="k-items">
                {o.items.map((i, k) => (
                  <div key={k}>
                    <div className="k-item"><b>{i.qty}</b><span>{i.name}</span></div>
                    {i.note && <span className="k-note">⚠ {i.note}</span>}
                  </div>
                ))}
              </div>
              {o.customer?.name && <div className="muted" style={{ fontWeight: 650 }}>Para {o.customer.name}</div>}
              <button className="k-done" onClick={() => done(o)}>¡Listo! ✓</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
