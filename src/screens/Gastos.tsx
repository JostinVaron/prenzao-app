import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronLeft, ChevronRight, ImageIcon, Plus, Receipt, Trash2 } from 'lucide-react';
import { db, getSettings, uid } from '../lib/db';
import { dayKeyOf, dayLabel, money, shiftDayKey, timeHM } from '../lib/format';
import { compressImage } from '../lib/image';
import { haptic } from '../lib/platform';
import { useTodayKey } from '../lib/hooks';
import type { Expense, PayMethod } from '../lib/types';
import { Chips, Empty, Field, MoneyInput, Segmented, Sheet, toast } from '../components/ui';

export const EXPENSE_CATS = ['Insumos', 'Pan', 'Carnes', 'Verduras', 'Lácteos', 'Empaques', 'Gas', 'Domicilios', 'Nómina', 'Arriendo', 'Servicios', 'Transporte', 'Otro'];

export function Gastos() {
  const todayKey = useTodayKey();
  const [dayKey, setDayKey] = useState<string | null>(null);
  const day = dayKey ?? todayKey;
  const [form, setForm] = useState(false);
  const [view, setView] = useState<Expense | null>(null);

  const list = useLiveQuery(() => db.expenses.where('dayKey').equals(day).reverse().sortBy('createdAt'), [day]) ?? [];
  const total = list.reduce((a, e) => a + e.amount, 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  return (
    <div className="screen">
      <header className="large-head">
        <div className="eyebrow">Compras y pagos</div>
        <h1 className="large-title">Gastos</h1>
      </header>

      <div className="day-nav">
        <button className="icon-btn round" onClick={() => setDayKey(shiftDayKey(day, -1))} aria-label="Día anterior"><ChevronLeft size={18} /></button>
        <span>{dayLabel(day, todayKey)}</span>
        <button className="icon-btn round" disabled={day >= todayKey} onClick={() => setDayKey(shiftDayKey(day, 1))} aria-label="Día siguiente"><ChevronRight size={18} /></button>
      </div>

      <div className="stat-hero">
        <div className="stat-hero-label">Total gastado</div>
        <div className="stat-hero-value">{money(total)}</div>
        {byCat.length > 0 && (
          <div className="cat-split">
            {byCat.map(([c, v]) => (
              <span key={c} className="cat-split-item">{c} <b>{money(v)}</b></span>
            ))}
          </div>
        )}
      </div>

      <div className="group list">
        {list.length === 0 && <Empty icon={<Receipt size={30} />} title="Sin gastos registrados" text="Toca + para registrar una compra. Puedes tomarle foto a la factura." />}
        {list.map((e) => (
          <button key={e.id} className="row" onClick={() => setView(e)}>
            <div className="row-icon">{e.photo ? <ImageIcon size={18} /> : <Receipt size={18} />}</div>
            <div className="row-main">
              <div className="row-title">{e.category}{e.supplier ? ` · ${e.supplier}` : ''}</div>
              <div className="row-sub">{timeHM(e.createdAt)} · {e.method === 'efectivo' ? (e.fromCash ? 'Efectivo de caja' : 'Efectivo') : 'Transferencia'}{e.note ? ` · ${e.note}` : ''}</div>
            </div>
            <div className="row-amount">{money(e.amount)}</div>
          </button>
        ))}
      </div>

      <button className="fab" aria-label="Registrar gasto" onClick={() => { haptic.tap(); setForm(true); }}>
        <Plus size={26} strokeWidth={2.6} />
      </button>

      <ExpenseForm open={form} onClose={() => setForm(false)} />
      <ExpenseView expense={view} onClose={() => setView(null)} />
    </div>
  );
}

function ExpenseForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<string | undefined>();
  const [supplier, setSupplier] = useState('');
  const [method, setMethod] = useState<PayMethod>('efectivo');
  const [fromCash, setFromCash] = useState(true);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | undefined>();
  const [preview, setPreview] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const suppliers = useLiveQuery(async () => {
    const all = await db.expenses.orderBy('createdAt').reverse().limit(200).toArray();
    return [...new Set(all.map((e) => e.supplier).filter(Boolean) as string[])].slice(0, 8);
  }, []) ?? [];

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const reset = () => {
    setAmount(0); setCategory(undefined); setSupplier(''); setMethod('efectivo'); setFromCash(true); setNote(''); setPhoto(undefined); setPreview(undefined);
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    const b = await compressImage(f);
    setPhoto(b);
    setPreview(URL.createObjectURL(b));
  };

  const missing = !amount ? 'el valor' : !category ? 'la categoría' : '';

  const save = async () => {
    if (missing || saving) return;
    setSaving(true);
    const s = await getSettings();
    const now = Date.now();
    await db.expenses.add({
      id: uid(),
      dayKey: dayKeyOf(now, s.dayCutoffHour),
      createdAt: now,
      amount,
      category: category!,
      supplier: supplier.trim() || undefined,
      method,
      fromCash: method === 'efectivo' && fromCash,
      note: note.trim() || undefined,
      photo,
      synced: 0,
    });
    haptic.success();
    toast(`Gasto de ${money(amount)} registrado`);
    reset();
    setSaving(false);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      title="Registrar gasto"
      footer={
        <div className="checkout-foot">
          {missing && <div className="missing">Falta: {missing}</div>}
          <button className="btn btn-primary btn-block btn-xl" disabled={!!missing || saving} onClick={save}>Guardar gasto{amount ? ` · ${money(amount)}` : ''}</button>
        </div>
      }
    >
      <MoneyInput big value={amount} onChange={setAmount} autoFocus />
      <Field label="¿En qué se gastó?">
        <Chips value={category} options={EXPENSE_CATS} onChange={setCategory} />
      </Field>
      <Field label="Proveedor (opcional)">
        <input className="input" placeholder="Ej: Makro, Corabastos, panadería…" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        {suppliers.length > 0 && (
          <div className="chips" style={{ marginTop: 8 }}>
            {suppliers.map((sp) => <button key={sp} className={`chip sm ${supplier === sp ? 'on' : ''}`} onClick={() => setSupplier(sp)}>{sp}</button>)}
          </div>
        )}
      </Field>
      <Field label="¿Cómo se pagó?">
        <Segmented<PayMethod> value={method} onChange={setMethod} options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: '📲 Transferencia' }]} />
      </Field>
      {method === 'efectivo' && (
        <Field label="¿Salió de la caja del día?" hint="Si sí, se descuenta del efectivo esperado en el cierre de caja.">
          <Segmented<'si' | 'no'> value={fromCash ? 'si' : 'no'} onChange={(v) => setFromCash(v === 'si')} options={[{ value: 'si', label: 'Sí, de la caja' }, { value: 'no', label: 'No, otra plata' }]} />
        </Field>
      )}
      <Field label="Foto de la factura">
        <label className={`photo-drop ${preview ? 'has' : ''}`}>
          {preview ? <img src={preview} alt="Factura" /> : (<><Camera size={26} /><span>Tomar foto</span></>)}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} hidden />
        </label>
        <span className="field-hint">Próxima versión: la IA leerá la factura y llenará los datos sola.</span>
      </Field>
      <Field label="Nota (opcional)">
        <input className="input" placeholder="Ej: 2 bloques de queso 2,5 kg" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function ExpenseView({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (expense?.photo) {
      const u = URL.createObjectURL(expense.photo);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(undefined);
  }, [expense]);
  const e = expense;
  return (
    <Sheet open={!!e} onClose={onClose} title={e ? money(e.amount) : ''} subtitle={e ? `${e.category} · ${timeHM(e.createdAt)}` : ''}>
      {e && (
        <>
          <div className="group pad">
            {e.supplier && <div className="kv"><span>Proveedor</span><b>{e.supplier}</b></div>}
            <div className="kv"><span>Pago</span><b>{e.method === 'efectivo' ? (e.fromCash ? 'Efectivo de caja' : 'Efectivo (otra plata)') : 'Transferencia'}</b></div>
            {e.note && <div className="kv"><span>Nota</span><b>{e.note}</b></div>}
          </div>
          {url && <img className="receipt-img" src={url} alt="Factura" />}
          <button
            className="btn btn-plain danger btn-block"
            onClick={async () => {
              if (!confirm('¿Eliminar este gasto?')) return;
              await db.expenses.delete(e.id);
              toast('Gasto eliminado', 'warn');
              onClose();
            }}
          >
            <Trash2 size={18} /> Eliminar gasto
          </button>
        </>
      )}
    </Sheet>
  );
}
