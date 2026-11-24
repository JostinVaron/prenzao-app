import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { elapsedLabel, minutesSince, money, onlyDigits, timeHM } from '../lib/format';
import { advanceOrder, cancelOrder, customerMessage, NEXT_LABEL, nextStatus, STATUS_LABEL } from '../lib/orders';
import { call, haptic, openMaps, openWhatsApp } from '../lib/platform';
import { sfx } from '../lib/sound';
import { useBusiness, usePeople } from '../lib/hooks';
import type { Customer, Order, Person } from '../lib/types';
import { Field, Money, PromptSheet, Seg, Sheet, toast } from './kit';

export function ageClass(o: Order, now: number, target = 10) {
  const m = minutesSince(o.createdAt, now);
  if (m >= target * 2.2) return 'late';
  if (m >= target * 1.3) return 'warm';
  return '';
}

export function personName(people: Person[], id?: string) {
  return people.find((p) => p.id === id)?.name;
}

/** Tarjeta de pedido (vista clara). La acción principal siempre es el botón grande. */
export function OrderCard({ o, now, onOpen, onCharge, compact }: { o: Order; now: number; onOpen: () => void; onCharge: () => void; compact?: boolean }) {
  const biz = useBusiness();
  const [leaving, setLeaving] = useState(false);
  const next = nextStatus(o);
  const closed = o.status === 'entregado' || o.status === 'cancelado';
  const advance = async () => {
    haptic.success();
    sfx.done();
    setLeaving(true);
    setTimeout(() => advanceOrder(o.id), 280);
  };
  return (
    <article className={`ocard ${o.customer?.urgent && !closed ? 'urgent' : ''} ${leaving ? 'leaving' : ''}`} onClick={onOpen}>
      <div className="o-head">
        <div className="o-num">#{o.number}</div>
        <div className="o-tags">
          {o.channel === 'domicilio' ? <span className="tag dom">🛵 Domicilio</span> : <span className="tag">🏪 Aquí</span>}
          {o.source === 'whatsapp' && <span className="tag wa">WhatsApp</span>}
          {o.customer?.urgent && !closed && <span className="tag urg">Urgente</span>}
          {closed && <span className="tag">{STATUS_LABEL[o.status]}</span>}
        </div>
        <div className={`o-time ${closed ? '' : ageClass(o, now, biz.prepTargetMin)}`}>⏱ {closed ? timeHM(o.createdAt) : elapsedLabel(o.createdAt, now)}</div>
      </div>
      {!compact && (
        <div className="o-items">
          {o.items.map((i, k) => (
            <div key={k} className="o-item"><b>{i.qty}×</b><span>{i.name}{i.note && <span className="o-note">{i.note}</span>}</span></div>
          ))}
        </div>
      )}
      {(o.customer?.name || o.customer?.address) && (
        <div className="o-cust">
          {o.customer?.name && <span>👤 {o.customer.name}</span>}
          {o.customer?.address && o.channel === 'domicilio' && <span>📍 {o.customer.address}</span>}
        </div>
      )}
      <div className="o-foot">
        <div className="o-total">{money(o.total)}</div>
        {o.status !== 'cancelado' && (o.payStatus === 'pagado' ? <span className="tag paid">✓ {o.payMethod === 'transferencia' ? o.payAccount ?? 'Transferencia' : 'Efectivo'}</span> : <span className="tag due">Por cobrar</span>)}
      </div>
      {!closed && (
        <div className="o-actions" onClick={(e) => e.stopPropagation()}>
          {o.payStatus === 'pendiente' && <button className="btn btn-due" onClick={onCharge}>💰 Cobrar</button>}
          {next && <button className={`btn grow ${next === 'entregado' ? 'btn-ok' : 'btn-go'}`} onClick={advance}>{NEXT_LABEL[next]}</button>}
        </div>
      )}
      {o.status === 'entregado' && o.payStatus === 'pendiente' && (
        <div className="o-actions" onClick={(e) => e.stopPropagation()}><button className="btn btn-due grow" onClick={onCharge}>💰 Entregado sin cobrar · Cobrar</button></div>
      )}
    </article>
  );
}

const CANCEL = ['Cliente desistió', 'Error al registrar', 'Se agotó', 'No contestó', 'Fuera de zona'];

