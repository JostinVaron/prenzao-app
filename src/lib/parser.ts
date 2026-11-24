// ============================================================
// Lector de pedidos de WhatsApp.
// Entiende mensajes reales: "buenas, me regala 2 sanduches mixtos y un perro especial sin cebolla,
// pago con nequi. cra 18 # 70-12 sur bonavista, soy ana". 100% en el teléfono, sin IA externa.
// También lee el código exacto que genera el link de pedidos (PZO1:...).
// ============================================================
import type { OrderItem, PayMethod, Product } from './types';

export interface ParsedOrder {
  items: (OrderItem & { sure: boolean })[];
  customer: { name?: string; phone?: string; address?: string; urgent?: boolean };
  payMethod?: PayMethod;
  payAccount?: string;
  cashReceived?: number;
  isDelivery: boolean;
  structured: boolean;
  raw: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CAT_SYN: Record<string, string[]> = {
  'Sándwich': ['sandwich', 'sanduche', 'sanduches', 'sandwiches', 'sanduchito', 'prenzao', 'prenzaos', 'prensado', 'sanwich', 'sanwiches'],
  Hamburguesa: ['hamburguesa', 'hamburguesas', 'burger', 'burguer', 'hamburguer', 'hamburgesa'],
  'Hot Dog': ['hot dog', 'hotdog', 'hot dogs', 'perro', 'perros', 'perrito', 'perritos', 'jotdog'],
  Salchipapa: ['salchipapa', 'salchipapas', 'salchi'],
  'Patacón': ['patacon', 'patacones'],
  Especial: [],
  Combo: ['combo'],
  Adicional: ['adicional', 'adicion', 'extra'],
};

// Cuando el cliente no dice la categoría, ¿a cuál se refiere normalmente? (SUPUESTO, ajustable)
const DEFAULT_CAT_FOR_SHORT: Record<string, string> = {
  mixto: 'Sándwich',
  sencillo: 'Hot Dog',
  'de la casa': 'Sándwich',
  especial: 'Hot Dog',
  pollo: 'Sándwich',
};

const NUM: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, par: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12,
};
const GENERIC = new Set(['sencillo', 'sencilla', 'especial', 'artesanal', 'mixto', 'pollo', 'salsa', 'gaseosa', 'papas', 'carne']);
const FILLER = new Set(['de', 'del', 'con', 'el', 'la', 'los', 'las', 'mas', 'y']);

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

const wordEq = (input: string, alias: string) => lev1(input, alias) || (alias.endsWith('s') ? false : input === alias + 's' || input === alias + 'es');

interface Alias {
  product: Product;
  tokens: string[];
  sure: boolean;
}

function buildAliases(products: Product[]): Alias[] {
  const shorts = new Map<string, number>();
  products.forEach((p) => {
    const s = norm(p.short ?? p.name);
    shorts.set(s, (shorts.get(s) ?? 0) + 1);
  });
  const wordFreq = new Map<string, number>();
  products.forEach((p) => new Set(norm(p.short ?? p.name).split(' ')).forEach((w) => wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1)));
  const out: Alias[] = [];
  for (const p of products) {
    if (!p.active) continue;
    const short = norm(p.short ?? p.name);
    const shortTokens = short.split(' ').filter((t) => !FILLER.has(t) || short === 'de la casa');
    for (const syn of CAT_SYN[p.category] ?? []) out.push({ product: p, tokens: [...syn.split(' '), ...short.split(' ')], sure: true });
    out.push({ product: p, tokens: norm(p.name).split(' '), sure: true });
    const unique = shorts.get(short) === 1;
    if (unique && short.length >= 4) out.push({ product: p, tokens: short.split(' '), sure: true });
    else if (DEFAULT_CAT_FOR_SHORT[short] === p.category) out.push({ product: p, tokens: short.split(' '), sure: false });
    // palabra distintiva sola: "chiripapa", "teriyaki", "champinon", "hawaiano"
    const toks = short.split(' ');
    for (const t of [toks[0], toks[toks.length - 1]]) {
      if (toks.length > 1 && t.length >= 6 && !GENERIC.has(t) && (wordFreq.get(t) ?? 0) === 1) out.push({ product: p, tokens: [t], sure: true });
    }
    // "hamburguesa sencilla" ↔ "artesanal sencilla"
    if (p.category === 'Hamburguesa' && short.startsWith('artesanal ')) {
      const rest = short.replace('artesanal ', '');
      for (const syn of CAT_SYN.Hamburguesa) out.push({ product: p, tokens: [syn, ...rest.split(' ')], sure: true });
    }
    void shortTokens;
  }
  // primero los alias más largos (más específicos)
  return out.sort((a, b) => b.tokens.length - a.tokens.length);
}

