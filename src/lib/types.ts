export type Channel = 'mostrador' | 'domicilio';
export type OrderStatus = 'preparando' | 'listo' | 'enviado' | 'entregado' | 'cancelado';
export type PayMethod = 'efectivo' | 'transferencia';
export type PayStatus = 'pagado' | 'pendiente';

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  sort: number;
  active: boolean; // aparece en la carta
  soldOut: boolean; // agotado hoy
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
}

export interface Customer {
  name?: string;
  phone?: string;
  address?: string;
  urgent?: boolean;
}

export interface StatusEvent {
  status: OrderStatus | 'pago' | 'nota';
  at: number;
  detail?: string;
}

export interface Order {
  id: string;
  number: number; // consecutivo del día
  dayKey: string; // día operativo YYYY-MM-DD (con hora de corte)
  createdAt: number;
  updatedAt: number;
  channel: Channel;
  status: OrderStatus;
  statusAt: number; // cuándo entró al estado actual
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  payStatus: PayStatus;
  payMethod?: PayMethod;
  payAccount?: string; // Nequi, Daviplata, Bancolombia, Llave…
  cashReceived?: number;
  paidAt?: number;
  customer?: Customer;
  note?: string;
  cancelReason?: string;
  log: StatusEvent[];
  lastNudgeAt?: number;
  synced: 0 | 1;
}

export interface Expense {
  id: string;
  dayKey: string;
  createdAt: number;
  amount: number;
  category: string;
  supplier?: string;
  method: PayMethod;
  fromCash: boolean; // salió de la caja del día
  note?: string;
  photo?: Blob;
  synced: 0 | 1;
}

export interface CashClose {
  id: string;
  dayKey: string;
  createdAt: number;
  base: number;
  cashSales: number;
  cashExpenses: number;
  expected: number;
  counted: number;
  diff: number;
  note?: string;
}

export interface Settings {
  businessName: string;
  transferAccounts: string[];
  reminderMinutes: number; // cada cuánto insistir con pagos pendientes
  readyMinutes: number; // mostrador: preguntar si se entregó
  deliveryMinutes: number; // domicilio: preguntar si llegó
  dayCutoffHour: number; // el día operativo cambia a esta hora
  cashBase: number; // base de caja
  defaultDeliveryFee: number;
  ownerPin: string; // vacío = sin PIN
}
