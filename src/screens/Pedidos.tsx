import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bike, ChevronLeft, ChevronRight, Clock, MapPin, MessageCircle, Phone, Store, Wallet, XCircle, ClipboardList, CircleDollarSign } from 'lucide-react';
import { db } from '../lib/db';
import { dayLabel, elapsedLabel, minutesSince, money, shiftDayKey, timeHM } from '../lib/format';
import { advanceOrder, cancelOrder, itemsSummary, markPaid, NEXT_ACTION_LABEL, nextStatus, STATUS_LABEL, whatsappStatusText } from '../lib/orders';
import { haptic, openWhatsApp } from '../lib/platform';
import { useNow, useSettings, useTodayKey } from '../lib/hooks';
import type { Order, PayMethod } from '../lib/types';
import { Chips, Empty, Field, MoneyInput, PromptSheet, Segmented, Sheet, toast } from '../components/ui';

type Tab = 'activos' | 'cobrar' | 'historial';

export function Pedidos() {
  const [tab, setTab] = useState<Tab>('activos');
  const todayKey = useTodayKey();
  const [histDay, setHistDay] = useState<string | null>(null);
  const day = histDay ?? todayKey;
  const now = useNow(15000);
  const [detail, setDetail] = useState<string | null>(null);
  const [charge, setCharge] = useState<Order | null>(null);

  const active = useLiveQuery(() => db.orders.where('status').anyOf('preparando', 'listo', 'enviado').sortBy('createdAt'), []) ?? [];
  const pending = useLiveQuery(async () => (await db.orders.where('payStatus').equals('pendiente').sortBy('createdAt')).filter((o) => o.status !== 'cancelado'), []) ?? [];
  const history = useLiveQuery(async () => (await db.orders.where('dayKey').equals(day).reverse().sortBy('createdAt')).filter((o) => o.status === 'entregado' || o.status === 'cancelado'), [day]) ?? [];

  const list = tab === 'activos' ? active : tab === 'cobrar' ? pending : history;
  const detailOrder = useLiveQuery(() => (detail ? db.orders.get(detail) : undefined), [detail]);

  return (
    <div className="screen">
      <header className="large-head">
        <div className="eyebrow">{active.length ? `${active.length} en curso` : 'Sin pedidos en curso'}</div>
        <h1 className="large-title">Pedidos</h1>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'activos', label: <>En curso{active.length ? <b className="seg-badge">{active.length}</b> : null}</> },
            { value: 'cobrar', label: <>Por cobrar{pending.length ? <b className="seg-badge red">{pending.length}</b> : null}</> },
            { value: 'historial', label: 'Historial' },
          ]}
        />
      </header>

      {tab === 'historial' && (
        <div className="day-nav">
          <button className="icon-btn round" onClick={() => setHistDay(shiftDayKey(day, -1))} aria-label="Día anterior"><ChevronLeft size={18} /></button>
          <span>{dayLabel(day, todayKey)}</span>
          <button className="icon-btn round" disabled={day >= todayKey} onClick={() => setHistDay(shiftDayKey(day, 1))} aria-label="Día siguiente"><ChevronRight size={18} /></button>
        </div>
      )}

      {tab === 'cobrar' && pending.length > 0 && (
        <div className="callout danger big">
          <CircleDollarSign size={20} /> Por cobrar: <b>{money(pending.reduce((a, o) => a + o.total, 0))}</b>
        </div>
      )}

      <div className="order-list">
        {list.length === 0 && (
          <Empty
            icon={<ClipboardList size={30} />}
            title={tab === 'activos' ? 'Todo al día' : tab === 'cobrar' ? 'Nada pendiente por cobrar' : 'Sin pedidos cerrados'}
            text={tab === 'activos' ? 'Los pedidos nuevos aparecen aquí apenas se confirman.' : undefined}
          />
        )}
        {list.map((o) => (
          <OrderCard key={o.id} o={o} now={now} onOpen={() => setDetail(o.id)} onCharge={() => setCharge(o)} />
        ))}
      </div>

      <OrderDetail order={detailOrder ?? null} onClose={() => setDetail(null)} onCharge={(o) => setCharge(o)} />
      <ChargeSheet order={charge} onClose={() => setCharge(null)} />
    </div>
  );
}

function ageTone(o: Order, now: number) {
  if (o.status === 'entregado' || o.status === 'cancelado') return '';
  const m = minutesSince(o.createdAt, now);
  if (m >= 25) return 'late';
  if (m >= 15) return 'warm';
  return '';
}

