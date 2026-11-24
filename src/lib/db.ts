import Dexie, { type Table } from 'dexie';
import type { Business, CashClose, Customer, Device, DeviceSettings, Expense, Order, Person, Product, SyncTable } from './types';
import { MENU_SEED, CATEGORY_EMOJI } from '../data/menu';
import { hlcNow, setHlcNode } from './hlc';

interface KV { key: string; value: unknown }
export interface OutboxItem { key: string; table: SyncTable; id: string; at: number; tries?: number }

class PrenzaoDB extends Dexie {
  products!: Table<Product, string>;
  orders!: Table<Order, string>;
  expenses!: Table<Expense, string>;
  closes!: Table<CashClose, string>;
  people!: Table<Person, string>;
  customers!: Table<Customer, string>;
  devices!: Table<Device, string>;
  config!: Table<Business, string>;
  kv!: Table<KV, string>;
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super('prenzao');
    this.version(1).stores({
      products: 'id, category, sort',
      orders: 'id, dayKey, createdAt, status, payStatus, synced',
      expenses: 'id, dayKey, createdAt, category, synced',
      closes: 'id, dayKey, createdAt',
      kv: 'key',
    });
    this.version(2)
      .stores({
        products: 'id, category, sort',
        orders: 'id, dayKey, createdAt, status, payStatus',
        expenses: 'id, dayKey, createdAt, category, personId',
        closes: 'id, dayKey, createdAt',
        people: 'id',
        customers: 'id, lastAt',
        devices: 'id',
        config: 'id',
        kv: 'key',
        outbox: 'key, at',
      })
      .upgrade(async (tx) => {
        // v0.1 → v0.2: los ajustes pasan a la configuración sincronizada del negocio
        const old = (await tx.table('kv').get('settings'))?.value as Record<string, unknown> | undefined;
        const biz: Business = { ...DEFAULT_BUSINESS, ...(old ? pickBiz(old) : {}), _hlc: SEED_HLC };
        await tx.table('config').put(biz);
        for (const t of ['products', 'orders', 'expenses', 'closes']) {
          await tx.table(t).toCollection().modify((r: Record<string, unknown>) => {
            delete r.synced;
            r._hlc ??= SEED_HLC;
          });
        }
        // Carta oficial corregida (28 productos) reemplaza la carta de v0.1
        await tx.table('products').clear();
        await tx.table('products').bulkPut(MENU_SEED.map((p) => ({ ...p, active: true, soldOut: false, emoji: CATEGORY_EMOJI[p.category] ?? '🍽️', _hlc: SEED_HLC })));
      });
  }
}

export const db = new PrenzaoDB();
export const SEED_HLC = '0000000000000:0000:seed';

export const DEFAULT_BUSINESS: Business = {
  id: 'business',
  name: 'Prenzao',
  transferAccounts: ['Nequi', 'Daviplata', 'Bancolombia', 'Llave Bre-B'],
  reminderMinutes: 5,
  readyMinutes: 8,
  deliveryMinutes: 40,
  dayCutoffHour: 4,
  cashBase: 0,
  defaultDeliveryFee: 0,
  dailyGoal: 600000,
  prepTargetMin: 10,
};

function pickBiz(o: Record<string, unknown>): Partial<Business> {
  const keys: (keyof Business)[] = ['transferAccounts', 'reminderMinutes', 'readyMinutes', 'deliveryMinutes', 'dayCutoffHour', 'cashBase', 'defaultDeliveryFee'];
  const out: Record<string, unknown> = {};
  keys.forEach((k) => o[k] !== undefined && (out[k] = o[k]));
  if (typeof o.businessName === 'string') out.name = o.businessName;
  return out as Partial<Business>;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------- Dispositivo ----------------

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  if (m) {
    const model = m[1].trim();
    const known: Record<string, string> = { CPH2895: 'Oppo A6c', 'SM-S931B': 'Galaxy S25' };
    return known[model] ?? model;
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return 'Navegador';
}

let deviceCache: DeviceSettings | null = null;

export async function getDevice(): Promise<DeviceSettings> {
  if (deviceCache) return deviceCache;
  const row = (await db.kv.get('device'))?.value as DeviceSettings | undefined;
  const d: DeviceSettings = row ?? { deviceId: uid(), deviceName: guessDeviceName(), soundOn: true, voiceOn: true, onboarded: false };
  if (!row) await db.kv.put({ key: 'device', value: d });
  deviceCache = d;
  setHlcNode(d.deviceId);
  return d;
}

export async function setDevice(patch: Partial<DeviceSettings>) {
  const d = { ...(await getDevice()), ...patch };
  deviceCache = d;
  await db.kv.put({ key: 'device', value: d });
}

// ---------------- Escrituras sincronizadas ----------------

type Listener = () => void;
const kickers = new Set<Listener>();
export function onLocalChange(fn: Listener) {
  kickers.add(fn);
  return () => kickers.delete(fn);
}

/** Toda escritura que deba llegar a los otros teléfonos pasa por aquí. */
export async function save<T extends { id: string; _hlc?: string }>(table: SyncTable, row: T): Promise<T> {
  const stamped = { ...row, _hlc: hlcNow() };
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(stamped);
    await db.outbox.put({ key: `${table}/${row.id}`, table, id: row.id, at: Date.now() });
  });
  kickers.forEach((k) => k());
  return stamped;
}

export async function patch<T extends { id: string }>(table: SyncTable, id: string, changes: Partial<T>): Promise<T | undefined> {
  const cur = (await db.table(table).get(id)) as T | undefined;
  if (!cur) return undefined;
  return save(table, { ...cur, ...changes } as T & { id: string });
}

export async function getBusiness(): Promise<Business> {
  return { ...DEFAULT_BUSINESS, ...((await db.config.get('business')) ?? {}) };
}

export async function saveBusiness(changes: Partial<Business>) {
  const cur = await getBusiness();
  await save('config', { ...cur, ...changes, id: 'business' });
}

/** Siembra de un negocio nuevo (o migración v0.1). Los dispositivos que se UNEN no siembran. */
export async function seedBusiness(name: string) {
  if ((await db.products.count()) === 0) {
    for (const p of MENU_SEED) {
      const row: Product = { ...p, active: true, soldOut: false, emoji: CATEGORY_EMOJI[p.category] ?? '🍽️', _hlc: SEED_HLC };
      await db.products.put(row);
      await db.outbox.put({ key: `products/${row.id}`, table: 'products', id: row.id, at: Date.now() });
    }
  } else {
    // datos de v0.1: publicarlos todos
    for (const t of ['products', 'orders', 'expenses', 'closes'] as SyncTable[]) {
      const ids = (await db.table(t).toCollection().primaryKeys()) as string[];
      await db.outbox.bulkPut(ids.map((id) => ({ key: `${t}/${id}`, table: t, id, at: Date.now() })));
    }
  }
  const cur = await db.config.get('business');
  await save('config', { ...DEFAULT_BUSINESS, ...(cur ?? {}), name, id: 'business' });
}

export async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('prenzao:' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
