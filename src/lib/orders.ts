import { db, getSettings, uid } from './db';
import { dayKeyOf, money } from './format';
import { cancelPayReminders, schedulePayReminders } from './platform';
import type { Channel, Customer, Order, OrderItem, OrderStatus, PayMethod, PayStatus } from './types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  preparando: 'En preparación',
  listo: 'Listo',
  enviado: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Siguiente paso del flujo según canal. */
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

export const NEXT_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  listo: 'Marcar listo',
  enviado: 'Salió a domicilio',
  entregado: 'Entregado',
};

export interface NewOrderInput {
  channel: Channel;
  items: OrderItem[];
  deliveryFee: number;
  payStatus: PayStatus;
  payMethod?: PayMethod;
  payAccount?: string;
  cashReceived?: number;
  customer?: Customer;
  note?: string;
}

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const s = await getSettings();
  const now = Date.now();
  const dayKey = dayKeyOf(now, s.dayCutoffHour);
  const subtotal = input.items.reduce((acc, it) => acc + it.price * it.qty, 0);
  const total = subtotal + (input.channel === 'domicilio' ? input.deliveryFee : 0);

  const order = await db.transaction('rw', db.orders, async () => {
    const number = (await db.orders.where('dayKey').equals(dayKey).count()) + 1;
    const o: Order = {
      id: uid(),
      number,
      dayKey,
      createdAt: now,
      updatedAt: now,
      channel: input.channel,
      status: 'preparando',
      statusAt: now,
      items: input.items,
      subtotal,
      deliveryFee: input.channel === 'domicilio' ? input.deliveryFee : 0,
      total,
      payStatus: input.payStatus,
      payMethod: input.payMethod,
      payAccount: input.payAccount,
      cashReceived: input.cashReceived,
      paidAt: input.payStatus === 'pagado' ? now : undefined,
      customer: input.customer,
      note: input.note,
      log: [{ status: 'preparando', at: now }],
      synced: 0,
    };
    if (input.payStatus === 'pagado') o.log.push({ status: 'pago', at: now, detail: payDetail(o) });
    await db.orders.add(o);
    return o;
  });

  if (order.payStatus === 'pendiente') {
    schedulePayReminders(
      order.id,
      `Cobro pendiente · Pedido #${order.number}`,
      `${money(order.total)} sin confirmar. Abre Prenzao y confirma el pago.`,
      s.reminderMinutes,
    );
  }
  return order;
}

function payDetail(o: Pick<Order, 'payMethod' | 'payAccount'>) {
  if (o.payMethod === 'transferencia') return `Transferencia${o.payAccount ? ' · ' + o.payAccount : ''}`;
  if (o.payMethod === 'efectivo') return 'Efectivo';
  return '';
}

export async function advanceOrder(id: string, to?: OrderStatus) {
  const o = await db.orders.get(id);
  if (!o) return;
  const target = to ?? nextStatus(o);
  if (!target) return;
  const now = Date.now();
  await db.orders.update(id, {
    status: target,
    statusAt: now,
    updatedAt: now,
    lastNudgeAt: undefined,
    log: [...o.log, { status: target, at: now }],
    synced: 0,
  });
}

export async function markPaid(id: string, method: PayMethod, account?: string, cashReceived?: number) {
  const o = await db.orders.get(id);
  if (!o) return;
  const now = Date.now();
  const patch = { payStatus: 'pagado' as const, payMethod: method, payAccount: account, cashReceived, paidAt: now };
  await db.orders.update(id, {
    ...patch,
    updatedAt: now,
    lastNudgeAt: undefined,
    log: [...o.log, { status: 'pago', at: now, detail: payDetail(patch) }],
    synced: 0,
  });
  cancelPayReminders(id);
}

export async function cancelOrder(id: string, reason: string) {
  const o = await db.orders.get(id);
  if (!o) return;
  const now = Date.now();
  await db.orders.update(id, {
    status: 'cancelado',
    statusAt: now,
    updatedAt: now,
    cancelReason: reason,
    log: [...o.log, { status: 'cancelado', at: now, detail: reason }],
    synced: 0,
  });
  cancelPayReminders(id);
}

export async function snoozeOrder(id: string) {
  await db.orders.update(id, { lastNudgeAt: Date.now() });
}

export function itemsSummary(items: OrderItem[]): string {
  return items.map((i) => `${i.qty}× ${i.name}`).join(' · ');
}

export function whatsappStatusText(o: Order, business = 'Prenzao'): string {
  const name = o.customer?.name ? ` ${o.customer.name.split(' ')[0]}` : '';
  const lines = o.items.map((i) => `• ${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`).join('\n');
  const pay =
    o.payStatus === 'pagado'
      ? `Pago recibido ✅`
      : `Total a pagar: ${money(o.total)}${o.payMethod ? ` (${o.payMethod})` : ''}`;
  const head: Record<OrderStatus, string> = {
    preparando: `¡Hola${name}! Recibimos tu pedido #${o.number} en ${business} y ya lo estamos preparando 🔥`,
    listo: `¡Hola${name}! Tu pedido #${o.number} de ${business} está listo 🙌`,
    enviado: `¡Hola${name}! Tu pedido #${o.number} de ${business} va en camino 🛵`,
    entregado: `¡Gracias${name}! Tu pedido #${o.number} fue entregado. ¡Buen provecho! 😋`,
    cancelado: `Hola${name}, tu pedido #${o.number} de ${business} fue cancelado.`,
  };
  return `${head[o.status]}\n\n${lines}\n\n${pay}`;
}
