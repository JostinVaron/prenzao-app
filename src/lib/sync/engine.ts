// ============================================================
// Motor de sincronización local-first.
// - Cada teléfono tiene TODOS los datos y funciona sin internet.
// - Los cambios viajan cifrados (AES-256-GCM) como eventos Nostr NIP-78 (kind 30078)
//   firmados con la llave del negocio, a varios relays independientes a la vez.
// - Al recibir, se fusiona de forma determinista; si nosotros sabemos algo que el
//   evento no trae, re-publicamos el estado fusionado (anti-entropía).
// ============================================================
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { db, getDevice, onLocalChange, save } from '../db';
import { hlcObserve } from '../hlc';
import { SYNC_TABLES, type SyncTable } from '../types';
import { b64url, deriveKeys, fromB64url, makePairCode, opaqueId, open, randomSecret, seal, type BizKeys } from './crypto';
import { merge, sameContent } from './merge';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.net',
  'wss://nostr-pub.wellorder.net',
  'wss://nostrue.com',
];

const KIND = 30078;

interface SyncConfig {
  secret?: string; // b64url
  relays: string[];
  lastSeen?: number; // created_at más reciente recibido (segundos)
  name?: string;
}

export interface SyncStatus {
  paired: boolean;
  relays: { url: string; ok: boolean }[];
  pending: number;
  lastEventAt?: number;
  initialDone: boolean;
  received: number;
}

type Payload = { t: SyncTable; r: Record<string, unknown> & { id: string; _hlc?: string } };

class SyncEngine {
  private pool: SimplePool | null = null;
  private keys: BizKeys | null = null;
  private cfg: SyncConfig = { relays: DEFAULT_RELAYS };
  private sub: { close: () => void } | null = null;
  private seen = new Set<string>();
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = { paired: false, relays: [], pending: 0, initialDone: false, received: 0 };

  async loadConfig(): Promise<SyncConfig> {
    const row = (await db.kv.get('sync'))?.value as SyncConfig | undefined;
    let base = DEFAULT_RELAYS;
    try {
      const o = localStorage.getItem('prenzao.relays'); // solo para pruebas / servidor propio antes de vincular
      if (o) base = JSON.parse(o);
    } catch { /* noop */ }
    this.cfg = { relays: base, ...(row ?? {}) };
    return this.cfg;
  }

  private async saveConfig() {
    await db.kv.put({ key: 'sync', value: this.cfg });
  }

  async isPaired() {
    return !!(await this.loadConfig()).secret;
  }

  /** Crea la llave del negocio (primer dispositivo / dueña). */
  async createBusiness(name: string) {
    await this.loadConfig();
    this.cfg.secret = b64url(randomSecret());
    this.cfg.name = name;
    await this.saveConfig();
    await this.start();
  }

  /** Se une con un código de vinculación (QR o texto). */
  async join(secret: Uint8Array, relays?: string[], name?: string) {
    await this.loadConfig();
    this.cfg.secret = b64url(secret);
    if (relays?.length) this.cfg.relays = relays;
    this.cfg.name = name;
    this.cfg.lastSeen = undefined;
    await this.saveConfig();
    await this.start();
  }

  async pairCode(): Promise<string | null> {
    await this.loadConfig();
    if (!this.cfg.secret) return null;
    const custom = this.cfg.relays.join() !== DEFAULT_RELAYS.join() ? this.cfg.relays : undefined;
    return makePairCode({ secret: fromB64url(this.cfg.secret), relays: custom, name: this.cfg.name });
  }

  async setRelays(relays: string[]) {
    this.cfg.relays = relays.length ? relays : DEFAULT_RELAYS;
    await this.saveConfig();
    this.stop();
    await this.start();
  }

  relays() {
    return this.cfg.relays;
  }

  subscribe(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }

  async start() {
    await this.loadConfig();
    if (!this.cfg.secret || this.pool) {
      this.emit({ paired: !!this.cfg.secret });
      return;
    }
    this.keys = await deriveKeys(fromB64url(this.cfg.secret));
    this.pool = new SimplePool({ enableReconnect: true, enablePing: true } as never);
    this.emit({ paired: true, initialDone: false, received: 0 });

    const since = this.cfg.lastSeen ? this.cfg.lastSeen - 300 : undefined;
    this.sub = this.pool.subscribeMany(
      this.cfg.relays,
      { kinds: [KIND], authors: [this.keys.pk], ...(since ? { since } : {}) },
      {
        onevent: (e) => {
          this.onEvent(e).catch(() => {});
        },
        oneose: () => this.emit({ initialDone: true }),
      },
    );
    // si ningún relay responde, no bloquear la app
    setTimeout(() => this.emit({ initialDone: true }), 8000);

    onLocalChange(() => this.schedule());
    window.addEventListener('online', () => this.schedule(50));
    setInterval(() => this.refreshStatus(), 3000);
    setTimeout(() => this.refreshStatus(), 800);
    setInterval(() => this.schedule(), 20000);
    this.schedule(300);
    this.heartbeat();
    setInterval(() => this.heartbeat(), 10 * 60000);
  }

