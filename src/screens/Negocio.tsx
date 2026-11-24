import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import QRCode from 'qrcode';
import { db, hashPin, save, saveBusiness, uid } from '../lib/db';
import { CATEGORY_EMOJI, CATEGORY_ORDER } from '../data/menu';
import { elapsedLabel, money, timeHM } from '../lib/format';
import { STATUS_LABEL } from '../lib/orders';
import { haptic, shareText } from '../lib/platform';
import { exportBackup, exportExpensesCSV, exportSalesCSV, importBackup } from '../lib/backup';
import { buildMenuLink, PUBLIC_BASE } from '../lib/menulink';
import { sync } from '../lib/sync/engine';
import { useBusiness, useCountUp, usePeople, useSync, useTodayKey, useTodayOrders } from '../lib/hooks';
import type { Mode, Person, Product } from '../lib/types';
import { Avatar, Chips, Empty, Field, Money, PinPad, Ring, Seg, Sheet, toast } from '../ui/kit';
import { PayrollSheet, useExpenseTotals } from '../ui/money';

type Tab = 'panel' | 'equipo' | 'carta' | 'ajustes';

export function Negocio() {
  const [tab, setTab] = useState<Tab>('panel');
  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hello"><div className="grow"><div className="hello-title">Negocio 📊</div><div className="hello-sub">Solo para la dueña</div></div></div>
      <div className="pad-x" style={{ marginBottom: 14 }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[{ value: 'panel', label: 'Hoy' }, { value: 'equipo', label: 'Equipo' }, { value: 'carta', label: 'Carta' }, { value: 'ajustes', label: 'Ajustes' }]} />
      </div>
      {tab === 'panel' && <Panel />}
      {tab === 'equipo' && <Equipo />}
      {tab === 'carta' && <Carta />}
      {tab === 'ajustes' && <Ajustes />}
    </div>
  );
}

