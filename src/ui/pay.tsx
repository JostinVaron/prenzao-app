import { useEffect, useMemo, useState } from 'react';
import { money } from '../lib/format';
import { haptic } from '../lib/platform';
import { sfx } from '../lib/sound';
import { markPaid } from '../lib/orders';
import { useBusiness } from '../lib/hooks';
import type { Order } from '../lib/types';
import { Money, Sheet } from './kit';
import { celebrate } from './celebrate';

// Denominaciones colombianas. El color es solo una ayuda visual para reconocerlos rápido.
const BILLS = [
  { v: 2000, c: '#2a9d8f' },
  { v: 5000, c: '#9c6b3f' },
  { v: 10000, c: '#c0392b' },
  { v: 20000, c: '#e67e22' },
  { v: 50000, c: '#7b4bb3' },
  { v: 100000, c: '#2f8f4e' },
];

export function accountColor(name: string): { bg: string; fg?: string } {
  const n = name.toLowerCase();
  if (n.includes('nequi')) return { bg: '#5b1a8f' };
  if (n.includes('davi')) return { bg: '#e30613' };
  if (n.includes('bancolombia')) return { bg: '#fdda24', fg: '#1c1410' };
  if (n.includes('bre') || n.includes('llave')) return { bg: '#0f766e' };
  if (n.includes('bbva')) return { bg: '#004481' };
  return { bg: '#1c1410' };
}

/** Cobro en efectivo: tocas los billetes que te entregaron y la app dice el cambio. */
export function CashSheet({ open, total, title, onClose, onPaid }: { open: boolean; total: number; title?: string; onClose: () => void; onPaid: (received?: number) => void }) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [other, setOther] = useState(0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (open) {
      setCounts({});
      setOther(0);
      setTyping(false);
    }
  }, [open]);
  const fromBills = Object.entries(counts).reduce((a, [v, n]) => a + Number(v) * n, 0);
  const received = typing ? other : fromBills;
  const change = received - total;
  const can = received === 0 || change >= 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? 'Cobro en efectivo'}
      footer={
        <div className="stack" style={{ gap: 8 }}>
          {received === 0 ? (
            <button className="btn btn-ok btn-block btn-xl" onClick={() => onPaid(undefined)}>✓ Pagó exacto · {money(total)}</button>
          ) : (
            <button className="btn btn-ok btn-block btn-xl" disabled={!can} onClick={() => onPaid(received)}>
              {can ? `✓ Cobrar y dar ${money(change)}` : `Faltan ${money(-change)}`}
            </button>
          )}
        </div>
      }
    >
      <div className="cash-total">
        <small>Total a cobrar</small>
        <div className="v">{money(total)}</div>
      </div>
      {!typing && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>¿Qué billetes te dieron? (toca cada uno)</div>
          <div className="bills">
            {BILLS.map((b) => (
              <button
                key={b.v}
                className="bill"
                style={{ ['--b' as string]: b.c }}
                onClick={() => {
                  haptic.tap();
                  sfx.pop((counts[b.v] ?? 0) + 1);
                  setCounts({ ...counts, [b.v]: (counts[b.v] ?? 0) + 1 });
                }}
              >
                {counts[b.v] ? <span className="n">{counts[b.v]}</span> : null}
                <small>BILLETE</small>
                {b.v >= 1000 ? `${b.v / 1000} mil` : b.v}
              </button>
            ))}
          </div>
        </>
      )}
      {typing && <div className="field"><span className="label">¿Con cuánto pagó?</span><Money big value={other} onChange={setOther} autoFocus /></div>}
      {received > 0 && (
        <>
          <div className="received">
            <span>Recibido: <b className="display" style={{ fontSize: 18 }}>{money(received)}</b></span>
            <button onClick={() => { setCounts({}); setOther(0); }}>Borrar</button>
          </div>
          <div className={`change-box ${change < 0 ? 'short' : ''}`}>
            <div style={{ fontWeight: 750 }}>{change >= 0 ? 'Devuelve' : 'Aún faltan'}</div>
            <div className="v">{money(Math.abs(change))}</div>
          </div>
        </>
      )}
      <button className="btn btn-soft btn-block" style={{ marginTop: 12 }} onClick={() => { setTyping(!typing); setCounts({}); setOther(0); }}>
        {typing ? '💵 Volver a los billetes' : '⌨️ Escribir otro valor (monedas, etc.)'}
      </button>
    </Sheet>
  );
}

