import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, ChevronRight, Database, Download, FileSpreadsheet, KeyRound, Landmark, Plus, Upload, UtensilsCrossed, Wallet, Info, Clock3 } from 'lucide-react';
import { db, saveSettings, uid } from '../lib/db';
import { CATEGORY_ORDER } from '../data/menu';
import { money } from '../lib/format';
import { exportBackup, exportExpensesCSV, exportSalesCSV, importBackup } from '../lib/backup';
import { haptic } from '../lib/platform';
import { useSettings } from '../lib/hooks';
import type { Product } from '../lib/types';
import { Field, MoneyInput, PromptSheet, Segmented, Sheet, toast } from '../components/ui';
import { CAT_COLOR } from './Vender';

const APP_VERSION = '0.1.0';

export function Mas() {
  const s = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const counts = useLiveQuery(async () => ({ orders: await db.orders.count(), expenses: await db.expenses.count(), unsynced: await db.orders.where('synced').equals(0).count() }), []);

  const guarded = (fn: () => void) => () => {
    if (!s.ownerPin) return fn();
    setPinFor(() => fn);
  };

  return (
    <div className="screen">
      <header className="large-head">
        <div className="eyebrow">{s.businessName}</div>
        <h1 className="large-title">Más</h1>
      </header>

      <div className="section-title">Negocio</div>
      <div className="group list">
        <button className="row" onClick={guarded(() => setMenuOpen(true))}>
          <div className="row-icon tint-orange"><UtensilsCrossed size={18} /></div>
          <div className="row-main"><div className="row-title">Carta y precios</div><div className="row-sub">Editar precios, agotados, productos nuevos</div></div>
          <ChevronRight size={18} className="chev" />
        </button>
        <button className="row" onClick={guarded(() => setSettingsOpen(true))}>
          <div className="row-icon tint-blue"><BellRing size={18} /></div>
          <div className="row-main"><div className="row-title">Ajustes de operación</div><div className="row-sub">Recordatorios, cuentas, base de caja, domicilio, PIN</div></div>
          <ChevronRight size={18} className="chev" />
        </button>
      </div>

      <div className="section-title">Datos</div>
      <div className="group list">
        <button className="row" onClick={async () => { await exportSalesCSV(); }}>
          <div className="row-icon tint-green"><FileSpreadsheet size={18} /></div>
          <div className="row-main"><div className="row-title">Exportar ventas (Excel/CSV)</div><div className="row-sub">{counts?.orders ?? 0} pedidos registrados</div></div>
          <Download size={18} className="chev" />
        </button>
        <button className="row" onClick={async () => { await exportExpensesCSV(); }}>
          <div className="row-icon tint-green"><FileSpreadsheet size={18} /></div>
          <div className="row-main"><div className="row-title">Exportar gastos (Excel/CSV)</div><div className="row-sub">{counts?.expenses ?? 0} gastos registrados</div></div>
          <Download size={18} className="chev" />
        </button>
        <button className="row" onClick={async () => { await exportBackup(); await saveSettings({}); toast('Respaldo generado'); }}>
          <div className="row-icon tint-purple"><Database size={18} /></div>
          <div className="row-main"><div className="row-title">Hacer respaldo completo</div><div className="row-sub">Guárdalo en Drive o envíalo por WhatsApp a diario</div></div>
          <Download size={18} className="chev" />
        </button>
        <label className="row" onClick={(e) => { if (s.ownerPin) { e.preventDefault(); guarded(() => document.getElementById('restore-input')?.click())(); } }}>
          <div className="row-icon tint-gray"><Upload size={18} /></div>
          <div className="row-main"><div className="row-title">Restaurar respaldo</div><div className="row-sub">Combina un archivo de respaldo con lo que hay</div></div>
          <ChevronRight size={18} className="chev" />
          <input
            id="restore-input"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const r = await importBackup(f);
                toast(`Restaurado: ${r.orders} pedidos, ${r.expenses} gastos`);
              } catch (err) {
                toast(String((err as Error).message || err), 'warn');
              }
            }}
          />
        </label>
      </div>

      <div className="callout info">
        <Info size={18} />
        <div>
          <b>Versión {APP_VERSION} — modo local.</b> Los datos viven solo en este teléfono. Haz respaldo diario hasta que activemos la nube (siguiente versión), que sincroniza el Oppo con los iPhone de la dueña y la cocina.
        </div>
      </div>

      <MenuEditor open={menuOpen} onClose={() => setMenuOpen(false)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PromptSheet
        open={!!pinFor}
        title="PIN de la dueña"
        placeholder="PIN"
        secret
        confirmLabel="Entrar"
        onClose={() => setPinFor(null)}
        onConfirm={(pin) => {
          if (pin === s.ownerPin) {
            const fn = pinFor;
            setPinFor(null);
            fn?.();
          } else {
            haptic.warn();
            toast('PIN incorrecto', 'warn');
          }
        }}
      />
    </div>
  );
}

function MenuEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []) ?? [];
  const [edit, setEdit] = useState<Product | null>(null);
  const cats = [...new Set([...CATEGORY_ORDER, ...products.map((p) => p.category)])];
  return (
    <>
      <Sheet open={open} onClose={onClose} full title="Carta y precios" subtitle={`${products.filter((p) => p.active).length} productos activos`}>
        {cats.map((c) => {
          const list = products.filter((p) => p.category === c);
          if (!list.length) return null;
          return (
            <div key={c}>
              <div className="section-title"><i className="dot" style={{ background: CAT_COLOR[c] ?? '#8E8E93' }} /> {c}</div>
              <div className="group list">
                {list.map((p) => (
                  <div key={p.id} className={`row ${!p.active ? 'dim' : ''}`}>
                    <button className="row-main left" onClick={() => setEdit(p)}>
                      <div className="row-title">{p.name}</div>
                      <div className="row-sub">{money(p.price)}{!p.active ? ' · oculto' : ''}</div>
                    </button>
                    <button
                      className={`toggle-pill ${p.soldOut ? 'on' : ''}`}
                      onClick={async () => { haptic.tap(); await db.products.update(p.id, { soldOut: !p.soldOut }); }}
                    >
                      {p.soldOut ? 'Agotado' : 'Disponible'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <button
          className="btn btn-plain btn-block"
          onClick={() => setEdit({ id: '', name: '', category: 'Prenzao', price: 0, description: '', sort: products.length, active: true, soldOut: false })}
        >
          <Plus size={18} /> Agregar producto (bebidas, adiciones…)
        </button>
      </Sheet>
      <ProductForm product={edit} cats={[...cats, 'Bebidas', 'Adiciones'].filter((v, i, a) => a.indexOf(v) === i)} onClose={() => setEdit(null)} />
    </>
  );
}

function ProductForm({ product, cats, onClose }: { product: Product | null; cats: string[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Product | null>(null);
  const p = draft && product && draft.id === product.id && draft.sort === product.sort ? draft : product;
  const set = (patch: Partial<Product>) => p && setDraft({ ...p, ...patch });
  const isNew = !!product && !product.id;
  return (
    <Sheet
      open={!!product}
      onClose={() => { setDraft(null); onClose(); }}
      title={isNew ? 'Nuevo producto' : 'Editar producto'}
      footer={
        <button
          className="btn btn-primary btn-block btn-xl"
          disabled={!p?.name.trim() || !p?.price}
          onClick={async () => {
            if (!p) return;
            await db.products.put({ ...p, id: p.id || uid(), name: p.name.trim() });
            haptic.success();
            toast('Carta actualizada');
            setDraft(null);
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      {p && (
        <>
          <Field label="Nombre"><input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Precio"><MoneyInput value={p.price} onChange={(price) => set({ price })} /></Field>
          <Field label="Categoría">
            <div className="chips">
              {cats.map((c) => <button key={c} className={`chip ${p.category === c ? 'on' : ''}`} onClick={() => set({ category: c })}>{c}</button>)}
            </div>
          </Field>
          <Field label="Ingredientes / descripción"><textarea className="input" rows={3} value={p.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="¿Se muestra en la carta?">
            <Segmented<'si' | 'no'> value={p.active ? 'si' : 'no'} onChange={(v) => set({ active: v === 'si' })} options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'Oculto' }]} />
          </Field>
        </>
      )}
    </Sheet>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const [acc, setAcc] = useState('');
  return (
    <Sheet open={open} onClose={onClose} full title="Ajustes de operación">
      <div className="section-title"><BellRing size={15} /> Recordatorios</div>
      <div className="group pad">
        <Field label="Insistir con pagos pendientes cada">
          <Segmented<string> value={String(s.reminderMinutes)} onChange={(v) => saveSettings({ reminderMinutes: Number(v) })} options={['3', '5', '10', '15'].map((v) => ({ value: v, label: `${v} min` }))} />
        </Field>
        <Field label="Mostrador: preguntar si se entregó después de">
          <Segmented<string> value={String(s.readyMinutes)} onChange={(v) => saveSettings({ readyMinutes: Number(v) })} options={['5', '8', '12', '20'].map((v) => ({ value: v, label: `${v} min` }))} />
        </Field>
        <Field label="Domicilio: preguntar si llegó después de">
          <Segmented<string> value={String(s.deliveryMinutes)} onChange={(v) => saveSettings({ deliveryMinutes: Number(v) })} options={['25', '40', '60'].map((v) => ({ value: v, label: `${v} min` }))} />
        </Field>
      </div>

      <div className="section-title"><Landmark size={15} /> Cuentas para transferencias</div>
      <div className="group pad">
        <div className="chips">
          {s.transferAccounts.map((a) => (
            <button key={a} className="chip on" onClick={() => saveSettings({ transferAccounts: s.transferAccounts.filter((x) => x !== a) })}>{a} ✕</button>
          ))}
        </div>
        <div className="inline-add">
          <input className="input" placeholder="Ej: Nequi 300… / Llave @prenzao" value={acc} onChange={(e) => setAcc(e.target.value)} />
          <button className="btn btn-primary" disabled={!acc.trim()} onClick={() => { saveSettings({ transferAccounts: [...s.transferAccounts, acc.trim()] }); setAcc(''); }}>Agregar</button>
        </div>
      </div>

      <div className="section-title"><Wallet size={15} /> Caja y domicilios</div>
      <div className="group pad">
        <Field label="Base de caja (con cuánto se abre)"><MoneyInput value={s.cashBase} onChange={(n) => saveSettings({ cashBase: n })} /></Field>
        <Field label="Valor de domicilio por defecto" hint="Pendiente definir zonas y tarifas reales."><MoneyInput value={s.defaultDeliveryFee} onChange={(n) => saveSettings({ defaultDeliveryFee: n })} /></Field>
      </div>

      <div className="section-title"><Clock3 size={15} /> Día operativo</div>
      <div className="group pad">
        <Field label="El día cambia a las" hint="Ventas después de medianoche cuentan para el día anterior hasta esta hora.">
          <Segmented<string> value={String(s.dayCutoffHour)} onChange={(v) => saveSettings({ dayCutoffHour: Number(v) })} options={['0', '2', '4', '6'].map((v) => ({ value: v, label: `${v}:00` }))} />
        </Field>
      </div>

      <div className="section-title"><KeyRound size={15} /> PIN de la dueña</div>
      <div className="group pad">
        <Field label="Protege carta, ajustes y restaurar" hint={s.ownerPin ? 'PIN activo. Borra el campo para quitarlo.' : 'Sin PIN: cualquiera puede cambiar precios.'}>
          <input className="input" inputMode="numeric" type="password" placeholder="4 dígitos" defaultValue={s.ownerPin} onBlur={(e) => saveSettings({ ownerPin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
        </Field>
      </div>
    </Sheet>
  );
}
