import { useMemo, useState } from 'react';
import { advanceOrder, customerMessage } from '../lib/orders';
import { call, haptic, openMaps, openWhatsApp } from '../lib/platform';
import { sfx } from '../lib/sound';
import { money } from '../lib/format';
import { useActiveOrders, useBusiness, useNow } from '../lib/hooks';
import type { Order } from '../lib/types';
import { Empty, Seg } from '../ui/kit';
import { OrderCard, OrderSheet } from '../ui/order';
import { ChargeFlow } from '../ui/pay';
import { celebrate } from '../ui/celebrate';

type Tab = 'entregar' | 'camino' | 'cocina';

/** Despacho: entregar en ventanilla, empacar y sacar domicilios, cobrar al entregar. */
export function Despacho() {
  const biz = useBusiness();
  const now = useNow(15000);
  const all = useActiveOrders();
  const ready = all.filter((o) => o.status === 'listo');
  const onWay = all.filter((o) => o.status === 'enviado');
  const cooking = all.filter((o) => o.status === 'preparando');
  const [tab, setTab] = useState<Tab>('entregar');
  const [open, setOpen] = useState<string | null>(null);
  const [charge, setCharge] = useState<Order | null>(null);
  const list = tab === 'entregar' ? ready : tab === 'camino' ? onWay : cooking;
  const cashToCollect = useMemo(() => onWay.filter((o) => o.payStatus === 'pendiente').reduce((a, o) => a + o.total, 0), [onWay]);

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hello">
        <div className="grow">
          <div className="hello-title">Despacho 🛵</div>
          <div className="hello-sub">Empacar, entregar y cobrar</div>
        </div>
      </div>
      <div className="pad-x" style={{ marginBottom: 12 }}>
        <Seg<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'entregar', label: <>Listos{ready.length ? <span className="cnt">{ready.length}</span> : null}</> },
            { value: 'camino', label: <>En camino{onWay.length ? <span className="cnt">{onWay.length}</span> : null}</> },
            { value: 'cocina', label: <>En cocina{cooking.length ? <span className="cnt">{cooking.length}</span> : null}</> },
          ]}
        />
      </div>
      {tab === 'camino' && cashToCollect > 0 && <div className="callout warn" style={{ margin: '0 16px 12px' }}>💵 Hay que traer <b>&nbsp;{money(cashToCollect)}&nbsp;</b> de domicilios en efectivo.</div>}

      {list.length === 0 && (
        <Empty
          icon={tab === 'entregar' ? '📦' : tab === 'camino' ? '🛵' : '🍳'}
          title={tab === 'entregar' ? 'Nada listo por ahora' : tab === 'camino' ? 'Ningún domicilio en la calle' : 'La cocina está libre'}
          text={tab === 'entregar' ? 'Cuando cocina marque un pedido como listo, aparece aquí con sonido.' : undefined}
        />
      )}

      <div className="olist">
        {list.map((o) =>
          o.channel === 'domicilio' && o.status !== 'preparando' ? (
            <DeliveryCard key={o.id} o={o} onOpen={() => setOpen(o.id)} onCharge={() => setCharge(o)} business={biz.name} />
          ) : (
            <OrderCard key={o.id} o={o} now={now} onOpen={() => setOpen(o.id)} onCharge={() => setCharge(o)} />
          ),
        )}
      </div>
      <OrderSheet id={open} onClose={() => setOpen(null)} onCharge={(o) => setCharge(o)} />
      <ChargeFlow order={charge} onClose={() => setCharge(null)} onPaid={(o) => o.status === 'enviado' && advanceOrder(o.id, 'entregado')} />
    </div>
  );
}

function DeliveryCard({ o, onOpen, onCharge, business }: { o: Order; onOpen: () => void; onCharge: () => void; business: string }) {
  const [leaving, setLeaving] = useState(false);
  const go = async () => {
    haptic.success();
    if (o.status === 'listo') {
      sfx.done();
      setLeaving(true);
      setTimeout(() => advanceOrder(o.id, 'enviado'), 300);
      if (o.customer?.phone) openWhatsApp(o.customer.phone, customerMessage({ ...o, status: 'enviado' }, business));
    } else {
      if (o.payStatus === 'pendiente') return onCharge();
      setLeaving(true);
      celebrate({ title: `#${o.number}`, sub: 'Entregado 🎉', icon: '🛵' });
      setTimeout(() => advanceOrder(o.id, 'entregado'), 300);
    }
  };
  return (
    <article className={`ocard ${o.customer?.urgent ? 'urgent' : ''} ${leaving ? 'leaving' : ''}`} onClick={onOpen}>
      <div className="o-head">
        <div className="o-num">#{o.number}</div>
        <div className="o-tags">
          <span className="tag dom">🛵 {o.status === 'listo' ? 'Para salir' : 'En camino'}</span>
          {o.customer?.urgent && <span className="tag urg">Urgente</span>}
        </div>
        <div className="o-total" style={{ fontSize: 20 }}>{money(o.total)}</div>
      </div>
      {o.customer?.address && <div className="addr"><span className="e">📍</span><span>{o.customer.address}{o.customer.name ? <><br /><span className="muted" style={{ fontWeight: 650, fontSize: 14 }}>{o.customer.name}</span></> : null}</span></div>}
      <div className="o-items">{o.items.map((i, k) => <div key={k} className="o-item"><b>{i.qty}×</b><span>{i.name}{i.note && <span className="o-note">{i.note}</span>}</span></div>)}</div>
      <div className="mini-actions" onClick={(e) => e.stopPropagation()}>
        {o.customer?.address && <button className="mini" onClick={() => openMaps(o.customer!.address!)}>🗺️ Mapa</button>}
        {o.customer?.phone && <button className="mini" onClick={() => call(o.customer!.phone!)}>📞 Llamar</button>}
        <button className="mini" style={{ background: '#dcf8e7', color: '#0c6b3a' }} onClick={() => openWhatsApp(o.customer?.phone, customerMessage(o, business))}>💬 Avisar</button>
      </div>
      <div className="o-foot">
        {o.payStatus === 'pagado' ? <span className="tag paid">✓ Pagado · {o.payMethod === 'transferencia' ? o.payAccount : 'efectivo'}</span> : <span className="tag due">Cobrar {money(o.total)}{o.cashReceived ? ` · paga con ${money(o.cashReceived)}` : ''}</span>}
      </div>
      <div className="o-actions" onClick={(e) => e.stopPropagation()}>
        {o.status === 'enviado' && o.payStatus === 'pendiente' && <button className="btn btn-due" onClick={onCharge}>💰 Cobrar</button>}
        <button className={`btn grow ${o.status === 'listo' ? 'btn-go' : 'btn-ok'}`} onClick={go}>{o.status === 'listo' ? 'Salió a entregar 🛵' : o.payStatus === 'pendiente' ? 'Cobrar y entregar ✓' : 'Entregado ✓'}</button>
      </div>
    </article>
  );
}
