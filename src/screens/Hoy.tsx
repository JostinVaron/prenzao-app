import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Lock, TrendingUp } from 'lucide-react';
import { db, uid } from '../lib/db';
import { dayLabel, money, shiftDayKey, timeHM } from '../lib/format';
import { haptic } from '../lib/platform';
import { useSettings, useTodayKey } from '../lib/hooks';
import type { Expense, Order } from '../lib/types';
import { Field, MoneyInput, Sheet, toast } from '../components/ui';

export interface DayStats {
  orders: Order[];
  valid: Order[];
  sales: number;
  paid: number;
  due: number;
  cash: number;
  transfer: number;
  byAccount: [string, number][];
  count: number;
  avg: number;
  cancelled: number;
  expenses: number;
  cashExpenses: number;
  top: { name: string; qty: number; revenue: number }[];
  hours: number[]; // 24
  mostrador: number;
  domicilio: number;
}

export function computeStats(orders: Order[], expenses: Expense[]): DayStats {
  const valid = orders.filter((o) => o.status !== 'cancelado');
  const paidOrders = valid.filter((o) => o.payStatus === 'pagado');
  const sum = (arr: Order[]) => arr.reduce((a, o) => a + o.total, 0);
  const acc = new Map<string, number>();
  paidOrders.filter((o) => o.payMethod === 'transferencia').forEach((o) => acc.set(o.payAccount ?? 'Otra', (acc.get(o.payAccount ?? 'Otra') ?? 0) + o.total));
  const prod = new Map<string, { name: string; qty: number; revenue: number }>();
  const hours = Array(24).fill(0);
  valid.forEach((o) => {
    hours[new Date(o.createdAt).getHours()] += o.total;
    o.items.forEach((i) => {
      const p = prod.get(i.productId) ?? { name: i.name, qty: 0, revenue: 0 };
      p.qty += i.qty;
      p.revenue += i.qty * i.price;
      prod.set(i.productId, p);
    });
  });
  const sales = sum(valid);
  return {
    orders,
    valid,
    sales,
    paid: sum(paidOrders),
    due: sales - sum(paidOrders),
    cash: sum(paidOrders.filter((o) => o.payMethod === 'efectivo')),
    transfer: sum(paidOrders.filter((o) => o.payMethod === 'transferencia')),
    byAccount: [...acc.entries()].sort((a, b) => b[1] - a[1]),
    count: valid.length,
    avg: valid.length ? Math.round(sales / valid.length) : 0,
    cancelled: orders.length - valid.length,
    expenses: expenses.reduce((a, e) => a + e.amount, 0),
    cashExpenses: expenses.filter((e) => e.fromCash).reduce((a, e) => a + e.amount, 0),
    top: [...prod.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue),
    hours,
    mostrador: valid.filter((o) => o.channel === 'mostrador').length,
    domicilio: valid.filter((o) => o.channel === 'domicilio').length,
  };
}

