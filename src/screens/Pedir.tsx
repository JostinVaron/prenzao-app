import { useEffect, useMemo, useState } from 'react';
import { readMenuLink, type LinkMenu } from '../lib/menulink';
import { encodeLinkOrder } from '../lib/parser';
import { money } from '../lib/format';
import { haptic } from '../lib/platform';
import { sfx, unlockAudio } from '../lib/sound';
import { Field, Seg, Sheet, Stepper } from '../ui/kit';

/** Página pública para clientes: arma tu pedido y envíalo por WhatsApp. Sin servidor, sin cuenta. */
export function Pedir() {
  const [menu, setMenu] = useState<LinkMenu | null | undefined>(undefined);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [pay, setPay] = useState<'e' | 't'>('e');
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    readMenuLink(location.hash).then(setMenu);
    try {
      const s = JSON.parse(localStorage.getItem('pz.cliente') ?? '{}');
      setName(s.n ?? '');
      setAddress(s.a ?? '');
    } catch { /* noop */ }
  }, []);

  const cats = useMemo(() => [...new Set(menu?.p.map((p) => p[2]) ?? [])], [menu]);
  if (menu === undefined) return <div className="boot"><div className="logo-mark">P</div></div>;
  if (!menu) return <div className="onb"><h1 className="onb-title">Link no válido</h1><p className="onb-sub">Pide el link del menú de nuevo al negocio.</p></div>;

  const items = menu.p.filter((p) => cart[p[0]]);
  const subtotal = items.reduce((a, p) => a + p[3] * cart[p[0]], 0);
  const total = subtotal + (menu.f || 0);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const add = (id: string, d: number) => {
    unlockAudio();
    haptic.tap();
    d > 0 ? sfx.pop((cart[id] ?? 0) + 1) : sfx.remove();
    setCart({ ...cart, [id]: Math.max(0, (cart[id] ?? 0) + d) });
  };

  const send = () => {
    localStorage.setItem('pz.cliente', JSON.stringify({ n: name, a: address }));
    const lines = items.map((p) => `• ${cart[p[0]]}× ${p[1]}`).join('\n');
    const cashN = Number(cash.replace(/\D/g, '')) || undefined;
    const code = encodeLinkOrder({ i: items.map((p) => [p[0], cart[p[0]]]), n: name || undefined, a: address || undefined, m: pay, r: pay === 'e' ? cashN : undefined });
    const txt = `¡Hola ${menu.n}! 👋 Quiero pedir:\n${lines}\n\nTotal: ${money(total)}${menu.f ? ' (con domicilio)' : ''}\n📍 ${address}\n👤 ${name}\n💳 ${pay === 't' ? 'Transferencia' : `Efectivo${cashN ? `, pago con ${money(cashN)}` : ''}`}${note ? `\n📝 ${note}` : ''}\n\n${code}`;
    window.location.href = `https://wa.me/${menu.w.length === 10 ? '57' + menu.w : menu.w}?text=${encodeURIComponent(txt)}`;
  };

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--sat) + 12px)', paddingBottom: 140 }}>
      <div className="hello">
        <div className="logo-mark" style={{ width: 54, height: 54, fontSize: 30, borderRadius: 18 }}>{menu.n.charAt(0)}</div>
        <div className="grow"><div className="hello-title">{menu.n}</div><div className="hello-sub">Arma tu pedido y llega listo a WhatsApp</div></div>
      </div>
      {cats.map((c) => (
        <section key={c} className="menu-sec">
          <div className="menu-sec-title">{menu.p.find((p) => p[2] === c)?.[4]} {c}<i /></div>
          <div className="card" style={{ margin: 0 }}>
            {menu.p.filter((p) => p[2] === c).map((p) => (
              <div key={p[0]} className="li">
                <div className="li-ico" style={{ fontSize: 24 }}>{p[4]}</div>
                <div className="li-main"><div className="li-title">{p[1]}</div><div className="li-sub">{money(p[3])}</div></div>
                {cart[p[0]] ? <Stepper value={cart[p[0]]} onChange={(n) => add(p[0], n - cart[p[0]])} /> : <button className="chip" onClick={() => add(p[0], 1)}>Agregar</button>}
              </div>
            ))}
          </div>
        </section>
      ))}
      {count > 0 && (
        <div className="dock" style={{ bottom: 'calc(var(--sab) + 12px)' }}>
          <div className="dock-top"><div className="grow" style={{ fontWeight: 750 }}>{count} productos</div><div className="dock-total">{money(subtotal)}</div></div>
          <button className="btn btn-go btn-block btn-xl" onClick={() => setForm(true)}>Continuar</button>
        </div>
      )}
      <Sheet open={form} onClose={() => setForm(false)} full title="¿A dónde lo llevamos?" footer={<button className="btn btn-wa btn-block btn-xl" disabled={!address.trim() || !name.trim()} onClick={send}>Enviar pedido por WhatsApp · {money(total)}</button>}>
        <Field label="Tu nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Dirección y barrio"><textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="¿Cómo pagas?"><Seg<'e' | 't'> value={pay} onChange={setPay} options={[{ value: 'e', label: '💵 Efectivo' }, { value: 't', label: '📲 Transferencia' }]} /></Field>
        {pay === 'e' && <Field label="¿Con cuánto pagas? (para llevarte el cambio)"><input className="input" inputMode="numeric" placeholder="Ej: 50.000" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>}
        <Field label="Notas (opcional)"><input className="input" placeholder="Ej: sin cebolla, timbre dañado" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="card pad" style={{ margin: 0 }}>
          {items.map((p) => <div key={p[0]} className="kv"><span>{cart[p[0]]}× {p[1]}</span><b>{money(p[3] * cart[p[0]])}</b></div>)}
          {menu.f > 0 && <div className="kv"><span>Domicilio</span><b>{money(menu.f)}</b></div>}
          <div className="kv total"><span>Total</span><b>{money(total)}</b></div>
        </div>
      </Sheet>
    </div>
  );
}
