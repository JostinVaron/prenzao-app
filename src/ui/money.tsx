import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getBusiness, getDevice, save, uid } from '../lib/db';
import { dayKeyOf, money, timeHM } from '../lib/format';
import { compressImage, blobToDataURL } from '../lib/image';
import { haptic } from '../lib/platform';
import { usePeople } from '../lib/hooks';
import type { Expense, PayMethod, Person } from '../lib/types';
import { Avatar, Chips, Field, Money, Seg, Sheet, Stepper, toast } from './kit';
import { celebrate } from './celebrate';

export const EXPENSE_CATS = ['Insumos', 'Pan', 'Carnes', 'Verduras', 'Lácteos', 'Empaques', 'Gas', 'Domicilios', 'Nómina', 'Adelanto', 'Arriendo', 'Servicios', 'Transporte', 'Otro'];
const CAT_ICON: Record<string, string> = { Insumos: '🧺', Pan: '🥖', Carnes: '🥩', Verduras: '🥬', 'Lácteos': '🧀', Empaques: '📦', Gas: '🔥', Domicilios: '🛵', 'Nómina': '👥', Adelanto: '🤝', Arriendo: '🏠', Servicios: '💡', Transporte: '🚌', Otro: '🧾' };
export const catIcon = (c: string) => CAT_ICON[c] ?? '🧾';

async function makeThumb(b: Blob): Promise<string | undefined> {
  try {
    const small = await compressImage(new File([b], 'x.jpg', { type: 'image/jpeg' }), 420, 0.55);
    const url = await blobToDataURL(small);
    return url.length < 60000 ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Registrar un gasto. Si es nómina o adelanto, la hoja cambia a la del empleado. */
export function ExpenseSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: string }) {
  const [amount, setAmount] = useState(0);
  const [cat, setCat] = useState<string | undefined>();
  const [supplier, setSupplier] = useState('');
  const [method, setMethod] = useState<PayMethod>('efectivo');
  const [fromCash, setFromCash] = useState(true);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState<string>();
  const [payroll, setPayroll] = useState<null | 'nomina' | 'adelanto'>(null);

  useEffect(() => {
    if (open) {
      setAmount(0); setCat(preset); setSupplier(''); setMethod('efectivo'); setFromCash(true); setNote(''); setPhoto(undefined); setPreview(undefined);
      setPayroll(preset === 'Nómina' ? 'nomina' : preset === 'Adelanto' ? 'adelanto' : null);
    }
  }, [open]);

  const suppliers = useLiveQuery(async () => {
    const all = await db.expenses.orderBy('createdAt').reverse().limit(200).toArray();
    return [...new Set(all.map((e) => e.supplier).filter(Boolean) as string[])].slice(0, 8);
  }, []) ?? [];

  const pickCat = (c: string) => {
    setCat(c);
    if (c === 'Nómina') setPayroll('nomina');
    if (c === 'Adelanto') setPayroll('adelanto');
  };

  const saveIt = async () => {
    if (!amount || !cat) return;
    const biz = await getBusiness();
    const d = await getDevice();
    const now = Date.now();
    await save('expenses', {
      id: uid(), dayKey: dayKeyOf(now, biz.dayCutoffHour), createdAt: now, amount, category: cat, kind: 'gasto',
      supplier: supplier.trim() || undefined, method, fromCash: method === 'efectivo' && fromCash, note: note.trim() || undefined,
      by: d.personId, photo, thumb: photo ? await makeThumb(photo) : undefined,
    } as Expense);
    haptic.success();
    toast(`${catIcon(cat)} Gasto de ${money(amount)} guardado`);
    onClose();
  };

  if (payroll) return <PayrollSheet open={open} mode={payroll} onClose={onClose} />;

  return (
    <Sheet open={open} onClose={onClose} full title="Registrar gasto" footer={<button className="btn btn-go btn-block btn-xl" disabled={!amount || !cat} onClick={saveIt}>{!amount ? 'Escribe el valor' : !cat ? 'Elige en qué se gastó' : `Guardar ${money(amount)}`}</button>}>
      <Money big value={amount} onChange={setAmount} autoFocus />
      <div style={{ height: 14 }} />
      <Field label="¿En qué se gastó?">
        <div className="chips">
          {EXPENSE_CATS.map((c) => (
            <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => { haptic.tap(); pickCat(c); }}>{catIcon(c)} {c}</button>
          ))}
        </div>
      </Field>
      <Field label="¿Dónde se compró?">
        <input className="input" placeholder="Makro, Corabastos, panadería…" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        {suppliers.length > 0 && <Chips small value={supplier} options={suppliers} onChange={setSupplier} />}
      </Field>
      <Field label="¿Cómo se pagó?">
        <Seg<PayMethod> value={method} onChange={setMethod} options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: '📲 Transferencia' }]} />
      </Field>
      {method === 'efectivo' && (
        <Field label="¿Salió de la caja de hoy?" hint="Si sí, se descuenta en el cierre de caja.">
          <Seg<'s' | 'n'> value={fromCash ? 's' : 'n'} onChange={(v) => setFromCash(v === 's')} options={[{ value: 's', label: 'Sí, de la caja' }, { value: 'n', label: 'No, otra plata' }]} />
        </Field>
      )}
      <Field label="Foto de la factura">
        <label className="photo-drop">
          {preview ? <img src={preview} alt="Factura" /> : <><span style={{ fontSize: 30 }}>📸</span><span>Tomar foto</span></>}
          <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const b = await compressImage(f); setPhoto(b); setPreview(URL.createObjectURL(b)); }} />
        </label>
      </Field>
      <Field label="Nota"><input className="input" placeholder="Ej: 2 bloques de queso 2,5 kg" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Sheet>
  );
}