// ======================= Panel en vivo =======================
function Panel() {
  const biz = useBusiness();
  const day = useTodayKey();
  const orders = useTodayOrders(day);
  const people = usePeople();
  const exp = useExpenseTotals(day);
  const valid = orders.filter((o) => o.status !== 'cancelado');
  const sales = valid.reduce((a, o) => a + o.total, 0);
  const shown = useCountUp(sales);
  const paid = valid.filter((o) => o.payStatus === 'pagado');
  const cash = paid.filter((o) => o.payMethod === 'efectivo').reduce((a, o) => a + o.total, 0);
  const transfer = paid.filter((o) => o.payMethod === 'transferencia').reduce((a, o) => a + o.total, 0);
  const due = sales - cash - transfer;
  const dom = valid.filter((o) => o.channel === 'domicilio').length;

  const hours = useMemo(() => {
    const h = Array(24).fill(0);
    valid.forEach((o) => (h[new Date(o.createdAt).getHours()] += o.total));
    const first = Math.min(11, ...h.map((v, i) => (v ? i : 99)));
    const last = Math.max(21, ...h.map((v, i) => (v ? i : -1)));
    return h.slice(first, last + 1).map((v, i) => ({ h: first + i, v }));
  }, [valid]);
  const maxH = Math.max(1, ...hours.map((x) => x.v));
  const peak = [...hours].sort((a, b) => b.v - a.v)[0];

  const top = useMemo(() => {
    const m = new Map<string, { name: string; q: number; v: number }>();
    valid.forEach((o) => o.items.forEach((i) => { const c = m.get(i.productId) ?? { name: i.name, q: 0, v: 0 }; c.q += i.qty; c.v += i.qty * i.price; m.set(i.productId, c); }));
    return [...m.values()].sort((a, b) => b.q - a.q).slice(0, 6);
  }, [valid]);

  const team = useMemo(() => people.map((p) => ({ p, taken: valid.filter((o) => o.createdBy === p.id).length, done: valid.filter((o) => o.log.some((e) => e.by === p.id && e.status === 'listo')).length })).filter((x) => x.taken || x.done), [people, valid]);

  const feed = useMemo(() => orders.flatMap((o) => o.log.map((e) => ({ o, e }))).sort((a, b) => b.e.at - a.e.at).slice(0, 10), [orders]);
  const who = (id?: string) => people.find((p) => p.id === id);

  return (
    <>
      <div className="hero">
        <small>Ventas de hoy</small>
        <div className="v">{money(shown)}</div>
        <div className="sub">{valid.length} pedidos · ticket {money(valid.length ? Math.round(sales / valid.length) : 0)}{biz.dailyGoal ? ` · meta ${money(biz.dailyGoal)}` : ''}</div>
        {biz.dailyGoal > 0 && <div className="ring-wrap"><Ring value={sales / biz.dailyGoal} size={70}><span className="ring-lbl" style={{ color: '#fff' }}>{Math.round((sales / biz.dailyGoal) * 100)}%</span></Ring></div>}
      </div>
      <div className="kpis">
        <div className="kpi"><span>💵 Efectivo</span><b>{money(cash)}</b></div>
        <div className="kpi"><span>📲 Transferencias</span><b>{money(transfer)}</b></div>
        <div className="kpi"><span>💰 Por cobrar</span><b className={due ? 'neg' : ''}>{money(due)}</b></div>
        <div className="kpi"><span>🧾 Gastos</span><b className="neg">{money(exp.total)}</b></div>
        <div className="kpi"><span>Ventas − gastos</span><b>{money(sales - exp.total)}</b></div>
        <div className="kpi"><span>🛵 Domicilios</span><b>{dom} <small className="muted" style={{ fontSize: 13 }}>de {valid.length}</small></b></div>
      </div>

      <div className="sec"><h3>Ventas por hora</h3>{peak?.v ? <span>Pico {peak.h % 12 || 12} {peak.h < 12 ? 'a.m.' : 'p.m.'}</span> : null}</div>
      <div className="card pad">
        <div className="bars">{hours.map(({ h, v }) => <div key={h} className="bar-col"><div className={`bar ${v ? 'on' : ''}`} style={{ height: `${(v / maxH) * 100}%` }} /><span className="bar-lbl">{h % 12 || 12}</span></div>)}</div>
      </div>

      <div className="sec"><h3>Lo más vendido hoy</h3></div>
      <div className="card pad">
        {top.length === 0 && <div className="muted">Aún no hay ventas.</div>}
        {top.map((t, i) => (
          <div key={t.name} className="kv" style={{ alignItems: 'center' }}>
            <span style={{ color: 'var(--ink)', fontWeight: 700, flex: 1 }}>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} {t.name}<span style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--fill)', marginTop: 5 }}><i style={{ display: 'block', height: 6, borderRadius: 3, width: `${(t.q / top[0].q) * 100}%`, background: 'var(--grad)' }} /></span></span>
            <b style={{ minWidth: 70 }}>{t.q} <small className="muted">· {money(t.v)}</small></b>
          </div>
        ))}
      </div>

      {team.length > 0 && (
        <>
          <div className="sec"><h3>Equipo hoy</h3></div>
          <div className="card">
            {team.map(({ p, taken, done }) => <div key={p.id} className="li"><Avatar p={p} size={38} /><div className="li-main"><div className="li-title">{p.name}</div><div className="li-sub">{taken} pedidos tomados · {done} sacados de cocina</div></div></div>)}
          </div>
        </>
      )}

      <div className="sec"><h3>Movimiento</h3><span>en vivo</span></div>
      <div className="card pad">
        {feed.length === 0 && <div className="muted">Sin movimiento todavía.</div>}
        <div className="feed">
          {feed.map(({ o, e }, k) => (
            <div key={k} className="feed-item">
              <Avatar p={who(e.by)} size={28} />
              <span>{who(e.by)?.name.split(' ')[0] ?? 'Alguien'} · {e.status === 'pago' ? `cobró #${o.number} (${money(o.total)})` : e.status === 'preparando' ? `tomó #${o.number}` : `${STATUS_LABEL[e.status as keyof typeof STATUS_LABEL]?.toLowerCase()} #${o.number}`}</span>
              <time>{timeHM(e.at)}</time>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ======================= Equipo =======================
const EMOJIS = ['👩‍🍳', '👨‍🍳', '🧑‍🍳', '👩', '👨', '🧑', '👵', '🧔', '👱‍♀️', '👱', '🦸‍♀️', '🦸', '🐯', '🦊', '🐼', '🌶️'];
const COLORS = ['#ff4d1c', '#e0302a', '#ffb800', '#149a57', '#2f6fff', '#6d28d9', '#d6336c', '#0f766e', '#1c1410'];
const HOME_OPTS: { value: Mode; label: string }[] = [{ value: 'vender', label: '🛒 Vender' }, { value: 'cocina', label: '🔥 Cocina' }, { value: 'despacho', label: '🛵 Despacho' }, { value: 'caja', label: '💰 Caja' }];

function Equipo() {
  const people = usePeople();
  const [edit, setEdit] = useState<Person | null>(null);
  const [pay, setPay] = useState<{ p?: Person; mode: 'nomina' | 'adelanto' } | null>(null);
  return (
    <>
      <div className="callout info" style={{ margin: '0 16px 12px' }}>En el trailer todos pueden usar todas las vistas. Aquí solo defines con cuál arranca cada uno y quién ve el dinero.</div>
      <div className="card">
        {people.map((p) => (
          <div key={p.id} className="li">
            <Avatar p={p} size={44} />
            <button className="li-main" style={{ textAlign: 'left' }} onClick={() => setEdit(p)}>
              <div className="li-title">{p.name} {p.owner && <span className="tag" style={{ height: 20, fontSize: 11 }}>Dueña</span>}</div>
              <div className="li-sub">Arranca en {HOME_OPTS.find((h) => h.value === p.home)?.label ?? '🛒 Vender'}{p.dailyRate ? ` · ${money(p.dailyRate)}/día` : ''}{p.pinHash ? ' · 🔒' : ''}</div>
            </button>
            <button className="chip sm" onClick={() => setPay({ p, mode: 'nomina' })}>Pagar</button>
          </div>
        ))}
      </div>
      <div className="pad-x stack" style={{ gap: 8 }}>
        <button className="btn btn-go btn-block" onClick={() => setEdit({ id: '', name: '', owner: false, home: 'vender', color: COLORS[people.length % COLORS.length], emoji: EMOJIS[people.length % EMOJIS.length], active: true, createdAt: Date.now() })}>＋ Agregar persona</button>
        <div className="row"><button className="btn btn-soft grow" onClick={() => setPay({ mode: 'nomina' })}>👥 Pagar nómina</button><button className="btn btn-soft grow" onClick={() => setPay({ mode: 'adelanto' })}>🤝 Adelanto</button></div>
      </div>
      <PersonSheet person={edit} onClose={() => setEdit(null)} />
      <PayrollSheet open={!!pay} mode={pay?.mode ?? 'nomina'} person={pay?.p} onClose={() => setPay(null)} />
    </>
  );
}

export function PersonSheet({ person, onClose, onSaved }: { person: Person | null; onClose: () => void; onSaved?: (p: Person) => void }) {
  const [d, setD] = useState<Person | null>(null);
  const [pinStep, setPinStep] = useState(false);
  useEffect(() => { setD(person); setPinStep(false); }, [person]);
  if (!d) return <Sheet open={false} onClose={onClose}><span /></Sheet>;
  const set = (p: Partial<Person>) => setD({ ...d, ...p });
  const isNew = !d.id;
  return (
    <Sheet open={!!person} onClose={onClose} full title={isNew ? 'Nueva persona' : d.name} footer={!pinStep && <button className="btn btn-go btn-block btn-xl" disabled={!d.name.trim()} onClick={async () => { const saved = await save('people', { ...d, id: d.id || uid(), name: d.name.trim() }); haptic.success(); toast(`${saved.emoji} ${saved.name} guardado`); onSaved?.(saved); onClose(); }}>Guardar</button>}>
      {pinStep ? (
        <PinPad title="Nuevo PIN" sub="4 números. Protege su perfil." onCancel={() => setPinStep(false)} onDone={async (pin) => { set({ pinHash: await hashPin(pin) }); setPinStep(false); toast('PIN listo'); }} />
      ) : (
        <>
          <div className="center" style={{ margin: '4px 0 16px', display: 'grid', justifyItems: 'center' }}><Avatar p={d} size={88} /></div>
          <Field label="Nombre"><input className="input" autoFocus={isNew} placeholder="Ej: Martha" value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Su ícono"><div className="emoji-pick">{EMOJIS.map((e) => <button key={e} className={d.emoji === e ? 'on' : ''} onClick={() => set({ emoji: e })}>{e}</button>)}</div></Field>
          <Field label="Su color"><div className="color-pick">{COLORS.map((c) => <button key={c} className={d.color === c ? 'on' : ''} style={{ ['--c' as string]: c }} onClick={() => set({ color: c })} />)}</div></Field>
          <Field label="¿Con qué vista arranca?" hint="Puede cambiar de vista cuando quiera con un toque."><Chips value={HOME_OPTS.find((h) => h.value === d.home)?.label} options={HOME_OPTS.map((h) => h.label)} onChange={(l) => set({ home: HOME_OPTS.find((h) => h.label === l)!.value })} /></Field>
          <Field label="¿Ve el dinero del negocio?" hint="Panel, nómina, carta y ajustes."><Seg<'s' | 'n'> value={d.owner ? 's' : 'n'} onChange={(v) => set({ owner: v === 's' })} options={[{ value: 'n', label: 'No' }, { value: 's', label: 'Sí (dueña)' }]} /></Field>
          <Field label="Pago por día (nómina)"><Money value={d.dailyRate ?? 0} onChange={(n) => set({ dailyRate: n })} /></Field>
          <Field label="PIN"><div className="row"><button className="btn btn-soft grow" onClick={() => setPinStep(true)}>{d.pinHash ? '🔒 Cambiar PIN' : '🔓 Poner PIN'}</button>{d.pinHash && <button className="btn btn-ghost-danger" onClick={() => set({ pinHash: undefined })}>Quitar</button>}</div></Field>
          {!isNew && <button className="btn btn-ghost-danger btn-block" onClick={async () => { await save('people', { ...d, active: false }); toast(`${d.name} ya no aparece`, 'warn'); onClose(); }}>Ya no trabaja aquí</button>}
        </>
      )}
    </Sheet>
  );
}

// ======================= Carta =======================
function Carta() {
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const [edit, setEdit] = useState<Product | null>(null);
  const cats = [...new Set([...CATEGORY_ORDER, ...products.map((p) => p.category)])];
  return (
    <>
      {cats.map((c) => {
        const list = products.filter((p) => p.category === c && !p.deleted).sort((a, b) => a.sort - b.sort);
        if (!list.length) return null;
        return (
          <div key={c}>
            <div className="sec"><h3>{CATEGORY_EMOJI[c] ?? '🍽️'} {c}</h3><span>{list.length}</span></div>
            <div className="card">
              {list.map((p) => (
                <div key={p.id} className="li" style={{ opacity: p.active ? 1 : 0.45 }}>
                  <div className="li-ico">{p.emoji}</div>
                  <button className="li-main" style={{ textAlign: 'left' }} onClick={() => setEdit(p)}><div className="li-title">{p.short ?? p.name}</div><div className="li-sub">{money(p.price)}{p.active ? '' : ' · oculto'}</div></button>
                  <button className="chip sm" style={p.soldOut ? { background: 'var(--aji)', color: '#fff' } : { background: 'var(--aguacate-soft)', color: 'var(--aguacate)' }} onClick={async () => { haptic.tap(); await save('products', { ...p, soldOut: !p.soldOut }); }}>{p.soldOut ? 'Agotado' : 'Hay'}</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="pad-x"><button className="btn btn-go btn-block" onClick={() => setEdit({ id: '', name: '', short: '', category: 'Sándwich', price: 0, description: '', sort: products.length, active: true, soldOut: false, emoji: '🥪' })}>＋ Producto nuevo (bebidas, adiciones…)</button></div>
      <ProductSheet product={edit} cats={[...cats, 'Bebidas'].filter((v, i, a) => a.indexOf(v) === i)} onClose={() => setEdit(null)} />
    </>
  );
}

function ProductSheet({ product, cats, onClose }: { product: Product | null; cats: string[]; onClose: () => void }) {
  const [d, setD] = useState<Product | null>(null);
  useEffect(() => setD(product), [product]);
  if (!d) return <Sheet open={false} onClose={onClose}><span /></Sheet>;
  const set = (p: Partial<Product>) => setD({ ...d, ...p });
  return (
    <Sheet open={!!product} onClose={onClose} full title={d.id ? 'Editar producto' : 'Producto nuevo'} footer={<button className="btn btn-go btn-block btn-xl" disabled={!(d.short || d.name).trim() || !d.price} onClick={async () => {
      const short = (d.short || d.name).trim();
      const name = d.name.trim() || (['Especial', 'Combo', 'Bebidas'].includes(d.category) ? short : `${d.category} ${short.charAt(0).toLowerCase()}${short.slice(1)}`);
      await save('products', { ...d, id: d.id || uid(), short, name });
      haptic.success(); toast('Carta actualizada'); onClose();
    }}>Guardar</button>}>
      <Field label="Nombre en la carta"><input className="input" value={d.short ?? ''} placeholder="Ej: Mixto" onChange={(e) => set({ short: e.target.value })} /></Field>
      <Field label="Nombre para cocina" hint="Así lo ve la cocina y el cliente. Vacío = se arma solo."><input className="input" value={d.name} placeholder="Ej: Sándwich mixto" onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Precio"><Money value={d.price} onChange={(price) => set({ price })} /></Field>
      <Field label="Categoría"><Chips value={d.category} options={cats} onChange={(category) => set({ category, emoji: d.id ? d.emoji : CATEGORY_EMOJI[category] ?? d.emoji })} /></Field>
      <Field label="Ícono"><input className="input" value={d.emoji ?? ''} maxLength={4} onChange={(e) => set({ emoji: e.target.value })} style={{ fontSize: 26, width: 90 }} /></Field>
      <Field label="Ingredientes"><textarea className="input" rows={3} value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="¿Aparece en la carta?"><Seg<'s' | 'n'> value={d.active ? 's' : 'n'} onChange={(v) => set({ active: v === 's' })} options={[{ value: 's', label: 'Sí' }, { value: 'n', label: 'Oculto' }]} /></Field>
    </Sheet>
  );
}

// ======================= Ajustes, dispositivos y link =======================
function Ajustes() {
  const biz = useBusiness();
  const st = useSync();
  const devices = useLiveQuery(() => db.devices.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const [pair, setPair] = useState(false);
  const [acc, setAcc] = useState('');
  const [relays, setRelays] = useState(false);
  const okRelays = st.relays.filter((r) => r.ok).length;

  const shareMenu = async () => {
    if (!biz.whatsapp) return toast('Primero escribe el WhatsApp del negocio', 'warn');
    const url = await buildMenuLink(PUBLIC_BASE, biz.name, biz.whatsapp, biz.defaultDeliveryFee, products);
    await shareText(`🥪 Pide en ${biz.name} desde aquí, sin escribir tanto:\n${url}`);
  };

  return (
    <>
      <div className="sec"><h3>🔗 Teléfonos conectados</h3><span>{okRelays}/{st.relays.length} rutas activas</span></div>
      <div className="card">
        {devices.filter((d) => !d.deleted).sort((a, b) => b.lastSeen - a.lastSeen).map((d) => (
          <div key={d.id} className="li"><div className="li-ico">{/iphone|ipad/i.test(d.name) ? '📱' : '🤖'}</div><div className="li-main"><div className="li-title">{d.name}</div><div className="li-sub">Visto hace {elapsedLabel(d.lastSeen)}</div></div><span className={`sync-dot ${Date.now() - d.lastSeen < 15 * 60000 ? 'on' : ''}`} /></div>
        ))}
        <button className="li" onClick={() => setPair(true)}><div className="li-ico">➕</div><div className="li-main"><div className="li-title">Conectar otro teléfono</div><div className="li-sub">Muestra un QR para el iPhone de la cocina, del repartidor…</div></div><span className="li-chev">›</span></button>
      </div>
      <div className="callout ok" style={{ margin: '0 16px 10px' }}>🔐 Todo viaja cifrado de extremo a extremo. Cada teléfono guarda una copia completa y funciona sin internet. {st.pending ? `Hay ${st.pending} cambios esperando señal.` : 'Todo sincronizado.'}</div>

      <div className="sec"><h3>🛒 Link de pedidos para clientes</h3></div>
      <div className="card pad">
        <Field label="WhatsApp del negocio" hint="Al número que llegan los pedidos del link."><input className="input" inputMode="tel" placeholder="300 123 4567" defaultValue={biz.whatsapp} onBlur={(e) => saveBusiness({ whatsapp: e.target.value.replace(/\D/g, '') })} /></Field>
        <button className="btn btn-wa btn-block" onClick={shareMenu}>Compartir link del menú</button>
        <div className="hint" style={{ marginTop: 8 }}>Ponlo en el mensaje de bienvenida de WhatsApp Business. El cliente arma su pedido y te llega un mensaje que Prenzao lee exacto.</div>
      </div>

      <div className="sec"><h3>⚙️ Operación</h3></div>
      <div className="card pad">
        <Field label="Nombre del negocio"><input className="input" defaultValue={biz.name} onBlur={(e) => e.target.value.trim() && saveBusiness({ name: e.target.value.trim() })} /></Field>
        <Field label="Meta de ventas del día" hint="Se ve como un anillo y se celebra al 50% y al 100%."><Money value={biz.dailyGoal} onChange={(n) => saveBusiness({ dailyGoal: n })} /></Field>
        <Field label="Base de caja (con cuánto se abre)"><Money value={biz.cashBase} onChange={(n) => saveBusiness({ cashBase: n })} /></Field>
        <Field label="Domicilio por defecto"><Money value={biz.defaultDeliveryFee} onChange={(n) => saveBusiness({ defaultDeliveryFee: n })} /></Field>
        <Field label="Tiempo objetivo de cocina"><Seg<string> value={String(biz.prepTargetMin)} onChange={(v) => saveBusiness({ prepTargetMin: Number(v) })} options={['6', '8', '10', '12', '15'].map((v) => ({ value: v, label: `${v} min` }))} /></Field>
        <Field label="Insistir con cobros pendientes cada"><Seg<string> value={String(biz.reminderMinutes)} onChange={(v) => saveBusiness({ reminderMinutes: Number(v) })} options={['3', '5', '10', '15'].map((v) => ({ value: v, label: `${v} min` }))} /></Field>
        <Field label="El día cambia a las" hint="Lo vendido después de medianoche cuenta para el día anterior."><Seg<string> value={String(biz.dayCutoffHour)} onChange={(v) => saveBusiness({ dayCutoffHour: Number(v) })} options={['0', '2', '4', '6'].map((v) => ({ value: v, label: `${v}:00` }))} /></Field>
      </div>

      <div className="sec"><h3>📲 Cuentas para transferencias</h3></div>
      <div className="card pad">
        <div className="chips" style={{ marginBottom: 10 }}>{biz.transferAccounts.map((a) => <button key={a} className="chip on" onClick={() => saveBusiness({ transferAccounts: biz.transferAccounts.filter((x) => x !== a) })}>{a} ✕</button>)}</div>
        <div className="row"><input className="input" placeholder="Ej: Nequi 300…" value={acc} onChange={(e) => setAcc(e.target.value)} /><button className="btn btn-ink" disabled={!acc.trim()} onClick={() => { saveBusiness({ transferAccounts: [...biz.transferAccounts, acc.trim()] }); setAcc(''); }}>＋</button></div>
      </div>

      <div className="sec"><h3>💾 Datos</h3></div>
      <div className="card">
        <button className="li" onClick={exportSalesCSV}><div className="li-ico">📈</div><div className="li-main"><div className="li-title">Ventas a Excel</div></div><span className="li-chev">›</span></button>
        <button className="li" onClick={exportExpensesCSV}><div className="li-ico">🧾</div><div className="li-main"><div className="li-title">Gastos a Excel</div></div><span className="li-chev">›</span></button>
        <button className="li" onClick={exportBackup}><div className="li-ico">🗄️</div><div className="li-main"><div className="li-title">Respaldo completo</div><div className="li-sub">Copia extra por si se pierden todos los teléfonos</div></div><span className="li-chev">›</span></button>
        <label className="li"><div className="li-ico">♻️</div><div className="li-main"><div className="li-title">Restaurar respaldo</div></div><span className="li-chev">›</span><input type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { toast(`Restaurados ${await importBackup(f)} registros`); } catch (err) { toast(String((err as Error).message), 'warn'); } }} /></label>
        <button className="li" onClick={() => setRelays(true)}><div className="li-ico">🛰️</div><div className="li-main"><div className="li-title">Rutas de sincronización</div><div className="li-sub">Avanzado · usar servidor propio</div></div><span className="li-chev">›</span></button>
      </div>
      <PairSheet open={pair} onClose={() => setPair(false)} />
      <RelaySheet open={relays} onClose={() => setRelays(false)} />
    </>
  );
}

function PairSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!open) return;
    sync.pairCode().then(async (c) => {
      if (!c) return;
      setCode(c);
      setQr(await QRCode.toDataURL(c, { margin: 1, width: 460, color: { dark: '#1c1410', light: '#ffffff' } }));
    });
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Conectar un teléfono" sub="En el otro teléfono: abre Prenzao → Unirme → escanea">
      <div className="qr-box">{qr ? <img src={qr} alt="QR de vinculación" /> : <div style={{ height: 230 }} />}</div>
      <div className="callout warn" style={{ marginTop: 14 }}>🔑 Este QR es la llave del negocio. Muéstralo solo a teléfonos del equipo.</div>
      <button className="btn btn-soft btn-block" onClick={() => shareText(`Código para conectar Prenzao:\n${code}`)}>Enviar código por WhatsApp (si no puede escanear)</button>
    </Sheet>
  );
}

function RelaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useSync();
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(sync.relays().join('\n')); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} full title="Rutas de sincronización" footer={<button className="btn btn-go btn-block btn-xl" onClick={async () => { await sync.setRelays(text.split(/\s+/).filter((u) => /^wss?:\/\//.test(u))); toast('Rutas actualizadas'); onClose(); }}>Guardar</button>}>
      <div className="callout info">Son relays Nostr: solo ven texto cifrado. Si montas tu propio servidor (carpeta <b>relay/</b> del repo, corre en Termux), agrégalo aquí y en todos los teléfonos.</div>
      <div className="card" style={{ margin: '0 0 14px' }}>{st.relays.map((r) => <div key={r.url} className="li"><span className={`sync-dot ${r.ok ? 'on' : 'off'}`} /><div className="li-main"><div className="li-title" style={{ fontSize: 14 }}>{r.url.replace('wss://', '')}</div></div></div>)}</div>
      <Field label="Una ruta por línea"><textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} style={{ fontSize: 14, fontFamily: 'monospace' }} /></Field>
      <Empty icon="🛰️" title={`${st.relays.filter((r) => r.ok).length} de ${st.relays.length} conectadas`} />
    </Sheet>
  );
}
