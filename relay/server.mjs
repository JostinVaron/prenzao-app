// Relay Nostr mínimo para Prenzao (NIP-01 + eventos reemplazables NIP-33/NIP-78).
// Guarda solo texto cifrado: este servidor NO puede leer pedidos, precios ni nombres.
// Uso:  PORT=7777 ALLOW=<pubkey del negocio, opcional> node server.mjs
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 7777);
const FILE = process.env.DATA || './prenzao-relay.jsonl';
const ALLOW = (process.env.ALLOW || '').split(',').filter(Boolean); // limitar a tu negocio
const store = new Map(); // clave reemplazable → evento

const keyOf = (e) => {
  const d = (e.tags.find((t) => t[0] === 'd') || [])[1] || '';
  return e.kind >= 30000 && e.kind < 40000 ? `${e.pubkey}:${e.kind}:${d}` : e.id;
};
function put(e) {
  const k = keyOf(e);
  const cur = store.get(k);
  if (cur && (cur.created_at > e.created_at || (cur.created_at === e.created_at && cur.id < e.id))) return false;
  store.set(k, e);
  return true;
}
if (fs.existsSync(FILE)) for (const ln of fs.readFileSync(FILE, 'utf8').split('\n')) { try { if (ln) put(JSON.parse(ln)); } catch {} }
const log = fs.createWriteStream(FILE, { flags: 'a' });

function match(e, f) {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.since && e.created_at < f.since) return false;
  if (f.until && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) if (k[0] === '#' && !e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false;
  return true;
}

const wss = new WebSocketServer({ port: PORT });
const subs = new Map(); // ws → Map(subId → filters)
wss.on('connection', (ws) => {
  subs.set(ws, new Map());
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === 'EVENT') {
      const e = rest[0];
      if (!verifyEvent(e)) return ws.send(JSON.stringify(['OK', e?.id, false, 'invalid: firma']));
      if (ALLOW.length && !ALLOW.includes(e.pubkey)) return ws.send(JSON.stringify(['OK', e.id, false, 'blocked: no autorizado']));
      const fresh = put(e);
      if (fresh) log.write(JSON.stringify(e) + '\n');
      ws.send(JSON.stringify(['OK', e.id, true, '']));
      if (fresh) for (const [c, m] of subs) for (const [sid, fs_] of m) if (fs_.some((f) => match(e, f))) c.send(JSON.stringify(['EVENT', sid, e]));
    } else if (type === 'REQ') {
      const [sid, ...filters] = rest;
      subs.get(ws).set(sid, filters);
      const out = [...store.values()].filter((e) => filters.some((f) => match(e, f))).sort((a, b) => a.created_at - b.created_at);
      const limit = Math.min(...filters.map((f) => f.limit || 1e9));
      for (const e of out.slice(-limit)) ws.send(JSON.stringify(['EVENT', sid, e]));
      ws.send(JSON.stringify(['EOSE', sid]));
    } else if (type === 'CLOSE') subs.get(ws).delete(rest[0]);
  });
  ws.on('close', () => subs.delete(ws));
});
console.log(`Relay Prenzao escuchando en ws://0.0.0.0:${PORT} · ${store.size} eventos guardados`);
