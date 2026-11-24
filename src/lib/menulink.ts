// Link de pedidos para clientes: la carta viaja comprimida DENTRO del link (sin servidor).
// El cliente arma su pedido y lo envía por WhatsApp con un código exacto que Prenzao lee al compartirlo.
import type { Product } from './types';

export interface LinkMenu {
  n: string; // negocio
  w: string; // whatsapp del negocio
  f: number; // domicilio por defecto
  p: [string, string, string, number, string][]; // id, nombre, categoría, precio, emoji
}

const b64u = (b: Uint8Array) => {
  let s = '';
  b.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function run(data: Uint8Array, s: CompressionStream | DecompressionStream) {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(s as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function buildMenuLink(base: string, name: string, whatsapp: string, fee: number, products: Product[]): Promise<string> {
  const m: LinkMenu = { n: name, w: whatsapp.replace(/\D/g, ''), f: fee, p: products.filter((p) => p.active && !p.soldOut && !p.deleted).sort((a, b) => a.sort - b.sort).map((p) => [p.id, p.name, p.category, p.price, p.emoji ?? '🍽️']) };
  const z = await run(new TextEncoder().encode(JSON.stringify(m)), new CompressionStream('deflate-raw'));
  return `${base}#pedir=${b64u(z)}`;
}

export async function readMenuLink(hash: string): Promise<LinkMenu | null> {
  const m = hash.match(/pedir=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const raw = await run(unb64u(m[1]), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(raw)) as LinkMenu;
  } catch {
    return null;
  }
}

export const PUBLIC_BASE = 'https://jostinvaron.github.io/prenzao-app/';
