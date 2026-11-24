import { db } from './db';
import { blobToDataURL, dataURLToBlob } from './image';
import { saveTextFile } from './platform';
import type { Expense, Order } from './types';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export async function exportBackup() {
  const [products, orders, expensesRaw, closes, kv] = await Promise.all([
    db.products.toArray(),
    db.orders.toArray(),
    db.expenses.toArray(),
    db.closes.toArray(),
    db.kv.toArray(),
  ]);
  const expenses = await Promise.all(
    expensesRaw.map(async (e) => ({ ...e, photo: e.photo ? await blobToDataURL(e.photo) : undefined })),
  );
  const data = { app: 'prenzao', version: 1, exportedAt: Date.now(), products, orders, expenses, closes, kv };
  await saveTextFile(`prenzao-respaldo-${stamp()}.json`, JSON.stringify(data), 'application/json');
}

export async function importBackup(file: File): Promise<{ orders: number; expenses: number }> {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'prenzao') throw new Error('Archivo no es un respaldo de Prenzao');
  const expenses: Expense[] = await Promise.all(
    (data.expenses ?? []).map(async (e: Expense & { photo?: string }) => ({
      ...e,
      photo: typeof e.photo === 'string' ? await dataURLToBlob(e.photo) : undefined,
    })),
  );
  await db.transaction('rw', [db.products, db.orders, db.expenses, db.closes, db.kv], async () => {
    if (data.products?.length) await db.products.bulkPut(data.products);
    if (data.orders?.length) await db.orders.bulkPut(data.orders);
    if (expenses.length) await db.expenses.bulkPut(expenses);
    if (data.closes?.length) await db.closes.bulkPut(data.closes);
    if (data.kv?.length) await db.kv.bulkPut(data.kv);
  });
  return { orders: data.orders?.length ?? 0, expenses: expenses.length };
}

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportSalesCSV() {
  const orders: Order[] = await db.orders.orderBy('createdAt').toArray();
  const head = ['dia', 'pedido', 'hora', 'canal', 'estado', 'producto', 'cantidad', 'precio_unit', 'subtotal_linea', 'nota', 'domicilio', 'total_pedido', 'pago_estado', 'pago_metodo', 'cuenta', 'cliente', 'telefono', 'direccion', 'motivo_cancelacion'];
  const rows = [head.join(',')];
  for (const o of orders) {
    for (const i of o.items) {
      rows.push(
        [o.dayKey, o.number, new Date(o.createdAt).toLocaleTimeString('es-CO'), o.channel, o.status, i.name, i.qty, i.price, i.qty * i.price, i.note, o.deliveryFee, o.total, o.payStatus, o.payMethod, o.payAccount, o.customer?.name, o.customer?.phone, o.customer?.address, o.cancelReason]
          .map(esc)
          .join(','),
      );
    }
  }
  await saveTextFile(`prenzao-ventas-${stamp()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
}

export async function exportExpensesCSV() {
  const list = await db.expenses.orderBy('createdAt').toArray();
  const head = ['dia', 'hora', 'categoria', 'proveedor', 'valor', 'metodo', 'de_caja', 'nota', 'tiene_foto'];
  const rows = [head.join(',')];
  list.forEach((e) =>
    rows.push([e.dayKey, new Date(e.createdAt).toLocaleTimeString('es-CO'), e.category, e.supplier, e.amount, e.method, e.fromCash ? 'si' : 'no', e.note, e.photo ? 'si' : 'no'].map(esc).join(',')),
  );
  await saveTextFile(`prenzao-gastos-${stamp()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
}