export function OrderCard({ o, now, onOpen, onCharge }: { o: Order; now: number; onOpen: () => void; onCharge: () => void }) {
  const next = nextStatus(o);
  const closed = o.status === 'entregado' || o.status === 'cancelado';
  return (
    <article className={`order ${o.status} ${o.customer?.urgent ? 'urgent' : ''}`} onClick={onOpen}>
      <div className="order-top">
        <div className="order-num">#{o.number}</div>
        <div className="order-meta">
          <span className={`pill ${o.channel}`}>{o.channel === 'domicilio' ? <Bike size={13} /> : <Store size={13} />}{o.channel === 'domicilio' ? 'Domicilio' : 'Mostrador'}</span>
          {o.customer?.urgent && <span className="pill urgent">Urgente</span>}
          <span className={`pill status-${o.status}`}>{STATUS_LABEL[o.status]}</span>
        </div>
        <div className={`order-age ${ageTone(o, now)}`}>
          <Clock size={13} /> {closed ? timeHM(o.createdAt) : elapsedLabel(o.createdAt, now)}
        </div>
      </div>
      <div className="order-items">{itemsSummary(o.items)}</div>
      {o.customer?.name || o.customer?.address ? (
        <div className="order-cust">{[o.customer?.name, o.customer?.address].filter(Boolean).join(' · ')}</div>
      ) : null}
      <div className="order-bottom">
        <div className="order-total">{money(o.total)}</div>
        {o.status !== 'cancelado' && (
          o.payStatus === 'pagado' ? (
            <span className="pay ok">Pagado · {o.payMethod === 'transferencia' ? o.payAccount ?? 'Transf.' : 'Efectivo'}</span>
          ) : (
            <span className="pay due">Pago pendiente</span>
          )
        )}
      </div>
      {!closed && (
        <div className="order-actions" onClick={(e) => e.stopPropagation()}>
          {o.payStatus === 'pendiente' && (
            <button className="btn btn-due" onClick={() => { haptic.tap(); onCharge(); }}><Wallet size={17} /> Cobrar</button>
          )}
          {next && (
            <button
              className="btn btn-primary grow"
              onClick={async () => {
                haptic.success();
                await advanceOrder(o.id);
              }}
            >
              {NEXT_ACTION_LABEL[next]}
            </button>
          )}
        </div>
      )}
      {o.status === 'entregado' && o.payStatus === 'pendiente' && (
        <div className="order-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-due grow" onClick={() => onCharge()}><Wallet size={17} /> Entregado sin cobrar · Cobrar ahora</button>
        </div>
      )}
    </article>
  );
}

const CANCEL_REASONS = ['Cliente desistió', 'Error al registrar', 'Producto agotado', 'Cliente no contestó', 'Dirección fuera de zona'];