export function Hoy() {
  const s = useSettings();
  const todayKey = useTodayKey();
  const [dayKey, setDayKey] = useState<string | null>(null);
  const day = dayKey ?? todayKey;
  const [closeOpen, setCloseOpen] = useState(false);

  const orders = useLiveQuery(() => db.orders.where('dayKey').equals(day).toArray(), [day]) ?? [];
  const expenses = useLiveQuery(() => db.expenses.where('dayKey').equals(day).toArray(), [day]) ?? [];
  const closes = useLiveQuery(() => db.closes.where('dayKey').equals(day).reverse().sortBy('createdAt'), [day]) ?? [];
  const week = useLiveQuery(async () => {
    const keys = Array.from({ length: 7 }, (_, i) => shiftDayKey(day, i - 6));
    const all = await db.orders.where('dayKey').anyOf(keys).toArray();
    return keys.map((k) => ({ k, v: all.filter((o) => o.dayKey === k && o.status !== 'cancelado').reduce((a, o) => a + o.total, 0) }));
  }, [day]) ?? [];

  const st = useMemo(() => computeStats(orders, expenses), [orders, expenses]);
  const expectedCash = s.cashBase + st.cash - st.cashExpenses;
  const activeHours = st.hours.map((v, h) => ({ h, v })).filter((x) => x.v > 0);
  const firstH = activeHours.length ? Math.min(...activeHours.map((x) => x.h)) : 10;
  const lastH = activeHours.length ? Math.max(...activeHours.map((x) => x.h)) : 22;
  const span = st.hours.slice(Math.min(firstH, 10), Math.max(lastH, 21) + 1).map((v, i) => ({ h: Math.min(firstH, 10) + i, v }));
  const maxH = Math.max(1, ...span.map((x) => x.v));
  const peak = activeHours.sort((a, b) => b.v - a.v)[0];
  const maxW = Math.max(1, ...week.map((w) => w.v));
  const maxTop = Math.max(1, ...st.top.map((t) => t.qty));

  return (
    <div className="screen">
      <header className="large-head">
        <div className="eyebrow">Resumen del día</div>
        <h1 className="large-title">{dayLabel(day, todayKey) === 'Hoy' ? 'Hoy' : 'Resumen'}</h1>
      </header>
      <div className="day-nav">
        <button className="icon-btn round" onClick={() => setDayKey(shiftDayKey(day, -1))} aria-label="Día anterior"><ChevronLeft size={18} /></button>
        <span>{dayLabel(day, todayKey)}</span>
        <button className="icon-btn round" disabled={day >= todayKey} onClick={() => setDayKey(shiftDayKey(day, 1))} aria-label="Día siguiente"><ChevronRight size={18} /></button>
      </div>

      <div className="stat-hero accent">
        <div className="stat-hero-label">Ventas</div>
        <div className="stat-hero-value">{money(st.sales)}</div>
        <div className="stat-hero-sub">
          {st.count} pedidos · ticket promedio {money(st.avg)}
          {st.due > 0 && <> · <b className="due-text-light">{money(st.due)} por cobrar</b></>}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>💵 Efectivo</span><b>{money(st.cash)}</b></div>
        <div className="kpi"><span>📲 Transferencias</span><b>{money(st.transfer)}</b></div>
        <div className="kpi"><span>Gastos</span><b className="neg">{money(st.expenses)}</b></div>
        <div className="kpi"><span>Ventas − gastos</span><b>{money(st.paid - st.expenses)}</b></div>
        <div className="kpi"><span>Mostrador / Domicilio</span><b>{st.mostrador} / {st.domicilio}</b></div>
        <div className="kpi"><span>Cancelados</span><b>{st.cancelled}</b></div>
      </div>

      {st.byAccount.length > 0 && (
        <>
          <div className="section-title">Transferencias por cuenta</div>
          <div className="group pad">
            {st.byAccount.map(([a, v]) => <div key={a} className="kv"><span>{a}</span><b>{money(v)}</b></div>)}
          </div>
        </>
      )}

      <div className="section-title">Ventas por hora {peak && <span className="section-aside">Pico: {peak.h % 12 || 12}{peak.h < 12 ? ' a.m.' : ' p.m.'}</span>}</div>
      <div className="group pad">
        <div className="bars">
          {span.map(({ h, v }) => (
            <div key={h} className="bar-col" title={money(v)}>
              <div className="bar" style={{ height: `${(v / maxH) * 100}%` }} data-on={v > 0 ? '1' : '0'} />
              <span className="bar-lbl">{h % 12 || 12}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Más vendidos</div>
      <div className="group pad">
        {st.top.length === 0 && <div className="muted">Aún no hay ventas.</div>}
        {st.top.slice(0, 8).map((t, i) => (
          <div key={t.name} className="top-row">
            <span className="top-rank">{i + 1}</span>
            <div className="top-main">
              <div className="top-name">{t.name}</div>
              <div className="top-bar"><i style={{ width: `${(t.qty / maxTop) * 100}%` }} /></div>
            </div>
            <div className="top-val"><b>{t.qty}</b><span>{money(t.revenue)}</span></div>
          </div>
        ))}
      </div>

      <div className="section-title"><TrendingUp size={15} /> Últimos 7 días</div>
      <div className="group pad">
        <div className="bars week">
          {week.map(({ k, v }) => {
            const [y, m, d] = k.split('-').map(Number);
            const lbl = new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'narrow' });
            return (
              <div key={k} className="bar-col" title={money(v)}>
                <span className="bar-top">{v ? `${Math.round(v / 1000)}k` : ''}</span>
                <div className="bar" style={{ height: `${(v / maxW) * 100}%` }} data-on={k === day ? '2' : v > 0 ? '1' : '0'} />
                <span className="bar-lbl">{lbl}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section-title">Caja</div>
      <div className="group pad">
        <div className="kv"><span>Base</span><b>{money(s.cashBase)}</b></div>
        <div className="kv"><span>+ Ventas en efectivo</span><b>{money(st.cash)}</b></div>
        <div className="kv"><span>− Gastos pagados de la caja</span><b>{money(st.cashExpenses)}</b></div>
        <div className="kv strong"><span>Debe haber en caja</span><b>{money(expectedCash)}</b></div>
        {closes.map((c) => (
          <div key={c.id} className={`close-row ${c.diff === 0 ? 'ok' : c.diff > 0 ? 'over' : 'short'}`}>
            <Lock size={14} /> Cierre {timeHM(c.createdAt)}: contado {money(c.counted)} · {c.diff === 0 ? 'cuadra exacto' : c.diff > 0 ? `sobran ${money(c.diff)}` : `faltan ${money(-c.diff)}`}
          </div>
        ))}
        <button className="btn btn-dark btn-block" onClick={() => { haptic.tap(); setCloseOpen(true); }}><Lock size={17} /> Hacer cierre de caja</button>
      </div>

      <CloseSheet open={closeOpen} onClose={() => setCloseOpen(false)} day={day} base={s.cashBase} cashSales={st.cash} cashExpenses={st.cashExpenses} due={st.due} />
    </div>
  );
}

function CloseSheet({ open, onClose, day, base, cashSales, cashExpenses, due }: { open: boolean; onClose: () => void; day: string; base: number; cashSales: number; cashExpenses: number; due: number }) {
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const expected = base + cashSales - cashExpenses;
  const diff = counted - expected;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cierre de caja"
      subtitle={`Debe haber ${money(expected)}`}
      footer={
        <button
          className="btn btn-primary btn-block btn-xl"
          disabled={!counted}
          onClick={async () => {
            await db.closes.add({ id: uid(), dayKey: day, createdAt: Date.now(), base, cashSales, cashExpenses, expected, counted, diff, note: note.trim() || undefined });
            haptic.success();
            toast(diff === 0 ? 'Caja cuadrada ✅' : diff > 0 ? `Cierre guardado · sobran ${money(diff)}` : `Cierre guardado · faltan ${money(-diff)}`, diff < 0 ? 'warn' : 'ok');
            setCounted(0);
            setNote('');
            onClose();
          }}
        >
          Guardar cierre
        </button>
      }
    >
      {due > 0 && <div className="callout warn">Ojo: hay {money(due)} sin cobrar hoy. Confírmalos en Pedidos → Por cobrar antes de cerrar.</div>}
      <Field label="¿Cuánto efectivo hay contado?">
        <MoneyInput big value={counted} onChange={setCounted} autoFocus />
      </Field>
      {counted > 0 && (
        <div className={`diff-box ${diff === 0 ? 'ok' : diff > 0 ? 'over' : 'short'}`}>
          {diff === 0 ? 'Cuadra exacto' : diff > 0 ? `Sobran ${money(diff)}` : `Faltan ${money(-diff)}`}
        </div>
      )}
      <Field label="Nota (opcional)">
        <input className="input" placeholder="Ej: se sacó para el gas" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}
