import { db, getBusiness, getDevice, patch, save, uid } from './db';
import { dayKeyOf, money, onlyDigits } from './format';
import { cancelPayReminders, schedulePayReminders } from './platform';
import type { Channel, Customer, Order, OrderItem, OrderStatus, PayMethod, PayStatus } from './types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  preparando: 'En cocina',
  listo: 'Listo',
  enviado: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export function nextStatus(o: Pick<Order, 'status' | 'channel'>): OrderStatus | null {
  switch (o.status) {
    case 'preparando':
      return 'listo';
    case 'listo':
      return o.channel === 'domicilio' ? 'enviado' : 'entregado';
    case 'enviado':
      return 'entregado';
    default:
      return null;
  }
}

export const NEXT_LABEL: Record<string, string> = {
  listo: '¡Listo!',
  enviado: 'Salió 🛵',
  entregado: 'Entregado',
};

async function actor() {
  const d = await getDevice();
  return { by: d.personId, device: d.deviceId };
}

export interface NewOrder {
  channel: Channel;
  items: OrderItem[];
  deliveryFee?: number;
  payStatus: PayStatus;
  payMethod?: PayMethod;
  payAccount?: string;
  cashReceived?: number;
  customer?: Order['customer'];
  source?: Order['source'];
  note?: string;
}

export async function createOrder(input: NewOrder): Promise<Order> {
  const biz = await getBusiness();
  const { by, device } = await actor();
  const now = Date.now();
  const dayKey = dayKeyOf(now, biz.dayCutoffHour);
  const subtotal = input.items.reduce((a, i) => a + i.price * i.qty, 0);
  const fee = input.channel === 'domicilio' ? input.deliveryFee ?? 0 : 0;
  const today = await db.orders.where('dayKey').equals(dayKey).toArray();
  const number = today.reduce((m, o) => Math.max(m, o.number), 0) + 1;
  const o: Order = {
    id: uid(),
    number,
    dayKey,
    createdAt: now,
    updatedAt: now,
    createdBy: by,
    device,
    channel: input.channel,
    status: 'preparando',
    statusAt: now,
    items: input.items,
    subtotal,
    deliveryFee: fee,
    total: subtotal + fee,
    payStatus: input.payStatus,
    payMethod: input.payMethod,
    payAccount: input.payAccount,
    cashReceived: input.cashReceived,
    paidAt: input.payStatus === 'pagado' ? now : undefined,
    customer: input.customer,
    source: input.source ?? 'caja',
    note: input.note,
    log: [{ status: 'preparando', at: now, by }],
  };
  if (o.payStatus === 'pagado') o.log.push({ status: 'pago', at: now, by, detail: payDetail(o) });
  await save('orders', o);
  if (o.customer?.phone) await rememberCustomer(o);
  if (o.payStatus === 'pendiente') {
    schedulePayReminders(o.id, `💰 Cobro pendiente · #${o.number}`, `${money(o.total)} sin confirmar. Toca para cobrar.`, biz.reminderMinutes);
  }
  return o;
}

export function payDetail(o: Pick<Order, 'payMethod' | 'payAccount'>) {
  if (o.payMethod === 'transferencia') return `Transferencia${o.payAccount ? ' · ' + o.payAccount : ''}`;
  if (o.payMethod === 'efectivo') return 'Efectivo';
  return '';
}

export async function advanceOrder(id: string, to?: OrderStatus) {
  const o = await db.orders.get(id);
  if (!o) return;
  const target = to ?? nextStatus(o);
  if (!target || o.status === target) return;
  const { by } = await actor();
  const now = Date.now();
  await patch<Order>('orders', id, { status: target, statusAt: now, updatedAt: now, lastNudgeAt: undefined, log: [...o.log, { status: target, at: now, by }] });
}

export async function markPaid(id: string, method: PayMethod, account?: string, cashReceived?: number) {
  const o = await db.orders.get(id);
  if (!o) return;
  const { by } = await actor();
  const now = Date.now();
  const p = { payStatus: 'pagado' as const, payMethod: method, payAccount: account, cashReceived, paidAt: now };
  await patch<Order>('orders', id, { ...p, updatedAt: now, lastNudgeAt: undefined, log: [...o.log, { status: 'pago', at: now, by, detail: payDetail(p) }] });
  cancelPayReminders(id);
}

export async function cancelOrder(id: string, reason: string) {
  const o = await db.orders.get(id);
  if (!o) return;
  const { by } = await actor();
  const now = Date.now();
  await patch<Order>('orders', id, { status: 'cancelado', statusAt: now, updatedAt: now, cancelReason: reason, log: [...o.log, { status: 'cancelado', at: now, by, detail: reason }] });
  cancelPayReminders(id);
}

export async function snoozeOrder(id: string) {
  // solo local: no hace falta sincronizar el "aún no"
  await db.orders.update(id, { lastNudgeAt: Date.now() });
}

async function rememberCustomer(o: Order) {
  const phone = onlyDigits(o.customer?.phone ?? '');
  if (phone.length < 7) return;
  const cur = await db.customers.get(phone);
  const c: Customer = {
    ...(cur ?? { orders: 0, spent: 0 }),
    id: phone,
    phone,
    name: o.customer?.name || cur?.name,
    address: o.customer?.address || cur?.address,
    orders: (cur?.orders ?? 0) + 1,
    spent: (cur?.spent ?? 0) + o.total,
    lastAt: o.createdAt,
  };
  await save('customers', c);
}

export function itemsSummary(items: OrderItem[]): string {
  return items.map((i) => `${i.qty}× ${i.name}`).join(' · ');
}

export function itemCount(items: OrderItem[]) {
  return items.reduce((a, i) => a + i.qty, 0);
}

/** Texto para el cliente según el estado del pedido. */
export function customerMessage(o: Order, business = 'Prenzao'): string {
  const name = o.customer?.name ? ` ${o.customer.name.split(' ')[0]}` : '';
  const lines = o.items.map((i) => `• ${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`).join('\n');
  const fee = o.deliveryFee ? `\nDomicilio: ${money(o.deliveryFee)}` : '';
  const pay = o.payStatus === 'pagado' ? `✅ Pago recibido (${money(o.total)})` : `Total: *${money(o.total)}*${o.payMethod ? ` · ${o.payMethod === 'transferencia' ? 'transferencia' : 'efectivo'}` : ''}`;
  const head: Record<OrderStatus, string> = {
    preparando: `¡Hola${name}! 🙌 Confirmamos tu pedido *#${o.number}* en ${business} y ya está en la plancha 🔥`,
    listo: `¡Hola${name}! Tu pedido *#${o.number}* de ${business} ya está listo 😋`,
    enviado: `¡Hola${name}! Tu pedido *#${o.number}* de ${business} va en camino 🛵💨`,
    entregado: `¡Gracias${name}! Tu pedido *#${o.number}* fue entregado. ¡Buen provecho! 🧡`,
    cancelado: `Hola${name}, tu pedido *#${o.number}* de ${business} fue cancelado.`,
  };
  const addr = o.channel === 'domicilio' && o.customer?.address && o.status === 'preparando' ? `\n📍 ${o.customer.address}` : '';
  return `${head[o.status]}\n\n${lines}${fee}\n${pay}${addr}`;
}
