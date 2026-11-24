import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { money, onlyDigits } from '../lib/format';
import { createOrder, customerMessage } from '../lib/orders';
import { parseWhatsApp, type ParsedOrder } from '../lib/parser';
import { openWhatsApp } from '../lib/platform';
import { useBusiness } from '../lib/hooks';
import type { OrderItem, PayMethod } from '../lib/types';
import { Field, Seg, Sheet, Stepper, toast } from './kit';
import { celebrate } from './celebrate';
import type { CustomerDraft } from './order';

export async function readClipboard(): Promise<string | null> {
  try {
    const t = await navigator.clipboard.readText();
    return t?.trim() ? t : null;
  } catch {
    return null;
  }
}

/** Revisión del pedido que llegó por WhatsApp: la app ya entendió todo, la persona solo confirma. */
export function WhatsAppIntake({ text, onClose, onToCart }: { text: string | null; onClose: () => void; onToCart: (items: OrderItem[], c: CustomerDraft) => void }) {
  const biz = useBusiness();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const [parsed, setParsed] = useState<ParsedOrder | null>(null);
  const [items, setItems] = useState<ParsedOrder['items']>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!text || !products.length) return;
    const p = parseWhatsApp(text, products);
    setParsed(p);
    setItems(p.items);
    setName(p.customer.name ?? '');
    setPhone(p.customer.phone ?? '');
    setAddress(p.customer.address ?? '');
    setPay(p.payMethod ?? 'efectivo');
    // completar con lo que ya sabemos del cliente
    const d = onlyDigits(p.customer.phone ?? '');
    if (d.length >= 7) db.customers.get(d).then((c) => {
      if (!c) return;
      if (!p.customer.name && c.name) setName(c.name);
      if (!p.customer.address && c.address) setAddress(c.address);
    });
  }, [text, products.length]);

  const emoji = useMemo(() => new Map(products.map((p) => [p.id, p.emoji ?? '🍽️'])), [products]);
  const subtotal = items.reduce((a, i) => a + i.qty * i.price, 0);
  const fee = biz.defaultDeliveryFee;
  const total = subtotal + (address ? fee : 0);
  const draft = (): CustomerDraft => ({ phone, name, address, urgent: !!parsed?.customer.urgent, fee: null });

  const create = async () => {
    if (!items.length || saving) return;
    setSaving(true);
    const o = await createOrder({
      channel: address ? 'domicilio' : 'mostrador',
      items: items.map(({ sure, ...i }) => (void sure, i)),
      deliveryFee: fee,
      payStatus: 'pendiente',
      payMethod: pay,
      payAccount: pay === 'transferencia' ? parsed?.payAccount : undefined,
      cashReceived: parsed?.cashReceived,
      customer: { name: name || undefined, phone: onlyDigits(phone) || undefined, address: address || undefined, urgent: parsed?.customer.urgent },
      source: parsed?.structured ? 'link' : 'whatsapp',
    });
    setSaving(false);
    onClose();
    celebrate({
      title: `#${o.number}`,
      sub: `Pedido de ${name || 'WhatsApp'} en cocina · ${money(o.total)}`,
      stay: true,
      extra: (
        <button className="btn btn-wa btn-block btn-xl" onClick={() => openWhatsApp(o.customer?.phone, customerMessage(o, biz.name))}>
          💬 Confirmar al cliente
        </button>
      ),
    });
  };

  const unsure = items.some((i) => !i.sure);

  return (
    <Sheet
      open={!!text}
      onClose={onClose}
      full
      title="Pedido de WhatsApp"
      sub={parsed?.structured ? '✓ Pedido exacto desde el link del menú' : items.length ? `Entendí ${items.reduce((a, i) => a + i.qty, 0)} productos` : 'No encontré productos'}
      footer={
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn btn-go btn-block btn-xl" disabled={!items.length || saving} onClick={create}>✓ Mandar a cocina · {money(total)}</button>
          <button className="btn btn-soft btn-block" onClick={() => { onToCart(items.map(({ sure, ...i }) => (void sure, i)), draft()); onClose(); }}>Agregar o cambiar en la carta</button>
        </div>
      }
    >
      <div className="wa-raw">{parsed?.structured ? text?.replace(/PZO1:\S+/, '').trim() || 'Pedido del link' : text}</div>

      <div className="sec" style={{ padding: '18px 2px 6px' }}><h3>Esto entendí</h3>{unsure && <span style={{ color: '#8a5a00' }}>Revisa lo amarillo</span>}</div>
      <div className="card pad" style={{ margin: 0, paddingTop: 6, paddingBottom: 6 }}>
        {items.length === 0 && <div className="muted" style={{ padding: '10px 0' }}>Ningún producto reconocido. Toca "Agregar en la carta".</div>}
        {items.map((it, k) => (
          <div key={k} className={`parsed-line ${it.sure ? '' : 'unsure'}`} style={{ animationDelay: `${k * 60}ms` }}>
            <span className="e">{emoji.get(it.productId)}</span>
            <div className="grow">
              <div className="nm">{it.name}{!it.sure && ' ¿?'}</div>
              {it.note && <div className="nt">{it.note}</div>}
              <div className="muted" style={{ fontSize: 13, fontWeight: 650 }}>{money(it.price * it.qty)}</div>
            </div>
            <Stepper
              value={it.qty}
              onChange={(n) => setItems(n === 0 ? items.filter((_, j) => j !== k) : items.map((x, j) => (j === k ? { ...x, qty: n, sure: true } : x)))}
            />
          </div>
        ))}
      </div>

      <div className="sec" style={{ padding: '18px 2px 8px' }}><h3>Cliente</h3></div>
      <Field label="📍 Dirección"><textarea className="input" rows={2} value={address} placeholder="Si es para recoger, déjalo vacío" onChange={(e) => setAddress(e.target.value)} /></Field>
      <div className="row" style={{ gap: 10, alignItems: 'start' }}>
        <div className="grow"><Field label="👤 Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <div className="grow"><Field label="📞 Celular"><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
      </div>
      <Field label="💳 ¿Cómo va a pagar?" hint={parsed?.cashReceived ? `Dijo que paga con ${money(parsed.cashReceived)} → llevar ${money(parsed.cashReceived - total)} de cambio` : undefined}>
        <Seg<PayMethod> value={pay} onChange={setPay} options={[{ value: 'efectivo', label: '💵 Efectivo' }, { value: 'transferencia', label: `📲 ${parsed?.payAccount ?? 'Transferencia'}` }]} />
      </Field>
      {parsed?.customer.urgent && <div className="callout bad">⚡ El cliente dijo que es urgente.</div>}
    </Sheet>
  );
}

export function useClipboardPaste(onText: (t: string) => void) {
  return async () => {
    const t = await readClipboard();
    if (t) onText(t);
    else toast('Primero copia el mensaje del cliente en WhatsApp', 'warn');
  };
}
