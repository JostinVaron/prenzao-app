import { db } from './db';
import { blobToDataURL, dataURLToBlob } from './image';
import { saveTextFile } from './platform';
import type { Expense, Order } from './types';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const TABLES = ['products', 'orders', 'expenses', 'closes', 'people', 'customers', 'devices', 'config'] as const;

export async function exportBackup() {
  const data: Record<string, unknown> = { app: 'prenzao', version: 2, exportedAt: Date.now() };
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  data.expenses = await Promise.all((data.expenses as Expense[]).map(async (e) => ({ ...e, photo: e.photo ? await blobToDataURL(e.photo) : undefined })));
  await saveTextFile(`prenzao-respaldo-${stamp()}.json`, JSON.stringify(data), 'application/json');
}

export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'prenzao') throw new Error('No es un respaldo de Prenzao');
  let n = 0;
  for (const t of TABLES) {
    let rows = data[t] as Record<string, unknown>[] | undefined;
    if (!rows?.length) continue;
    if (t === 'expenses') rows = await Promise.all(rows.map(async (e) => ({ ...e, photo: typeof e.photo === 'string' ? await dataURLToBlob(e.photo) : undefined })));
    await db.table(t).bulkPut(rows);
    await db.outbox.bulkPut(rows.map((r) => ({ key: `${t}/${r.id}`, table: t, id: r.id as string, at: Date.now() })));
    n += rows.length;
  }
  return n;
}

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportSalesCSV() {
  const orders: Order[] = await db.orders.orderBy('createdAt').toArray();
  const rows = ['dia,pedido,hora,canal,estado,producto,cantidad,precio,subtotal,nota,domicilio,total,pago,metodo,cuenta,cliente,telefono,direccion,origen'];
  for (const o of orders) for (const i of o.items) rows.push([o.dayKey, o.number, new Date(o.createdAt).toLocaleTimeString('es-CO'), o.channel, o.status, i.name, i.qty, i.price, i.qty * i.price, i.note, o.deliveryFee, o.total, o.payStatus, o.payMethod, o.payAccount, o.customer?.name, o.customer?.phone, o.customer?.address, o.source].map(esc).join(','));
  await saveTextFile(`prenzao-ventas-${stamp()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
}

export async function exportExpensesCSV() {
  const list = await db.expenses.orderBy('createdAt').toArray();
  const rows = ['dia,hora,categoria,tipo,proveedor_o_empleado,valor,metodo,de_caja,nota'];
  list.filter((e) => !e.deleted).forEach((e) => rows.push([e.dayKey, new Date(e.createdAt).toLocaleTimeString('es-CO'), e.category, e.kind, e.supplier, e.amount, e.method, e.fromCash ? 'si' : 'no', e.note].map(esc).join(',')));
  await saveTextFile(`prenzao-gastos-${stamp()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
}
