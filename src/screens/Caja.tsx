import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getDevice, save, uid } from '../lib/db';
import { money, timeHM } from '../lib/format';
import { itemsSummary } from '../lib/orders';
import { haptic } from '../lib/platform';
import { sfx } from '../lib/sound';
import { useBusiness, useCountUp, useDueOrders, useNow, useTodayKey, useTodayOrders } from '../lib/hooks';
import type { Order } from '../lib/types';
import { Empty, Field, Money, Seg, Sheet, toast } from '../ui/kit';
import { OrderCard, OrderSheet } from '../ui/order';
import { ChargeFlow } from '../ui/pay';
import { catIcon, ExpenseSheet, useExpenseTotals } from '../ui/money';
import { celebrate } from '../ui/celebrate';

type Tab = 'cobrar' | 'gastos' | 'hoy';

export function Caja() {
  const biz = useBusiness();
  const day = useTodayKey();
  const now = useNow(30000);
  const orders = useTodayOrders(day);
  const due = useDueOrders();
  const exp = useExpenseTotals(day);
  const closes = useLiveQuery(() => db.closes.where('dayKey').equals(day).reverse().sortBy('createdAt'), [day]) ?? [];
  const [tab, setTab] = useState<Tab>(due.length ? 'cobrar' : 'hoy');
  const [open, setOpen] = useState<string | null>(null);
  const [charge, setCharge] = useState<Order | null>(null);
  const [expense, setExpense] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState('');

  const valid = orders.filter((o) => o.status !== 'cancelado');
  const paid = valid.filter((o) => o.payStatus === 'pagado');
  const cash = paid.filter((o) => o.payMethod === 'efectivo').reduce((a, o) => a + o.total, 0);
  const transfer = paid.filter((o) => o.payMethod === 'transferencia').reduce((a, o) => a + o.total, 0);
  const expected = biz.cashBase + cash - exp.fromCash;
  const shown = useCountUp(expected);
  const dueTotal = due.reduce((a, o) => a + o.total, 0);

  const history = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...orders].sort((a, b) => b.createdAt - a.createdAt).filter((o) => !s || `#${o.number} ${itemsSummary(o.items)} ${o.customer?.name ?? ''}`.toLowerCase().includes(s));
  }, [orders, q]);

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hello"><div className="grow"><div className="hello-title">Caja 💰</div><div className="hello-sub">Cobros, gastos y cierre del día</div></div></div>

      <div className="hero">
        <small>En caja debería haber</small>
        <div className="v">{money(shown)}</div>
        <div className="sub">💵 {money(cash)} efectivo · 📲 {money(transfer)} transferencias{biz.cashBase ? ` · base ${money(biz.cashBase)}` : ''}{exp.fromCash ? ` · −${money(exp.fromCash)} gastos` : ''}</div>
      </div>

      <div className="pad-x" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <button className="btn btn-soft" style={{ flexDirection: 'column', gap: 2, height: 74, fontSize: 13.5 }} onClick={() => setExpense('')}><span style={{ fontSize: 24 }}>🧾</span>Gasto</button>
        <button className="btn btn-soft" style={{ flexDirection: 'column', gap: 2, height: 74, fontSize: 13.5 }} onClick={() => setExpense('Nómina')}><span style={{ fontSize: 24 }}>👥</span>Nómina</button>
        <button className="btn btn-ink" style={{ flexDirection: 'column', gap: 2, height: 74, fontSize: 13.5 }} onClick={() => { haptic.tap(); setClosing(true); }}><span style={{ fontSize: 24 }}>🔒</span>Cierre</button>
      </div>

      <div className="pad-x" style={{ marginBottom: 12 }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[
          { value: 'cobrar', label: <>Cobrar{due.length ? <span className="cnt red">{due.length}</span> : null}</> },
          { value: 'gastos', label: <>Gastos{exp.list.length ? <span className="cnt">{exp.list.length}</span> : null}</> },
          { value: 'hoy', label: 'Pedidos' },
        ]} />
      </div>

      {tab === 'cobrar' && (
        <>
          {due.length > 0 && <div className="callout bad" style={{ margin: '0 16px 12px' }}>💰 Falta cobrar <b>&nbsp;{money(dueTotal)}&nbsp;</b> en {due.length} {due.length === 1 ? 'pedido' : 'pedidos'}.</div>}
          {due.length === 0 && <Empty icon="🎉" title="Todo cobrado" text="Ni un peso pendiente. Así da gusto cerrar caja." />}
          <div className="olist">{due.map((o) => <OrderCard key={o.id} o={o} now={now} onOpen={() => setOpen(o.id)} onCharge={() => setCharge(o)} />)}</div>
        </>
      )}

      {tab === 'gastos' && (
        <>
          {exp.list.length === 0 && <Empty icon="🧾" title="Sin gastos hoy" text="Registra cada compra con su foto: así sabemos cuánto deja cada producto." />}
          {exp.list.length > 0 && (
            <div className="card">
              {exp.list.map((e) => (
                <div key={e.id} className="li">
                  {e.thumb ? <img src={e.thumb} alt="" style={{ width: 38, height: 38, borderRadius: 12, objectFit: 'cover' }} /> : <div className="li-ico">{catIcon(e.category)}</div>}
                  <div className="li-main"><div className="li-title">{e.category}{e.supplier ? ` · ${e.supplier}` : ''}</div><div className="li-sub">{timeHM(e.createdAt)} · {e.method === 'efectivo' ? (e.fromCash ? 'de la caja' : 'efectivo') : 'transferencia'}{e.note ? ` · ${e.note}` : ''}</div></div>
                  <div className="li-val">{money(e.amount)}</div>
                </div>
              ))}
              <div className="li"><div className="li-main"><div className="li-title">Total gastos</div></div><div className="li-val" style={{ color: 'var(--aji)' }}>{money(exp.total)}</div></div>
            </div>
          )}
        </>
      )}

      {tab === 'hoy' && (
        <>
          <div className="pad-x" style={{ marginBottom: 10 }}><input className="input" placeholder="🔎 Buscar pedido, producto o cliente" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {history.length === 0 && <Empty icon="🧾" title="Aún no hay pedidos hoy" />}
          <div className="card">
            {history.map((o) => (
              <button key={o.id} className="li" onClick={() => setOpen(o.id)} style={{ opacity: o.status === 'cancelado' ? 0.45 : 1 }}>
                <div className="li-ico display" style={{ fontWeight: 800 }}>#{o.number}</div>
                <div className="li-main"><div className="li-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemsSummary(o.items)}</div><div className="li-sub">{timeHM(o.createdAt)} · {o.channel === 'domicilio' ? '🛵' : '🏪'} · {o.status === 'cancelado' ? 'cancelado' : o.payStatus === 'pagado' ? (o.payMethod === 'transferencia' ? o.payAccount ?? 'transferencia' : 'efectivo') : 'por cobrar'}</div></div>
                <div className="li-val">{money(o.total)}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {closes.length > 0 && (
        <div className="card pad">
          {closes.map((c) => <div key={c.id} className="kv"><span>🔒 Cierre {timeHM(c.createdAt)}</span><b style={{ color: c.diff === 0 ? 'var(--aguacate)' : c.diff > 0 ? 'var(--cielo)' : 'var(--aji)' }}>{c.diff === 0 ? 'Cuadró exacto' : c.diff > 0 ? `Sobraron ${money(c.diff)}` : `Faltaron ${money(-c.diff)}`}</b></div>)}
        </div>
      )}

      <OrderSheet id={open} onClose={() => setOpen(null)} onCharge={(o) => setCharge(o)} />
      <ChargeFlow order={charge} onClose={() => setCharge(null)} />
      <ExpenseSheet open={expense !== null} preset={expense || undefined} onClose={() => setExpense(null)} />
      <CloseSheet open={closing} onClose={() => setClosing(false)} day={day} base={biz.cashBase} cash={cash} cashExpenses={exp.fromCash} due={dueTotal} />
    </div>
  );
}

function CloseSheet({ open, onClose, day, base, cash, cashExpenses, due }: { open: boolean; onClose: () => void; day: string; base: number; cash: number; cashExpenses: number; due: number }) {
  const [counted, setCounted] = useState(0);
  const expected = base + cash - cashExpenses;
  const diff = counted - expected;
  return (
    <Sheet open={open} onClose={onClose} title="Cierre de caja" sub={`Debería haber ${money(expected)}`} footer={<button className="btn btn-go btn-block btn-xl" disabled={!counted} onClick={async () => {
      const d = await getDevice();
      await save('closes', { id: uid(), dayKey: day, createdAt: Date.now(), by: d.personId, base, cashSales: cash, cashExpenses, expected, counted, diff });
      if (diff === 0) celebrate({ title: '¡Cuadró!', sub: `Caja exacta: ${money(counted)}`, big: true, icon: '🏆' });
      else { sfx.warn(); toast(diff > 0 ? `Cierre guardado · sobran ${money(diff)}` : `Cierre guardado · faltan ${money(-diff)}`, 'warn'); }
      setCounted(0);
      onClose();
    }}>Guardar cierre</button>}>
      {due > 0 && <div className="callout warn">Ojo: hay {money(due)} sin cobrar. Cóbralos antes de cerrar.</div>}
      <Field label="¿Cuánto efectivo contaste?"><Money big value={counted} onChange={setCounted} autoFocus /></Field>
      {counted > 0 && <div className={`change-box ${diff < 0 ? 'short' : ''}`} style={diff > 0 ? { background: 'var(--cielo-soft)', color: 'var(--cielo)' } : undefined}><div style={{ fontWeight: 750 }}>{diff === 0 ? 'Cuadra exacto 🎯' : diff > 0 ? 'Sobran' : 'Faltan'}</div>{diff !== 0 && <div className="v">{money(Math.abs(diff))}</div>}</div>}
    </Sheet>
  );
}
