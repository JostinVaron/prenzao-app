// ============================================================
// Modelo de datos v2 — local-first, sincronizable entre dispositivos.
// Todo registro sincronizable lleva _hlc (reloj lógico híbrido).
// ============================================================

export type Channel = 'mostrador' | 'domicilio';
export type OrderStatus = 'preparando' | 'listo' | 'enviado' | 'entregado' | 'cancelado';
export type PayMethod = 'efectivo' | 'transferencia';
export type PayStatus = 'pagado' | 'pendiente';
/** Vistas de trabajo. NO son permisos: cualquiera del trailer entra a cualquiera con un toque.
 *  En el trailer hay 2 personas y los papeles rotan (quien cocina también cobra cuando el otro sale a domicilio). */
export type Mode = 'vender' | 'cocina' | 'despacho' | 'caja' | 'negocio';

export interface Synced {
  _hlc?: string;
  deleted?: 0 | 1;
}

export interface Product extends Synced {
  id: string;
  name: string; // nombre completo para cocina y tickets ("Hot Dog especial")
  short?: string; // nombre corto para la carta ("Especial")
  category: string;
  price: number;
  description: string;
  sort: number;
  active: boolean;
  soldOut: boolean;
  emoji?: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
}

export interface Customer extends Synced {
  id: string; // teléfono (solo dígitos) o uuid
  phone?: string;
  name?: string;
  address?: string;
  notes?: string;
  orders: number;
  spent: number;
  lastAt: number;
}

export interface StatusEvent {
  status: OrderStatus | 'pago' | 'nota';
  at: number;
  by?: string; // persona
  detail?: string;
}

export interface Order extends Synced {
  id: string;
  number: number;
  dayKey: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  device?: string;
  channel: Channel;
  status: OrderStatus;
  statusAt: number;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  payStatus: PayStatus;
  payMethod?: PayMethod;
  payAccount?: string;
  cashReceived?: number;
  paidAt?: number;
  customer?: { name?: string; phone?: string; address?: string; urgent?: boolean };
  source?: 'caja' | 'whatsapp' | 'link';
  note?: string;
  cancelReason?: string;
  log: StatusEvent[];
  lastNudgeAt?: number;
}

export type ExpenseKind = 'gasto' | 'nomina' | 'adelanto';

export interface Expense extends Synced {
  id: string;
  dayKey: string;
  createdAt: number;
  amount: number;
  category: string;
  kind?: ExpenseKind;
  personId?: string;
  payroll?: { days: number; rate: number; bonus: number; deduct: number; from?: string; to?: string };
  supplier?: string;
  method: PayMethod;
  fromCash: boolean;
  note?: string;
  by?: string;
  thumb?: string; // miniatura (se sincroniza)
  photo?: Blob; // foto completa (solo en el teléfono que la tomó)
}

export interface CashClose extends Synced {
  id: string;
  dayKey: string;
  createdAt: number;
  by?: string;
  base: number;
  cashSales: number;
  cashExpenses: number;
  expected: number;
  counted: number;
  diff: number;
  note?: string;
}

export interface Person extends Synced {
  id: string;
  name: string;
  owner: boolean; // accede a "Negocio" (dinero, nómina, carta, equipo)
  home: Mode; // vista con la que suele arrancar
  color: string;
  emoji: string;
  pinHash?: string;
  dailyRate?: number;
  phone?: string;
  active: boolean;
  createdAt: number;
}

export interface Device extends Synced {
  id: string;
  name: string;
  platform: string;
  personId?: string;
  lastSeen: number;
  revoked?: boolean;
}

/** Configuración del negocio (sincronizada). Un solo registro id='business'. */
export interface Business extends Synced {
  id: 'business';
  name: string;
  transferAccounts: string[];
  reminderMinutes: number;
  readyMinutes: number;
  deliveryMinutes: number;
  dayCutoffHour: number;
  cashBase: number;
  defaultDeliveryFee: number;
  dailyGoal: number;
  prepTargetMin: number;
  whatsapp?: string; // número del negocio para el link de pedidos
}

/** Configuración de ESTE dispositivo (no se sincroniza). */
export interface DeviceSettings {
  deviceId: string;
  deviceName: string;
  personId?: string;
  soundOn: boolean;
  voiceOn: boolean;
  onboarded: boolean;
}

export const SYNC_TABLES = ['products', 'orders', 'expenses', 'closes', 'people', 'customers', 'devices', 'config'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