function matchAt(words: string[], i: number, alias: string[]): number {
  let j = i;
  let skipped = 0;
  for (let k = 0; k < alias.length; k++) {
    while (j < words.length && !wordEq(words[j], alias[k]) && FILLER.has(words[j]) && k > 0 && skipped < 2) {
      j++;
      skipped++;
    }
    if (j >= words.length || !wordEq(words[j], alias[k])) return -1;
    j++;
  }
  return j; // índice siguiente
}

function qtyBefore(words: string[], i: number): number {
  for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
    const w = words[k];
    if (/^\d{1,2}$/.test(w)) return Number(w);
    const x = w.match(/^x?(\d{1,2})x?$/);
    if (x) return Number(x[1]);
    if (NUM[w]) return NUM[w];
    if (!FILLER.has(w) && !['me', 'regala', 'regalas', 'quiero', 'porfa', 'favor', 'manda', 'mandame', 'pedir', 'necesito', 'dame'].includes(w)) break;
  }
  return 0;
}

function qtyAfter(words: string[], j: number): number {
  const w = words[j];
  if (!w) return 0;
  const x = w.match(/^x(\d{1,2})$/);
  if (x) return Number(x[1]);
  if (w === 'x' && /^\d{1,2}$/.test(words[j + 1] ?? '')) return Number(words[j + 1]);
  return 0;
}

const ADDRESS_RE = /\b(calle|cll|cl|carrera|cra|kra|kr|cr|diagonal|dg|diag|transversal|tv|tr|trans|avenida|av|autopista|manzana|mz|barrio|conjunto|torre|apto|apartamento|bloque|interior|int|lote|vereda)\b|#\s*\d|\d+\s*-\s*\d+/i;