export function OrderSheet({ id, onClose, onCharge }: { id: string | null; onClose: () => void; onCharge: (o: Order) => void }) {
  const o = useLiveQuery(() => (id ? db.orders.get(id) : undefined), [id]);
  const biz = useBusiness();
  const people = usePeople();
  const [cancel, setCancel] = useState(false);
  const next = o ? nextStatus(o) : null;
  return (
    <>
      <Sheet open={!!id && !!o} onClose={onClose} full title={o ? `Pedido #${o.number}` : ''} sub={o ? `${timeHM(o.createdAt)} · ${STATUS_LABEL[o.status]}${o.createdBy ? ` · lo tomó ${personName(people, o.createdBy) ?? ''}` : ''}` : ''}>
        {o && (
          <div className="stack">
            <div className="card pad" style={{ margin: 0 }}>
              {o.items.map((i, k) => (
                <div key={k} className="kv"><span style={{ color: 'var(--ink)', fontWeight: 650 }}><b style={{ color: 'var(--tomate)' }}>{i.qty}×</b> {i.name}{i.note && <span className="o-note">{i.note}</span>}</span><b>{money(i.qty * i.price)}</b></div>
              ))}
              {o.deliveryFee > 0 && <div className="kv"><span>Domicilio</span><b>{money(o.deliveryFee)}</b></div>}
              <div className="kv total"><span>Total</span><b className="display" style={{ fontSize: 22 }}>{money(o.total)}</b></div>
              <div className="kv"><span>Pago</span><b style={{ color: o.payStatus === 'pagado' ? 'var(--aguacate)' : 'var(--aji)' }}>{o.payStatus === 'pagado' ? `✓ ${o.payMethod === 'transferencia' ? `Transferencia · ${o.payAccount ?? ''}` : 'Efectivo'}` : 'Por cobrar'}</b></div>
              {o.cashReceived ? <div className="kv"><span>Recibido / cambio</span><b>{money(o.cashReceived)} / {money(o.cashReceived - o.total)}</b></div> : null}
              {o.cancelReason && <div className="kv"><span>Cancelado</span><b>{o.cancelReason}</b></div>}
            </div>

            {o.channel === 'domicilio' && o.customer && (
              <div className="card pad" style={{ margin: 0 }}>
                {o.customer.address && <div className="addr"><span className="e">📍</span><span>{o.customer.address}</span></div>}
                <div className="kv"><span>Cliente</span><b>{o.customer.name ?? '—'}</b></div>
                {o.customer.phone && <div className="kv"><span>Celular</span><b>{o.customer.phone}</b></div>}
                <div className="mini-actions" style={{ marginTop: 8 }}>
                  {o.customer.address && <button className="mini" onClick={() => openMaps(o.customer!.address!)}>🗺️ Mapa</button>}
                  {o.customer.phone && <button className="mini" onClick={() => call(o.customer!.phone!)}>📞 Llamar</button>}
                  <button className="mini" style={{ background: '#dcf8e7', color: '#0c6b3a' }} onClick={() => openWhatsApp(o.customer?.phone, customerMessage(o, biz.name))}>💬 Avisar</button>
                </div>
              </div>
            )}

            <div className="card pad" style={{ margin: 0 }}>
              <div className="label" style={{ marginBottom: 6 }}>Historia</div>
              {o.log.map((e, k) => (
                <div key={k} className="feed-item">
                  <span>{e.status === 'pago' ? '💰' : e.status === 'cancelado' ? '✕' : e.status === 'listo' ? '🔥' : e.status === 'enviado' ? '🛵' : e.status === 'entregado' ? '✅' : '🧾'}</span>
                  <span>{e.status === 'pago' ? `Cobrado${e.detail ? ' · ' + e.detail : ''}` : STATUS_LABEL[e.status as keyof typeof STATUS_LABEL] ?? e.detail}{e.by ? ` · ${personName(people, e.by) ?? ''}` : ''}</span>
                  <time>{timeHM(e.at)}</time>
                </div>
              ))}
            </div>

            {o.status !== 'cancelado' && (
              <div className="stack" style={{ gap: 8 }}>
                {o.payStatus === 'pendiente' && <button className="btn btn-due btn-block btn-xl" onClick={() => onCharge(o)}>💰 Cobrar {money(o.total)}</button>}
                {next && <button className="btn btn-go btn-block btn-xl" onClick={async () => { sfx.done(); haptic.success(); await advanceOrder(o.id); }}>{NEXT_LABEL[next]}</button>}
                {o.channel === 'mostrador' && <button className="btn btn-soft btn-block" onClick={() => openWhatsApp(o.customer?.phone, customerMessage(o, biz.name))}>💬 Enviar por WhatsApp</button>}
                {o.status !== 'entregado' && <button className="btn btn-ghost-danger btn-block" onClick={() => setCancel(true)}>Cancelar pedido</button>}
              </div>
            )}
          </div>
        )}
      </Sheet>
      <PromptSheet
        open={cancel}
        title="¿Por qué se cancela?"
        sub="Queda registrado. Los pedidos nunca se borran."
        quick={CANCEL}
        placeholder="Otro motivo"
        confirm="Cancelar pedido"
        danger
        onClose={() => setCancel(false)}
        onOk={async (r) => {
          if (!o) return;
          await cancelOrder(o.id, r);
          setCancel(false);
          toast(`#${o.number} cancelado`, 'warn');
        }}
      />
    </>
  );
}

