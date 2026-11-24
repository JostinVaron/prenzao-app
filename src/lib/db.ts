import Dexie, { type Table } from 'dexie';
import type { CashClose, Expense, Order, Product, Settings } from './types';
import { MENU_SEED } from '../data/menu';

interface KV {
  key: string;
  value: unknown;
}

class PrenzaoDB extends Dexie {
  products!: Table<Product, string>;
  orders!: Table<Order, string>;
  expenses!: Table<Expense, string>;
  closes!: Table<CashClose, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('prenzao');
    this.version(1).stores({
      products: 'id, category, sort',
      orders: 'id, dayKey, createdAt, status, payStatus, synced',
      expenses: 'id, dayKey, createdAt, category, synced',
      closes: 'id, dayKey, createdAt',
      kv: 'key',
    });
  }
}

export const db = new PrenzaoDB();

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'Prenzao',
  transferAccounts: ['Nequi', 'Daviplata', 'Bancolombia', 'Llave Bre-B'],
  reminderMinutes: 5,
  readyMinutes: 8,
  deliveryMinutes: 40,
  dayCutoffHour: 4,
  cashBase: 0,
  defaultDeliveryFee: 0,
  ownerPin: '',
};

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } });
}

/** Primera apertura: carga la carta real desde el CSV. */
export async function ensureSeed() {
  const count = await db.products.count();
  if (count === 0) {
    await db.products.bulkPut(MENU_SEED.map((p) => ({ ...p, active: true, soldOut: false })));
  }
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