/** Pago de nómina o adelanto a un empleado: días × tarifa + bonos − adelantos pendientes. */
export function PayrollSheet({ open, mode: initialMode, person: initialPerson, onClose }: { open: boolean; mode: 'nomina' | 'adelanto'; person?: Person; onClose: () => void }) {
  const people = usePeople();
  const [mode, setMode] = useState(initialMode);
  const [pid, setPid] = useState<string | undefined>(initialPerson?.id);
  const [days, setDays] = useState(6);
  const [rate, setRate] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PayMethod>('efectivo');
  const [fromCash, setFromCash] = useState(true);
  const [note, setNote] = useState('');
  const person = people.find((p) => p.id === pid);

  useEffect(() => { if (open) { setMode(initialMode); setPid(initialPerson?.id); setDays(6); setBonus(0); setAmount(0); setNote(''); } }, [open]);
  useEffect(() => { if (person) setRate(person.dailyRate ?? 0); }, [person?.id]);

  const history = useLiveQuery(async () => (pid ? (await db.expenses.where('personId').equals(pid).toArray()).filter((e) => !e.deleted).sort((a, b) => b.createdAt - a.createdAt) : []), [pid]) ?? [];
  const lastPay = history.find((e) => e.kind === 'nomina');
  const advances = history.filter((e) => e.kind === 'adelanto' && (!lastPay || e.createdAt > lastPay.createdAt));
  const owed = advances.reduce((a, e) => a + e.amount, 0);
  const total = mode === 'nomina' ? Math.max(0, days * rate + bonus - owed) : amount;

  const saveIt = async () => {
    if (!person || !total) return;
    const biz = await getBusiness();
    const d = await getDevice();
    const now = Date.now();
    await save('expenses', {
      id: uid(), dayKey: dayKeyOf(now, biz.dayCutoffHour), createdAt: now, amount: total,
      category: mode === 'nomina' ? 'Nómina' : 'Adelanto', kind: mode, personId: person.id,
      payroll: mode === 'nomina' ? { days, rate, bonus, deduct: owed } : undefined,
      supplier: person.name, method, fromCash: method === 'efectivo' && fromCash, note: note.trim() || undefined, by: d.personId,
    } as Expense);
    if (mode === 'nomina' && rate && rate !== person.dailyRate) await save('people', { ...person, dailyRate: rate });
    celebrate({ title: money(total), sub: `${mode === 'nomina' ? 'Nómina pagada' : 'Adelanto registrado'} a ${person.name}`, icon: person.emoji });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} full title={mode === 'nomina' ? 'Pagar nómina' : 'Dar adelanto'} footer={<button className="btn btn-go btn-block btn-xl" disabled={!person || !total} onClick={saveIt}>{!person ? 'Elige a quién' : `Pagar ${money(total)} a ${person.name.split(' ')[0]}`}</button>}>
      <Seg<'nomina' | 'adelanto'> value={mode} onChange={setMode} options={[{ value: 'nomina', label: '👥 Nómina' }, { value: 'adelanto', label: '🤝 Adelanto' }]} />
      <div className="label" style={{ margin: '16px 0 10px' }}>¿A quién?</div>
      <div className="people" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
        {people.map((p) => (
          <button key={p.id} className="person" style={{ padding: '12px 8px', outline: pid === p.id ? '3px solid var(--ink)' : 'none' }} onClick={() => { haptic.tap(); setPid(p.id); }}>
            <Avatar p={p} size={48} /><b style={{ fontSize: 14 }}>{p.name.split(' ')[0]}</b>
          </button>
        ))}
      </div>
      {people.length === 0 && <div className="callout info">Primero agrega a tu equipo en Negocio → Equipo.</div>}
      {person && (
        <div style={{ marginTop: 16 }}>
          {mode === 'nomina' ? (
            <>
              <div className="card pad" style={{ margin: '0 0 14px' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="label">Días trabajados</span><Stepper value={days} min={0} onChange={setDays} /></div>
                <div style={{ height: 12 }} />
                <Field label="Pago por día"><Money value={rate} onChange={setRate} /></Field>
                <Field label="Bono / extra (opcional)"><Money value={bonus} onChange={setBonus} /></Field>
                <div className="kv"><span>{days} días × {money(rate)}</span><b>{money(days * rate)}</b></div>
                {bonus > 0 && <div className="kv"><span>Bono</span><b>+{money(bonus)}</b></div>}
                {owed > 0 && <div className="kv"><span>Adelantos pendientes ({advances.length})</span><b style={{ color: 'var(--aji)' }}>−{money(owed)}</b></div>}
                <div className="kv total"><span>A pagar</span><b className="display" style={{ fontSize: 24 }}>{money(total)}</b></div>
              </div>
            </>
          ) : (
            <Field label="Valor del adelanto" hint="Se descuenta solo en la próxima nómina."><Money big value={amount} onChange={setAmount} /></Field>
          )}
          <Field label="¿Cómo se paga?"><Seg<PayMethod> value={method} onChange={setMethod} options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: '📲 Transferencia' }]} /></Field>
          {method === 'efectivo' && <Field label="¿Sale de la caja de hoy?"><Seg<'s' | 'n'> value={fromCash ? 's' : 'n'} onChange={(v) => setFromCash(v === 's')} options={[{ value: 's', label: 'Sí' }, { value: 'n', label: 'No' }]} /></Field>}
          <Field label="Nota"><input className="input" placeholder="Ej: semana 18–24 nov" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {history.length > 0 && (
            <>
              <div className="label" style={{ marginBottom: 8 }}>Historial de {person.name.split(' ')[0]}</div>
              <div className="card" style={{ margin: 0 }}>
                {history.slice(0, 8).map((e) => (
                  <div key={e.id} className="li"><div className="li-ico">{e.kind === 'adelanto' ? '🤝' : '👥'}</div><div className="li-main"><div className="li-title">{e.kind === 'adelanto' ? 'Adelanto' : `Nómina${e.payroll ? ` · ${e.payroll.days} días` : ''}`}</div><div className="li-sub">{e.dayKey} · {timeHM(e.createdAt)}</div></div><div className="li-val">{money(e.amount)}</div></div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function useExpenseTotals(dayKey: string) {
  const list = useLiveQuery(async () => (await db.expenses.where('dayKey').equals(dayKey).toArray()).filter((e) => !e.deleted).sort((a, b) => b.createdAt - a.createdAt), [dayKey]) ?? [];
  return useMemo(() => ({ list, total: list.reduce((a, e) => a + e.amount, 0), fromCash: list.filter((e) => e.fromCash).reduce((a, e) => a + e.amount, 0) }), [list]);
}