function OrderDetail({ order, onClose, onCharge }: { order: Order | null; onClose: () => void; onCharge: (o: Order) => void }) {
  const s = useSettings();
  const [cancel, setCancel] = useState(false);
  const o = order;
  const next = o ? nextStatus(o) : null;
  return (
    <>
      <Sheet open={!!o} onClose={onClose} full title={o ? `Pedido #${o.number}` : ''} subtitle={o ? `${timeHM(o.createdAt)} · ${STATUS_LABEL[o.status]}` : ''}>
        {o && (
          <>
            <div className="group">
              {o.items.map((it, i) => (
                <div key={i} className="line static">
                  <div className="line-qty">{it.qty}×</div>
                  <div className="line-main">
                    <div className="line-name">{it.name}</div>
                    {it.note && <div className="line-note-text">{it.note}</div>}
                  </div>
                  <div className="line-total">{money(it.qty * it.price)}</div>
                </div>
              ))}
              {o.deliveryFee > 0 && (
                <div className="line static"><div className="line-qty" /><div className="line-main"><div className="line-name muted">Domicilio</div></div><div className="line-total">{money(o.deliveryFee)}</div></div>
              )}
              <div className="line static total"><div className="line-qty" /><div className="line-main"><div className="line-name">Total</div></div><div className="line-total">{money(o.total)}</div></div>
            </div>

            <div className="group pad">
              <div className="kv"><span>Pago</span><b className={o.payStatus === 'pagado' ? 'ok-text' : 'due-text'}>{o.payStatus === 'pagado' ? `Pagado · ${o.payMethod === 'transferencia' ? `Transferencia ${o.payAccount ?? ''}` : 'Efectivo'}` : 'Pendiente'}</b></div>
              {o.cashReceived ? <div className="kv"><span>Recibido / cambio</span><b>{money(o.cashReceived)} / {money(o.cashReceived - o.total)}</b></div> : null}
              {o.cancelReason && <div className="kv"><span>Motivo cancelación</span><b>{o.cancelReason}</b></div>}
            </div>

            {o.customer && (o.customer.phone || o.customer.address || o.customer.name) && (
              <div className="group pad">
                {o.customer.name && <div className="kv"><span>Cliente</span><b>{o.customer.name}</b></div>}
                {o.customer.address && <div className="kv"><span><MapPin size={14} /> Dirección</span><b>{o.customer.address}</b></div>}
                {o.customer.phone && (
                  <>
                    <div className="kv"><span><Phone size={14} /> Celular</span><b>{o.customer.phone}</b></div>
                    <button className="btn btn-wa btn-block" onClick={() => openWhatsApp(o.customer!.phone!, whatsappStatusText(o, s.businessName))}>
                      <MessageCircle size={18} /> Avisar estado por WhatsApp
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="section-title">Línea de tiempo</div>
            <div className="group pad timeline">
              {o.log.map((e, i) => (
                <div key={i} className="tl">
                  <span className="tl-dot" />
                  <span className="tl-time">{timeHM(e.at)}</span>
                  <span className="tl-text">{e.status === 'pago' ? `Pago confirmado${e.detail ? ' · ' + e.detail : ''}` : e.status === 'nota' ? e.detail : STATUS_LABEL[e.status as keyof typeof STATUS_LABEL]}{e.status === 'cancelado' && e.detail ? ` · ${e.detail}` : ''}</span>
                </div>
              ))}
            </div>

            {o.status !== 'cancelado' && (
              <div className="detail-actions">
                {o.payStatus === 'pendiente' && <button className="btn btn-due btn-block" onClick={() => onCharge(o)}><Wallet size={18} /> Confirmar pago</button>}
                {next && <button className="btn btn-primary btn-block" onClick={async () => { haptic.success(); await advanceOrder(o.id); }}>{NEXT_ACTION_LABEL[next]}</button>}
                {o.status !== 'entregado' && <button className="btn btn-plain danger btn-block" onClick={() => setCancel(true)}><XCircle size={18} /> Cancelar pedido</button>}
              </div>
            )}
          </>
        )}
      </Sheet>
      <PromptSheet
        open={cancel}
        title="¿Por qué se cancela?"
        message="Queda registrado con hora. Los pedidos no se borran."
        placeholder="Escribe el motivo"
        quick={CANCEL_REASONS}
        confirmLabel="Cancelar pedido"
        danger
        onClose={() => setCancel(false)}
        onConfirm={async (reason) => {
          if (!o) return;
          await cancelOrder(o.id, reason);
          haptic.warn();
          setCancel(false);
          toast(`Pedido #${o.number} cancelado`, 'warn');
        }}
      />
    </>
  );
}

export function ChargeSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const s = useSettings();
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [account, setAccount] = useState<string | undefined>();
  const [received, setReceived] = useState(0);
  const m: PayMethod = method ?? order?.payMethod ?? 'efectivo';
  const acc = account ?? (m === 'transferencia' ? order?.payAccount : undefined);
  const total = order?.total ?? 0;
  const bills = useMemo(() => [total, 20000, 50000, 100000].filter((b, i, arr) => b >= total && arr.indexOf(b) === i), [total]);
  const ok = m === 'efectivo' ? received === 0 || received >= total : !!acc;

  const close = () => {
    setMethod(null);
    setAccount(undefined);
    setReceived(0);
    onClose();
  };

  return (
    <Sheet
      open={!!order}
      onClose={close}
      title={order ? `Cobrar pedido #${order.number}` : ''}
      subtitle={order ? money(order.total) : ''}
      footer={
        <button
          className="btn btn-primary btn-block btn-xl"
          disabled={!ok}
          onClick={async () => {
            if (!order) return;
            await markPaid(order.id, m, m === 'transferencia' ? acc : undefined, m === 'efectivo' && received ? received : undefined);
            haptic.success();
            toast(`Pago del #${order.number} confirmado`);
            close();
          }}
        >
          {m === 'transferencia' ? 'Sí, la transferencia llegó' : 'Confirmar pago en efectivo'}
        </button>
      }
    >
      <Segmented<PayMethod>
        size="lg"
        value={m}
        onChange={(v) => { setMethod(v); setReceived(0); }}
        options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: '📲 Transferencia' }]}
      />
      <div style={{ height: 14 }} />
      {m === 'transferencia' ? (
        <Field label="¿A qué cuenta llegó?" hint="Verifica en la app del banco antes de confirmar.">
          <Chips value={acc} options={s.transferAccounts} onChange={setAccount} />
        </Field>
      ) : (
        <Field label="¿Con cuánto pagó? (opcional)">
          <div className="bills">
            {bills.map((b) => (
              <button key={b} className={`chip ${received === b ? 'on' : ''}`} onClick={() => setReceived(b)}>{b === total ? 'Exacto' : money(b)}</button>
            ))}
          </div>
          <MoneyInput value={received} onChange={setReceived} placeholder="Otro valor" />
          {received > 0 && received >= total && <div className="change">Cambio: <b>{money(received - total)}</b></div>}
          {received > 0 && received < total && <div className="missing">No alcanza: faltan {money(total - received)}</div>}
        </Field>
      )}
    </Sheet>
  );
}