// ---------------- Datos del cliente (domicilio) ----------------
export interface CustomerDraft {
  phone: string;
  name: string;
  address: string;
  urgent: boolean;
  fee: number | null;
}

export const emptyCustomer = (): CustomerDraft => ({ phone: '', name: '', address: '', urgent: false, fee: null });

export function CustomerSheet({ open, value, onChange, onClose, onPasteWhatsApp }: { open: boolean; value: CustomerDraft; onChange: (c: CustomerDraft) => void; onClose: () => void; onPasteWhatsApp: () => void }) {
  const biz = useBusiness();
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const recent = useLiveQuery(() => db.customers.orderBy('lastAt').reverse().limit(60).toArray(), []) ?? [];
  const matches = useMemo(() => {
    const d = onlyDigits(value.phone);
    const n = q.trim().toLowerCase();
    return recent
      .filter((c) => !c.deleted)
      .filter((c) => (d.length >= 3 ? c.id.includes(d) : n ? (c.name ?? '').toLowerCase().includes(n) || (c.address ?? '').toLowerCase().includes(n) : true))
      .slice(0, 6);
  }, [recent, value.phone, q]);
  const pick = (c: Customer) => {
    haptic.tap();
    onChange({ ...value, phone: c.phone ?? c.id, name: c.name ?? '', address: c.address ?? '' });
  };
  const ok = value.address.trim().length >= 4;
  return (
    <Sheet open={open} onClose={onClose} full title="¿Para quién es?" sub="Domicilio" footer={<button className="btn btn-go btn-block btn-xl" disabled={!ok} onClick={onClose}>{ok ? 'Listo ✓' : 'Falta la dirección'}</button>}>
      <button className="wa-cta" style={{ width: '100%', margin: '0 0 14px' }} onClick={onPasteWhatsApp}>
        <span className="wa-cta-ico">💬</span>
        <span><b>Pegar mensaje de WhatsApp</b><small>Copia el mensaje del cliente y toca aquí: lleno todo solo</small></span>
      </button>
      <Field label="Celular">
        <input className="input" inputMode="tel" placeholder="300 123 4567" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
      </Field>
      {matches.length > 0 && !value.address && (
        <div className="field">
          <span className="label">{onlyDigits(value.phone).length >= 3 ? 'Coincide con' : 'Clientes recientes'}</span>
          <div className="card" style={{ margin: 0 }}>
            {matches.map((c) => (
              <button key={c.id} className="li" onClick={() => pick(c)}>
                <div className="li-ico">👤</div>
                <div className="li-main"><div className="li-title">{c.name ?? c.phone}</div><div className="li-sub">{c.address ?? 'sin dirección'} · {c.orders} pedidos</div></div>
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Nombre"><input className="input" placeholder="Nombre del cliente" value={value.name} onChange={(e) => { onChange({ ...value, name: e.target.value }); setQ(e.target.value); }} /></Field>
      <Field label="Dirección *"><textarea className="input" rows={2} placeholder="Calle, número, barrio, indicaciones" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} /></Field>
      <Field label="¿Qué tan rápido?">
        <Seg<'n' | 'u'> value={value.urgent ? 'u' : 'n'} onChange={(v) => onChange({ ...value, urgent: v === 'u' })} options={[{ value: 'n', label: 'Normal' }, { value: 'u', label: '⚡ Urgente' }]} />
      </Field>
      <Field label="Valor del domicilio" hint={biz.defaultDeliveryFee ? undefined : 'Pendiente definir tarifas por zona en Negocio → Ajustes.'}>
        <Money value={value.fee ?? biz.defaultDeliveryFee} onChange={(n) => onChange({ ...value, fee: n })} />
      </Field>
    </Sheet>
  );
}