  stop() {
    this.sub?.close();
    this.pool?.destroy();
    this.pool = null;
    this.sub = null;
  }

  private async heartbeat() {
    const d = await getDevice();
    const cur = await db.devices.get(d.deviceId);
    await save('devices', { ...(cur ?? {}), id: d.deviceId, name: d.deviceName, platform: navigator.platform || 'web', personId: d.personId, lastSeen: Date.now() });
  }

  private async refreshStatus() {
    const st = this.pool?.listConnectionStatus();
    const relays = this.cfg.relays.map((url) => ({ url, ok: !!(st?.get(url) ?? st?.get(url + '/')) }));
    const pending = await db.outbox.count();
    this.emit({ relays, pending });
  }

  private schedule(ms = 250) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }

  // -------------------- Recibir --------------------
  private async onEvent(e: Event) {
    if (!this.keys || this.seen.has(e.id)) return;
    this.seen.add(e.id);
    let p: Payload;
    try {
      p = await open<Payload>(this.keys, e.content);
    } catch {
      return; // no es nuestro o está corrupto
    }
    if (!SYNC_TABLES.includes(p.t) || !p.r?.id) return;
    hlcObserve(p.r._hlc);
    const table = db.table(p.t);
    const local = await table.get(p.r.id);
    const merged = merge(p.t, local, p.r);
    if (!local || !sameContent(merged, local)) await table.put(merged);
    if (!sameContent(stripLocal(merged), stripLocal(p.r))) {
      // sabemos algo que el evento no trae → re-publicar el estado fusionado
      await db.outbox.put({ key: `${p.t}/${p.r.id}`, table: p.t, id: p.r.id, at: Date.now() });
      this.schedule(1500);
    }
    if (!this.cfg.lastSeen || e.created_at > this.cfg.lastSeen) {
      this.cfg.lastSeen = e.created_at;
      this.saveConfigSoon();
    }
    this.emit({ lastEventAt: Date.now(), received: this.status.received + 1 });
  }

  private cfgTimer: ReturnType<typeof setTimeout> | null = null;
  private saveConfigSoon() {
    if (this.cfgTimer) return;
    this.cfgTimer = setTimeout(() => {
      this.cfgTimer = null;
      this.saveConfig();
    }, 2000);
  }

  // -------------------- Enviar --------------------
  private async flush() {
    if (!this.pool || !this.keys || this.flushing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.flushing = true;
    try {
      const items = await db.outbox.orderBy('at').limit(40).toArray();
      for (const it of items) {
        const row = await db.table(it.table).get(it.id);
        if (!row) {
          await db.outbox.delete(it.key);
          continue;
        }
        const ev = await this.buildEvent(it.table, row);
        const results = await Promise.allSettled(this.pool.publish(this.cfg.relays, ev, { maxWait: 6000 }));
        const ok = results.some((r) => r.status === 'fulfilled');
        const cur = await db.outbox.get(it.key);
        if (ok && cur && cur.at === it.at) await db.outbox.delete(it.key);
        else if (!ok && cur) await db.outbox.update(it.key, { tries: (cur.tries ?? 0) + 1 });
        this.seen.add(ev.id);
      }
      const left = await db.outbox.count();
      this.emit({ pending: left });
      if (left && items.length === 40) this.schedule(200);
    } finally {
      this.flushing = false;
    }
  }

  private async buildEvent(table: SyncTable, row: Record<string, unknown> & { id: string; _hlc?: string }) {
    const keys = this.keys!;
    const clean = stripLocal(row);
    const content = await seal(keys, { t: table, r: clean });
    const d = await opaqueId(keys, `${table}/${row.id}`);
    // created_at derivado del HLC: un cambio más nuevo nunca queda "detrás" en el relay
    const hlcSec = row._hlc ? Math.floor(Number(row._hlc.slice(0, 13)) / 1000) : 0;
    const created_at = Math.max(Math.floor(Date.now() / 1000), hlcSec);
    return finalizeEvent({ kind: KIND, created_at, tags: [['d', d]], content }, keys.sk);
  }
}

function stripLocal<T extends Record<string, unknown>>(row: T): T {
  if (!row || !('photo' in row)) return row;
  const { photo, ...rest } = row as Record<string, unknown>;
  void photo;
  return rest as T;
}

export const sync = new SyncEngine();
