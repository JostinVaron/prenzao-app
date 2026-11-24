// Cifrado de extremo a extremo. La llave del negocio (32 bytes) solo vive en los
// dispositivos autorizados. Los relays solo ven texto cifrado e identificadores opacos.
import { getPublicKey } from 'nostr-tools/pure';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface BizKeys {
  sk: Uint8Array; // llave de firma Nostr del negocio
  pk: string;
  aes: CryptoKey;
  hmac: CryptoKey;
}

export async function deriveKeys(secret: Uint8Array): Promise<BizKeys> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('prenzao-v1'), info: enc.encode(info) });
  const sk = new Uint8Array(await crypto.subtle.deriveBits(params('nostr-sk'), base, 256));
  const aes = await crypto.subtle.deriveKey(params('aes-gcm'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hraw = new Uint8Array(await crypto.subtle.deriveBits(params('d-tag'), base, 256));
  const hmac = await crypto.subtle.importKey('raw', hraw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { sk, pk: getPublicKey(sk), aes, hmac };
}

export function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canZip = typeof CompressionStream !== 'undefined';

export async function seal(keys: BizKeys, obj: unknown): Promise<string> {
  let data: Uint8Array = enc.encode(JSON.stringify(obj));
  let flag = '0';
  if (canZip) {
    data = await pipe(data, new CompressionStream('gzip'));
    flag = '1';
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.aes, data as BufferSource));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return `${flag}${b64url(all)}`;
}

export async function open<T>(keys: BizKeys, content: string): Promise<T> {
  const flag = content[0];
  const all = fromB64url(content.slice(1));
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, keys.aes, all.slice(12)));
  const data = flag === '1' ? await pipe(plain, new DecompressionStream('gzip')) : plain;
  return JSON.parse(dec.decode(data)) as T;
}

/** Identificador opaco por registro: el relay no puede saber qué es ni de qué tabla. */
export async function opaqueId(keys: BizKeys, s: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', keys.hmac, enc.encode(s)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Código de vinculación ----------
export interface PairPayload {
  secret: Uint8Array;
  relays?: string[];
  name?: string;
}

export function makePairCode(p: PairPayload): string {
  const extra = b64url(enc.encode(JSON.stringify({ r: p.relays, n: p.name })));
  return `PZ1.${b64url(p.secret)}.${extra}`;
}

export function parsePairCode(code: string): PairPayload | null {
  const m = code.trim().match(/PZ1\.([A-Za-z0-9_-]{40,46})(?:\.([A-Za-z0-9_-]+))?/);
  if (!m) return null;
  const secret = fromB64url(m[1]);
  if (secret.length !== 32) return null;
  let relays: string[] | undefined;
  let name: string | undefined;
  if (m[2]) {
    try {
      const j = JSON.parse(dec.decode(fromB64url(m[2])));
      relays = Array.isArray(j.r) ? j.r : undefined;
      name = typeof j.n === 'string' ? j.n : undefined;
    } catch {
      /* noop */
    }
  }
  return { secret, relays, name };
}