/** Transferencia: tocar la cuenta y confirmar si ya llegó. */
export function TransferSheet({ open, total, onClose, onDone }: { open: boolean; total: number; onClose: () => void; onDone: (account: string, arrived: boolean) => void }) {
  const biz = useBusiness();
  const [acc, setAcc] = useState<string | null>(null);
  useEffect(() => { if (open) setAcc(null); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Transferencia" sub={`Total ${money(total)}`}>
      <div className="label" style={{ marginBottom: 10 }}>1. ¿A qué cuenta?</div>
      <div className="accounts">
        {biz.transferAccounts.map((a) => {
          const c = accountColor(a);
          return (
            <button key={a} className={`account ${acc && acc !== a ? 'dim' : ''} ${acc === a ? 'on' : ''}`} style={{ ['--a' as string]: c.bg, color: c.fg ?? '#fff' }} onClick={() => { haptic.tap(); sfx.pop(); setAcc(a); }}>
              {a}
            </button>
          );
        })}
      </div>
      {acc && (
        <div className="arrived" style={{ animation: 'cardIn .35s var(--spring)' }}>
          <div className="label">2. ¿Ya viste la plata en {acc}?</div>
          <button className="btn btn-ok btn-block btn-xl" onClick={() => onDone(acc, true)}>✓ Sí, ya llegó</button>
          <button className="btn btn-soft btn-block" onClick={() => onDone(acc, false)}>⏳ Aún no · recordarme</button>
        </div>
      )}
    </Sheet>
  );
}

/** Cobrar un pedido ya creado (desde Despacho, Caja o el recordatorio). */
export function ChargeFlow({ order, onClose, onPaid }: { order: Order | null; onClose: () => void; onPaid?: (o: Order) => void }) {
  const [step, setStep] = useState<'pick' | 'cash' | 'transfer'>('pick');
  useEffect(() => { if (order) setStep(order.payMethod === 'transferencia' ? 'transfer' : 'pick'); }, [order?.id]);
  const total = order?.total ?? 0;
  const done = async (method: 'efectivo' | 'transferencia', account?: string, received?: number) => {
    if (!order) return;
    await markPaid(order.id, method, account, received);
    onPaid?.(order);
    celebrate({ title: `#${order.number}`, sub: `Cobrado ${money(order.total)}${received && received > order.total ? ` · cambio ${money(received - order.total)}` : ''}` });
    onClose();
  };
  const pickOpen = !!order && step === 'pick';
  return (
    <>
      <Sheet open={pickOpen} onClose={onClose} title={order ? `Cobrar #${order.number}` : ''} sub={money(total)}>
        <div className="pay-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className="pay cash" onClick={() => setStep('cash')}><span className="e">💵</span>Efectivo</button>
          <button className="pay transfer" onClick={() => setStep('transfer')}><span className="e">📲</span>Transferencia</button>
        </div>
      </Sheet>
      <CashSheet open={!!order && step === 'cash'} total={total} title={order ? `Cobrar #${order.number}` : ''} onClose={onClose} onPaid={(r) => done('efectivo', undefined, r)} />
      <TransferSheet
        open={!!order && step === 'transfer'}
        total={total}
        onClose={onClose}
        onDone={(acc, arrived) => {
          if (arrived) done('transferencia', acc);
          else onClose();
        }}
      />
    </>
  );
}

export function useBillsHint(total: number) {
  return useMemo(() => BILLS.filter((b) => b.v >= total).slice(0, 2), [total]);
}
