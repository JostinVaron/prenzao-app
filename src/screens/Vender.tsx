import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bike, Check, ChevronRight, Minus, Plus, Store, StickyNote, MessageCircle, Search, X } from 'lucide-react';
import { db } from '../lib/db';
import { CATEGORY_ORDER } from '../data/menu';
import { money, onlyDigits, plural } from '../lib/format';
import { createOrder, whatsappStatusText } from '../lib/orders';
import { haptic, openWhatsApp } from '../lib/platform';
import { useSettings } from '../lib/hooks';
import type { Channel, Order, OrderItem, PayMethod, PayStatus, Product } from '../lib/types';
import { Chips, Field, MoneyInput, Segmented, Sheet, toast } from '../components/ui';

export const CAT_COLOR: Record<string, string> = {
  Prenzao: '#F25C05',
  'Sándwich': '#D99A00',
  Hamburguesa: '#B4461B',
  'Hot Dog': '#E0352B',
  'Patacón': '#4E9A1B',
  Especial: '#7A4FE0',
};

export interface CartState {
  channel: Channel;
  items: OrderItem[];
}

const QUICK_NOTES = ['Sin cebolla', 'Sin salsas', 'Sin lechuga', 'Sin tomate', 'Salsas aparte', 'Para llevar'];

export function Vender({ cart, setCart }: { cart: CartState; setCart: (c: CartState) => void }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []) ?? [];
  const [cat, setCat] = useState<string>('Todo');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [done, setDone] = useState<Order | null>(null);

  const cats = useMemo(() => {
    const present = new Set(products.filter((p) => p.active).map((p) => p.category));
    return ['Todo', ...CATEGORY_ORDER.filter((c) => present.has(c)), ...[...present].filter((c) => !CATEGORY_ORDER.includes(c))];
  }, [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => p.active)
      .filter((p) => (cat === 'Todo' ? true : p.category === cat))
      .filter((p) => (q ? (p.name + ' ' + p.description).toLowerCase().includes(q) : true))
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.sort - b.sort);
  }, [products, cat, query]);

  const qtyOf = (id: string) => cart.items.filter((i) => i.productId === id).reduce((a, i) => a + i.qty, 0);
  const count = cart.items.reduce((a, i) => a + i.qty, 0);
  const subtotal = cart.items.reduce((a, i) => a + i.qty * i.price, 0);

  const add = (p: Product) => {
    if (p.soldOut) return;
    haptic.tap();
    const idx = cart.items.findIndex((i) => i.productId === p.id && !i.note);
    const items = [...cart.items];
    if (idx >= 0) items[idx] = { ...items[idx], qty: items[idx].qty + 1 };
    else items.push({ productId: p.id, name: p.name, price: p.price, qty: 1 });
    setCart({ ...cart, items });
  };
  const removeOne = (p: Product) => {
    haptic.tap();
    const items = [...cart.items];
    // quita primero de la línea sin nota, si no de la última
    let idx = items.findIndex((i) => i.productId === p.id && !i.note);
    if (idx < 0) idx = items.map((i) => i.productId).lastIndexOf(p.id);
    if (idx < 0) return;
    if (items[idx].qty > 1) items[idx] = { ...items[idx], qty: items[idx].qty - 1 };
    else items.splice(idx, 1);
    setCart({ ...cart, items });
  };

  return (
    <div className="screen">
      <header className="large-head">
        <div className="large-head-row">
          <div>
            <div className="eyebrow">Nueva venta</div>
            <h1 className="large-title">Vender</h1>
          </div>
          <button className={`icon-btn round ${searching ? 'on' : ''}`} aria-label="Buscar" onClick={() => { setSearching(!searching); setQuery(''); }}>
            {searching ? <X size={18} /> : <Search size={18} />}
          </button>
        </div>
        <Segmented<Channel>
          size="lg"
          value={cart.channel}
          onChange={(channel) => setCart({ ...cart, channel })}
          options={[
            { value: 'mostrador', label: <span className="seg-ico"><Store size={16} /> Mostrador</span> },
            { value: 'domicilio', label: <span className="seg-ico"><Bike size={16} /> Domicilio</span> },
          ]}
        />
        {searching && (
          <input className="input search" autoFocus placeholder="Buscar producto o ingrediente…" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </header>

      <div className="cat-bar">
        {cats.map((c) => (
          <button
            key={c}
            className={`cat-chip ${cat === c ? 'on' : ''}`}
            style={c !== 'Todo' ? { ['--c' as string]: CAT_COLOR[c] ?? '#8E8E93' } : undefined}
            onClick={() => { haptic.tap(); setCat(c); }}
          >
            {c !== 'Todo' && <i className="dot" />}
            {c}
          </button>
        ))}
      </div>

      <div className="product-grid">
        {visible.map((p) => {
          const q = qtyOf(p.id);
          return (
            <div key={p.id} className={`product ${q ? 'in-cart' : ''} ${p.soldOut ? 'sold-out' : ''}`} style={{ ['--c' as string]: CAT_COLOR[p.category] ?? '#8E8E93' }}>
              <button className="product-hit" onClick={() => add(p)} disabled={p.soldOut} aria-label={`Agregar ${p.name}`}>
                <span className="product-cat"><i className="dot" />{p.category}</span>
                <span className="product-name">{p.name}</span>
                <span className="product-desc">{p.description}</span>
                <span className="product-price">{p.soldOut ? 'Agotado' : money(p.price)}</span>
              </button>
              {q > 0 && (
                <div className="product-qty">
                  <button aria-label="Quitar uno" onClick={() => removeOne(p)}><Minus size={16} strokeWidth={2.6} /></button>
                  <span>{q}</span>
                  <button aria-label="Agregar uno" onClick={() => add(p)}><Plus size={16} strokeWidth={2.6} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {count > 0 && (
        <button className="cart-bar" onClick={() => { haptic.tap(); setCheckout(true); }}>
          <span className="cart-count">{count}</span>
          <span className="cart-label">{cart.channel === 'domicilio' ? 'Domicilio' : 'Mostrador'} · {plural(count, 'producto', 'productos')}</span>
          <span className="cart-total">{money(subtotal)}</span>
          <ChevronRight size={20} />
        </button>
      )}

      <Checkout
        open={checkout}
        cart={cart}
        setCart={setCart}
        onClose={() => setCheckout(false)}
        onDone={(o) => {
          setCheckout(false);
          setCart({ channel: cart.channel, items: [] });
          setDone(o);
        }}
      />
      <DoneSheet order={done} onClose={() => setDone(null)} />
    </div>
  );
}

// ======================= Checkout (procedimiento guiado) =======================

function Checkout({
  open,
  cart,
  setCart,
  onClose,
  onDone,
}: {
  open: boolean;
  cart: CartState;
  setCart: (c: CartState) => void;
  onClose: () => void;
  onDone: (o: Order) => void;
}) {
  const s = useSettings();
  const isDom = cart.channel === 'domicilio';
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [fee, setFee] = useState<number | null>(null);
  const [method, setMethod] = useState<PayMethod>('efectivo');
  const [payStatus, setPayStatus] = useState<PayStatus | null>(null);
  const [account, setAccount] = useState<string | undefined>();
  const [received, setReceived] = useState(0);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const deliveryFee = isDom ? (fee ?? s.defaultDeliveryFee) : 0;
  const subtotal = cart.items.reduce((a, i) => a + i.qty * i.price, 0);
  const total = subtotal + deliveryFee;
  const status: PayStatus = payStatus ?? (isDom ? 'pendiente' : 'pagado');
  const change = method === 'efectivo' && status === 'pagado' && received > 0 ? received - total : null;

  const missing: string[] = [];
  if (cart.items.length === 0) missing.push('agrega productos');
  if (isDom && onlyDigits(phone).length < 7) missing.push('teléfono del cliente');
  if (isDom && address.trim().length < 4) missing.push('dirección');
  if (method === 'transferencia' && !account) missing.push('cuenta destino de la transferencia');
  if (method === 'efectivo' && status === 'pagado' && received > 0 && received < total) missing.push('el efectivo recibido no alcanza');

  const setQty = (idx: number, d: number) => {
    haptic.tap();
    const items = [...cart.items];
    const q = items[idx].qty + d;
    if (q <= 0) items.splice(idx, 1);
    else items[idx] = { ...items[idx], qty: q };
    setCart({ ...cart, items });
  };
  const setNote = (idx: number, note: string) => {
    const items = [...cart.items];
    items[idx] = { ...items[idx], note: note || undefined };
    setCart({ ...cart, items });
  };

  const reset = () => {
    setPhone(''); setName(''); setAddress(''); setUrgent(false); setFee(null);
    setMethod('efectivo'); setPayStatus(null); setAccount(undefined); setReceived(0);
  };

  const confirm = async () => {
    if (missing.length || saving) return;
    setSaving(true);
    try {
      const o = await createOrder({
        channel: cart.channel,
        items: cart.items,
        deliveryFee,
        payStatus: status,
        payMethod: method,
        payAccount: method === 'transferencia' ? account : undefined,
        cashReceived: method === 'efectivo' && status === 'pagado' && received ? received : undefined,
        customer: isDom || name ? { name: name.trim() || undefined, phone: onlyDigits(phone) || undefined, address: address.trim() || undefined, urgent } : undefined,
      });
      haptic.success();
      reset();
      onDone(o);
    } catch (e) {
      toast('No se pudo guardar el pedido', 'warn');
    } finally {
      setSaving(false);
    }
  };

  const bills = [total, 20000, 50000, 100000].filter((b, i, arr) => b >= total && arr.indexOf(b) === i);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      title={isDom ? 'Pedido a domicilio' : 'Pedido en mostrador'}
      subtitle={plural(cart.items.reduce((a, i) => a + i.qty, 0), 'producto', 'productos')}
      footer={
        <div className="checkout-foot">
          {missing.length > 0 && <div className="missing">Falta: {missing.join(', ')}</div>}
          <button className="btn btn-primary btn-block btn-xl" disabled={missing.length > 0 || saving} onClick={confirm}>
            <Check size={20} strokeWidth={2.6} /> Confirmar pedido · {money(total)}
          </button>
        </div>
      }
    >
      <div className="step"><span className="step-n">1</span>Revisa el pedido</div>
      <div className="group">
        {cart.items.map((it, idx) => (
          <div key={idx} className="line">
            <div className="line-main">
              <div className="line-name">{it.name}</div>
              {it.note ? (
                <button className="line-note on" onClick={() => setNoteFor(noteFor === idx ? null : idx)}><StickyNote size={13} /> {it.note}</button>
              ) : (
                <button className="line-note" onClick={() => setNoteFor(noteFor === idx ? null : idx)}><StickyNote size={13} /> Nota</button>
              )}
              {noteFor === idx && (
                <div className="note-editor">
                  <div className="chips">
                    {QUICK_NOTES.map((n) => (
                      <button key={n} className={`chip sm ${it.note === n ? 'on' : ''}`} onClick={() => { setNote(idx, it.note === n ? '' : n); setNoteFor(null); }}>{n}</button>
                    ))}
                  </div>
                  <input className="input sm" placeholder="Otra nota…" defaultValue={it.note ?? ''} onBlur={(e) => setNote(idx, e.target.value.trim())} />
                </div>
              )}
            </div>
            <div className="stepper">
              <button onClick={() => setQty(idx, -1)} aria-label="Menos"><Minus size={16} strokeWidth={2.6} /></button>
              <span>{it.qty}</span>
              <button onClick={() => setQty(idx, +1)} aria-label="Más"><Plus size={16} strokeWidth={2.6} /></button>
            </div>
            <div className="line-total">{money(it.qty * it.price)}</div>
          </div>
        ))}
      </div>

      <div className="step"><span className="step-n">2</span>{isDom ? 'Datos del cliente' : 'Cliente (opcional)'}</div>
      <div className="group pad">
        {isDom && (
          <Field label="Celular / WhatsApp *">
            <input className="input" inputMode="tel" placeholder="300 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        )}
        <Field label={isDom ? 'Nombre' : '¿A nombre de quién?'}>
          <input className="input" placeholder={isDom ? 'Nombre del cliente' : 'Para llamarlo cuando esté listo'} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {isDom && (
          <>
            <Field label="Dirección *">
              <input className="input" placeholder="Calle, número, barrio, indicaciones" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <div className="row-2">
              <Field label="Urgencia">
                <Segmented<'n' | 'u'> value={urgent ? 'u' : 'n'} onChange={(v) => setUrgent(v === 'u')} options={[{ value: 'n', label: 'Normal' }, { value: 'u', label: 'Urgente' }]} />
              </Field>
              <Field label="Valor domicilio">
                <MoneyInput value={deliveryFee} onChange={(n) => setFee(n)} />
              </Field>
            </div>
          </>
        )}
      </div>

      <div className="step"><span className="step-n">3</span>Pago</div>
      <div className="group pad">
        <Segmented<PayMethod>
          size="lg"
          value={method}
          onChange={(m) => { setMethod(m); setReceived(0); }}
          options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: '📲 Transferencia' }]}
        />
        {method === 'transferencia' && (
          <Field label="¿A qué cuenta? *">
            <Chips value={account} options={s.transferAccounts} onChange={setAccount} />
          </Field>
        )}
        <Field label={method === 'transferencia' ? '¿Ya verificaste que llegó la plata?' : '¿Ya pagó?'}>
          <Segmented<PayStatus>
            value={status}
            onChange={setPayStatus}
            options={[
              { value: 'pagado', label: method === 'transferencia' ? 'Sí, ya llegó' : 'Sí, pagó' },
              { value: 'pendiente', label: isDom ? 'Paga al recibir' : 'Aún no' },
            ]}
          />
        </Field>
        {status === 'pendiente' && (
          <div className="callout warn">La app va a insistir cada {s.reminderMinutes} min hasta que alguien confirme el pago.</div>
        )}
        {method === 'efectivo' && status === 'pagado' && (
          <Field label="¿Con cuánto paga?">
            <div className="bills">
              {bills.map((b) => (
                <button key={b} className={`chip ${received === b ? 'on' : ''}`} onClick={() => { haptic.tap(); setReceived(b); }}>
                  {b === total ? 'Exacto' : money(b)}
                </button>
              ))}
            </div>
            <MoneyInput value={received} onChange={setReceived} placeholder="Otro valor" />
            {change !== null && change >= 0 && (
              <div className="change">Cambio: <b>{money(change)}</b></div>
            )}
          </Field>
        )}
      </div>

      <div className="totals">
        <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {isDom && <div><span>Domicilio</span><span>{money(deliveryFee)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(total)}</span></div>
      </div>
    </Sheet>
  );
}

function DoneSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const s = useSettings();
  return (
    <Sheet open={!!order} onClose={onClose}>
      {order && (
        <div className="done">
          <div className="done-check"><Check size={40} strokeWidth={3} /></div>
          <div className="done-title">Pedido #{order.number}</div>
          <div className="done-sub">
            {money(order.total)} · {order.payStatus === 'pagado' ? `Pagado (${order.payMethod})` : 'Pago pendiente'}
          </div>
          {order.cashReceived && order.cashReceived > order.total ? (
            <div className="done-change">Entregar cambio: <b>{money(order.cashReceived - order.total)}</b></div>
          ) : null}
          {order.channel === 'domicilio' && order.customer?.phone && (
            <button className="btn btn-wa btn-block" onClick={() => openWhatsApp(order.customer!.phone!, whatsappStatusText(order, s.businessName))}>
              <MessageCircle size={18} /> Confirmar al cliente por WhatsApp
            </button>
          )}
          <button className="btn btn-plain btn-block" onClick={onClose}>Nueva venta</button>
        </div>
      )}
    </Sheet>
  );
}