export function parseWhatsApp(text: string, products: Product[]): ParsedOrder {
  const raw = text.trim();
  const structured = parseStructured(raw, products);
  if (structured) return structured;

  const lines = raw.split(/\n+/);
  const customer: ParsedOrder['customer'] = {};
  const bodyLines: string[] = [];
  // Prefijo de WhatsApp al compartir varios mensajes: "[3:05 p. m., 24/11/2026] Ana Gómez: texto"
  for (const ln of lines) {
    const m = ln.match(/^\s*\[[^\]]{4,40}\]\s*([^:]{1,40}):\s*(.*)$/);
    if (m) {
      if (!customer.name && !/^\+?\d[\d\s-]+$/.test(m[1])) customer.name = m[1].trim();
      if (/^\+?\d[\d\s-]{8,}$/.test(m[1].trim())) customer.phone = m[1].replace(/\D/g, '');
      bodyLines.push(m[2]);
    } else bodyLines.push(ln);
  }
  const body = bodyLines.join('\n');
  const n = norm(body);
  const words = n.split(' ');

  // ---- Productos ----
  const aliases = buildAliases(products);
  const spans: { end: number; item: ParsedOrder['items'][number] }[] = [];
  const used = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    for (const a of aliases) {
      const end = matchAt(words, i, a.tokens);
      if (end < 0) continue;
      const qty = qtyBefore(words, i) || qtyAfter(words, end) || 1;
      for (let k = i; k < end; k++) used[k] = true;
      spans.push({ end, item: { productId: a.product.id, name: a.product.name, price: a.product.price, qty, sure: a.sure } });
      i = end - 1;
      break;
    }
  }

  // notas ("sin cebolla", "extra queso") → al último producto mencionado antes
  for (let k = 0; k < words.length; k++) {
    if (!['sin', 'extra'].includes(words[k]) || used[k] || !words[k + 1]) continue;
    let what = words[k + 1];
    if (['ni', 'y'].includes(words[k + 2] ?? '') && words[k + 3] && !used[k + 3]) what += ` ${words[k + 2]} ${words[k + 3]}`;
    const owner = [...spans].reverse().find((sp) => sp.end <= k);
    if (owner) owner.item.note = owner.item.note ? `${owner.item.note}, ${words[k]} ${what}` : cap(`${words[k]} ${what}`);
  }
  const found: ParsedOrder['items'] = [];
  for (const { item } of spans) {
    const prev = found.find((f) => f.productId === item.productId && f.note === item.note);
    if (prev) prev.qty += item.qty;
    else found.push(item);
  }

  // ---- Teléfono ----
  const ph = body.match(/(?:\+?57[\s-]?)?(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if (ph) customer.phone = ph[1] + ph[2] + ph[3];

  // ---- Dirección ----
  for (const ln of bodyLines) {
    const clean = ln.replace(/^\s*(direcci[oó]n|dir|para|enviar a|llevar a|a la)\s*[:\-]?\s*/i, '').trim();
    if (ADDRESS_RE.test(clean) && clean.length >= 6) {
      // si la línea también trae el pedido, quedarnos desde la palabra de dirección
      const idx = clean.search(/\b(calle|cll|cl|carrera|cra|kra|kr|cr|diagonal|dg|transversal|tv|avenida|av|autopista|manzana|mz|barrio|conjunto)\b/i);
      let addr = idx > 0 ? clean.slice(idx) : clean;
      addr = addr.split(/[.;]\s+(?=[A-Za-zÁÉÍÓÚáéíóú])|,\s*(?=(?:soy|pago|paga|pagar|pago|nequi|daviplata|bancolombia|efectivo|urgente|es urgente|gracias|porfa|por favor|cel|tel|mi nombre)\b)/i)[0];
      addr = addr.replace(/\b(nequi|daviplata|bancolombia|efectivo)\b.*$/i, '').replace(/(?:\+?57)?\s*3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}.*$/, '').replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '');
      if (addr.length >= 6 && addr.length <= 120) {
        customer.address = addr;
        break;
      }
    }
  }

  // ---- Nombre ----
  const nm = body.match(/\b(?:soy|a nombre de|mi nombre es|nombre\s*:)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/i);
  if (nm) customer.name = cap(nm[1]);

  // ---- Pago ----
  let payMethod: PayMethod | undefined;
  let payAccount: string | undefined;
  const acc = n.match(/\b(nequi|daviplata|davi plata|bancolombia|bre b|breb|llave|transferencia|transfiero|consigno)\b/);
  if (acc) {
    payMethod = 'transferencia';
    const k = acc[1];
    payAccount = k.startsWith('nequi') ? 'Nequi' : k.includes('davi') ? 'Daviplata' : k === 'bancolombia' ? 'Bancolombia' : k.includes('bre') || k === 'llave' ? 'Llave Bre-B' : undefined;
  } else if (/\b(efectivo|billete|cash|contraentrega|contra entrega|pago al recibir|le pago alla|devuelta|vueltas|cambio de)\b/.test(n)) payMethod = 'efectivo';
  let cashReceived: number | undefined;
  const cm = n.match(/\b(?:con|de|billete de|cambio de|devuelta de|vueltas de)\s+(\d{1,3})(?:\s?(?:mil|k)|\.?000)\b/);
  if (cm) {
    cashReceived = Number(cm[1]) * 1000;
    payMethod = 'efectivo';
  }

  customer.urgent = /\b(urgente|rapido|rapidito|lo mas pronto|ya mismo|afan)\b/.test(n) || undefined;
  const isDelivery = !!customer.address || /\b(domicilio|envi[ae]|mandar|llevar|traer)\b/.test(n);

  return { items: found, customer, payMethod, payAccount, cashReceived, isDelivery, structured: false, raw };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Formato exacto del link de pedidos ----------
// Línea final del mensaje: "PZO1:<base64url JSON>"
export interface LinkOrder {
  i: [string, number, string?][]; // productId, qty, nota
  n?: string;
  a?: string;
  p?: string;
  m?: 'e' | 't';
  c?: string; // cuenta
  r?: number; // paga con (efectivo)
  u?: 1;
}

export function encodeLinkOrder(o: LinkOrder): string {
  const json = JSON.stringify(o);
  const b = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `PZO1:${b}`;
}

function parseStructured(raw: string, products: Product[]): ParsedOrder | null {
  const m = raw.match(/PZO1:([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const s = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(s + '==='.slice((s.length + 3) % 4))))) as LinkOrder;
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = o.i
      .map(([id, qty, note]) => {
        const p = byId.get(id);
        return p ? { productId: p.id, name: p.name, price: p.price, qty, note: note || undefined, sure: true } : null;
      })
      .filter(Boolean) as ParsedOrder['items'];
    return {
      items,
      customer: { name: o.n, address: o.a, phone: o.p, urgent: o.u ? true : undefined },
      payMethod: o.m === 't' ? 'transferencia' : o.m === 'e' ? 'efectivo' : undefined,
      payAccount: o.c,
      cashReceived: o.r,
      isDelivery: true,
      structured: true,
      raw,
    };
  } catch {
    return null;
  }
}
