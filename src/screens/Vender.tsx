import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { CATEGORY_COLOR, CATEGORY_ORDER } from '../data/menu';
import { money } from '../lib/format';
import { createOrder, customerMessage } from '../lib/orders';
import { haptic, openWhatsApp } from '../lib/platform';
import { sfx } from '../lib/sound';
import { useBusiness, useMe, useTodayKey, useTodayOrders, useTopProducts } from '../lib/hooks';
import type { Channel, OrderItem, Product } from '../lib/types';
import { Ring, Sheet, Stepper, toast } from '../ui/kit';
import { burst, celebrate } from '../ui/celebrate';
import { CashSheet, TransferSheet } from '../ui/pay';
import { CustomerSheet, emptyCustomer, type CustomerDraft } from '../ui/order';

export interface Cart {
  channel: Channel;
  items: OrderItem[];
  customer: CustomerDraft;
}
export const emptyCart = (channel: Channel = 'mostrador'): Cart => ({ channel, items: [], customer: emptyCustomer() });

const QUICK_NOTES = ['Sin cebolla', 'Sin salsas', 'Sin lechuga', 'Sin tomate', 'Salsas aparte', 'Bien tostado', 'Extra salsa de ajo'];

export function Vender({ cart, setCart, onPaste }: { cart: Cart; setCart: (c: Cart) => void; onPaste: () => void }) {
  const biz = useBusiness();
  const me = useMe();
  const day = useTodayKey();
  const today = useTodayOrders(day);
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const topIds = useTopProducts(8);
  const [cat, setCat] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<Product | null>(null);
  const [step, setStep] = useState<null | 'cash' | 'transfer' | 'customer'>(null);
  const [bump, setBump] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const active = products.filter((p) => p.active && !p.deleted);
  const cats = CATEGORY_ORDER.filter((c) => active.some((p) => p.category === c)).concat([...new Set(active.map((p) => p.category))].filter((c) => !CATEGORY_ORDER.includes(c)));
  const byCat = (c: string) => active.filter((p) => p.category === c).sort((a, b) => a.sort - b.sort);
  const top = topIds.map((id) => active.find((p) => p.id === id)).filter(Boolean) as Product[];
  const isDom = cart.channel === 'domicilio';

  const sales = today.filter((o) => o.status !== 'cancelado').reduce((a, o) => a + o.total, 0);
  const goal = biz.dailyGoal || 1;
  const progress = sales / goal;
  const nextNum = today.reduce((m, o) => Math.max(m, o.number), 0) + 1;

  const qty = (id: string) => cart.items.filter((i) => i.productId === id).reduce((a, i) => a + i.qty, 0);
  const count = cart.items.reduce((a, i) => a + i.qty, 0);
  const subtotal = cart.items.reduce((a, i) => a + i.qty * i.price, 0);
  const fee = isDom ? cart.customer.fee ?? biz.defaultDeliveryFee : 0;
  const total = subtotal + fee;

  // metas del día: celebrar 50% y 100% una sola vez
  useEffect(() => {
    if (!biz.dailyGoal) return;
    for (const m of [0.5, 1]) {
      const key = `goal:${day}:${m}`;
      if (progress >= m && !localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(() => celebrate({ title: m === 1 ? '¡Meta cumplida!' : '¡Mitad de la meta!', sub: `${money(sales)} vendidos hoy`, big: true, icon: m === 1 ? '🏆' : '🔥' }), 1600);
      }
    }
  }, [progress >= 0.5, progress >= 1]);

  const fly = (e: React.MouseEvent, emoji: string) => {
    const dock = dockRef.current?.getBoundingClientRect();
    const tx = dock ? dock.left + dock.width - 60 : window.innerWidth - 60;
    const ty = dock ? dock.top + 24 : window.innerHeight - 200;
    const el = document.createElement('div');
    el.className = 'fly';
    el.textContent = emoji;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    el.style.setProperty('--dx', `${tx - e.clientX}px`);
    el.style.setProperty('--dy', `${ty - e.clientY}px`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
  };

  const add = (p: Product, e?: React.MouseEvent, note?: string, n = 1) => {
    if (p.soldOut) return toast(`${p.name} está agotado`, 'warn');
    haptic.tap();
    sfx.pop(qty(p.id) + 1);
    if (e) fly(e, p.emoji ?? '🍽️');
    const items = [...cart.items];
    const i = items.findIndex((x) => x.productId === p.id && (x.note ?? '') === (note ?? ''));
    if (i >= 0) items[i] = { ...items[i], qty: items[i].qty + n };
    else items.push({ productId: p.id, name: p.name, price: p.price, qty: n, note });
    setCart({ ...cart, items });
    setBump(p.id);
    setTimeout(() => setBump(null), 320);
  };

  const removeOne = (productId: string, note?: string) => {
    haptic.tap();
    sfx.remove();
    const items = [...cart.items];
    let i = items.findIndex((x) => x.productId === productId && (note === undefined || (x.note ?? '') === (note ?? '')));
    if (i < 0) i = items.map((x) => x.productId).lastIndexOf(productId);
    if (i < 0) return;
    if (items[i].qty > 1) items[i] = { ...items[i], qty: items[i].qty - 1 };
    else items.splice(i, 1);
    setCart({ ...cart, items });
  };

  // pulsación larga → nota
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; long: boolean }>({ t: null, long: false });
  const tileHandlers = (p: Product) => ({
    onPointerDown: () => {
      press.current.long = false;
      press.current.t = setTimeout(() => {
        press.current.long = true;
        haptic.medium();
        setNoteFor(p);
      }, 480);
    },
    onPointerUp: () => press.current.t && clearTimeout(press.current.t),
    onPointerLeave: () => press.current.t && clearTimeout(press.current.t),
    onClick: (e: React.MouseEvent) => {
      if (press.current.long) return;
      add(p, e);
    },
  });

  const finish = async (payStatus: 'pagado' | 'pendiente', method?: 'efectivo' | 'transferencia', account?: string, received?: number) => {
    setStep(null);
    const c = cart.customer;
    const o = await createOrder({
      channel: cart.channel,
      items: cart.items,
      deliveryFee: fee,
      payStatus,
      payMethod: method,
      payAccount: account,
      cashReceived: received,
      customer: isDom || c.name ? { name: c.name || undefined, phone: c.phone.replace(/\D/g, '') || undefined, address: c.address || undefined, urgent: c.urgent || undefined } : undefined,
    });
    setCart(emptyCart(cart.channel));
    const change = received && received > o.total ? received - o.total : 0;
    celebrate({
      title: `#${o.number}`,
      sub: payStatus === 'pagado' ? `${money(o.total)} cobrado · ¡a la cocina! 🔥` : `En cocina · ${money(o.total)} por cobrar`,
      stay: isDom,
      extra: (
        <>
          {change > 0 && <div className="change-box"><div style={{ fontWeight: 750 }}>Devuelve</div><div className="v">{money(change)}</div></div>}
          {isDom && <button className="btn btn-wa btn-block btn-xl" onClick={() => openWhatsApp(o.customer?.phone, customerMessage(o, biz.name))}>💬 Confirmar al cliente</button>}
        </>
      ),
    });
    if (payStatus === 'pendiente' && !isDom) sfx.done();
  };

  const needCustomer = isDom && cart.customer.address.trim().length < 4;
  const go = (what: 'cash' | 'transfer' | 'later') => {
    haptic.medium();
    if (needCustomer) return setStep('customer');
    if (what === 'later' || (isDom && what === 'cash')) return finish('pendiente', isDom ? 'efectivo' : undefined);
    setStep(what);
  };

  // scroll-spy de categorías
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setCat((vis.target as HTMLElement).dataset.cat ?? null);
      },
      { rootMargin: '-140px 0px -60% 0px' },
    );
    document.querySelectorAll('.menu-sec').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [cats.join()]);

  const jump = (c: string) => {
    haptic.tap();
    setCat(c);
    document.getElementById(`sec-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }, []);

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="hello">
        <div className="grow">
          <div className="hello-title">{greeting}{me ? `, ${me.name.split(' ')[0]}` : ''} {me?.emoji ?? '👋'}</div>
          <div className="hello-sub">Siguiente pedido <b style={{ color: 'var(--ink)' }}>#{nextNum}</b> · hoy {money(sales)}</div>
        </div>
        {biz.dailyGoal > 0 && (
          <Ring value={progress} size={62} stroke={7} track="rgba(60,40,20,.1)">
            <span className="ring-lbl">{Math.min(999, Math.round(progress * 100))}%</span>
          </Ring>
        )}
      </div>

      <button className="wa-cta pressable" onClick={onPaste}>
        <span className="wa-cta-ico">💬</span>
        <span className="grow"><b>Pedido de WhatsApp</b><small>Copia el mensaje del cliente y toca aquí</small></span>
        <span style={{ fontSize: 20 }}>›</span>
      </button>

      {top.length >= 3 && (
        <>
          <div className="sec"><h3>Lo que más sale</h3><span>toca = agregar</span></div>
          <div className="top-row">
            {top.map((p, i) => (
              <button key={p.id} className={`top-tile ${qty(p.id) ? 'has' : ''}`} {...tileHandlers(p)}>
                <span className="rank">{i + 1}</span>
                <span className="emoji">{p.emoji}</span>
                <span className="t-name">{p.name}</span>
                <span className="t-price">{money(p.price)}</span>
                {qty(p.id) > 0 && <span className={`qty-badge ${bump === p.id ? 'bump' : ''}`} style={{ top: 'auto', bottom: 10 }}>{qty(p.id)}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="cats">
        {cats.map((c) => (
          <button key={c} className={`cat ${cat === c ? 'on' : ''}`} onClick={() => jump(c)}>
            <span className="e">{byCat(c)[0]?.emoji}</span>{c}
          </button>
        ))}
      </div>

      {cats.map((c) => (
        <section key={c} id={`sec-${c}`} className="menu-sec" data-cat={c}>
          <div className="menu-sec-title"><span>{byCat(c)[0]?.emoji}</span>{c}<i /></div>
          <div className="grid">
            {byCat(c).map((p) => {
              const q = qty(p.id);
              return (
                <button key={p.id} className={`tile ${q ? 'has' : ''} ${p.soldOut ? 'out' : ''}`} style={{ ['--c' as string]: CATEGORY_COLOR[p.category] ?? '#8c8178' }} {...tileHandlers(p)}>
                  {q > 0 && <span className={`qty-badge ${bump === p.id ? 'bump' : ''}`}>{q}</span>}
                  {q > 0 && <span className="minus" role="button" onClick={(e) => { e.stopPropagation(); removeOne(p.id); }}>−</span>}
                  <span className="emoji" style={q ? { marginLeft: 30 } : undefined}>{p.emoji}</span>
                  <span className="t-name">{p.short ?? p.name}</span>
                  <span className="t-price">{p.soldOut ? 'Agotado' : money(p.price)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="center muted" style={{ fontSize: 13, padding: '18px 30px 0' }}>Mantén presionado un producto para agregar una nota (sin cebolla, salsas aparte…)</p>

      {count > 0 && (
        <div className="dock" ref={dockRef}>
          <div className="dock-top">
            <div className="dock-items">
              {cart.items.map((i, k) => (
                <button key={k} className="dock-item" onClick={() => removeOne(i.productId, i.note ?? '')}>
                  <b>{i.qty}</b>{(products.find((p) => p.id === i.productId)?.short ?? i.name).slice(0, 18)}{i.note ? ' ✎' : ''}<span className="muted">✕</span>
                </button>
              ))}
            </div>
            <div className="dock-total">{money(total)}</div>
            <button className="dock-clear" aria-label="Vaciar" onClick={() => { sfx.remove(); setCart(emptyCart(cart.channel)); }}>🗑</button>
          </div>
          <div className={`chan ${isDom ? 'dom' : ''}`}>
            <div className="chan-thumb" />
            <button className={!isDom ? 'on' : ''} onClick={() => { haptic.tap(); setCart({ ...cart, channel: 'mostrador' }); }}>🏪 Aquí / llevar</button>
            <button className={isDom ? 'on' : ''} onClick={() => { haptic.tap(); setCart({ ...cart, channel: 'domicilio' }); }}>🛵 Domicilio</button>
          </div>
          {isDom && (
            <button className={`cust-row ${needCustomer ? 'missing' : ''}`} onClick={() => setStep('customer')}>
              <span style={{ fontSize: 18 }}>{needCustomer ? '📍' : '👤'}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {needCustomer ? 'Toca para poner la dirección' : `${cart.customer.name || 'Cliente'} · ${cart.customer.address}`}
              </span>
              <span>›</span>
            </button>
          )}
          <div className="pay-row">
            <button className="pay cash" onClick={() => go('cash')}><span className="e">💵</span>{isDom ? 'Paga al recibir' : 'Efectivo'}</button>
            <button className="pay transfer" onClick={() => go('transfer')}><span className="e">📲</span>Transferencia</button>
            {!isDom && <button className="pay later" onClick={() => go('later')}><span className="e">⏳</span>Luego</button>}
            {isDom && <button className="pay later" onClick={() => { if (needCustomer) return setStep('customer'); setStep('cash'); }}><span className="e">✓</span>Ya pagó</button>}
          </div>
        </div>
      )}

      <NoteSheet product={noteFor} onClose={() => setNoteFor(null)} onAdd={(p, note, n) => { add(p, undefined, note, n); setNoteFor(null); }} />
      <CashSheet open={step === 'cash'} total={total} onClose={() => setStep(null)} onPaid={(r) => finish('pagado', 'efectivo', undefined, r)} />
      <TransferSheet open={step === 'transfer'} total={total} onClose={() => setStep(null)} onDone={(acc, arrived) => finish(arrived ? 'pagado' : 'pendiente', 'transferencia', acc)} />
      <CustomerSheet
        open={step === 'customer'}
        value={cart.customer}
        onChange={(customer) => setCart({ ...cart, customer })}
        onClose={() => setStep(null)}
        onPasteWhatsApp={() => { setStep(null); onPaste(); }}
      />
    </div>
  );
}

function NoteSheet({ product, onClose, onAdd }: { product: Product | null; onClose: () => void; onAdd: (p: Product, note: string | undefined, n: number) => void }) {
  const [notes, setNotes] = useState<string[]>([]);
  const [free, setFree] = useState('');
  const [n, setN] = useState(1);
  useEffect(() => { if (product) { setNotes([]); setFree(''); setN(1); } }, [product?.id]);
  const note = [...notes, free.trim()].filter(Boolean).join(', ') || undefined;
  return (
    <Sheet open={!!product} onClose={onClose} title={product ? `${product.emoji} ${product.name}` : ''} sub={product?.description} footer={product && <button className="btn btn-go btn-block btn-xl" onClick={() => { burst('small'); onAdd(product, note, n); }}>Agregar {n} · {money(product.price * n)}</button>}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}><span className="label">¿Cuántos?</span><Stepper value={n} min={1} onChange={setN} /></div>
      <div className="label" style={{ marginBottom: 8 }}>Nota para la cocina</div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {QUICK_NOTES.map((q) => (
          <button key={q} className={`chip ${notes.includes(q) ? 'on' : ''}`} onClick={() => { haptic.tap(); setNotes(notes.includes(q) ? notes.filter((x) => x !== q) : [...notes, q]); }}>{q}</button>
        ))}
      </div>
      <input className="input" placeholder="Otra nota…" value={free} onChange={(e) => setFree(e.target.value)} />
    </Sheet>
  );
}
