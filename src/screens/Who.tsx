import { useState } from 'react';
import { hashPin, setDevice } from '../lib/db';
import { haptic } from '../lib/platform';
import { sfx } from '../lib/sound';
import { useBusiness, usePeople } from '../lib/hooks';
import type { Mode, Person } from '../lib/types';
import { Avatar, PinPad, Sheet } from '../ui/kit';
import { PersonSheet } from './Negocio';

/** "¿Quién está usando este teléfono?" — como los perfiles de Netflix. Un toque y entras. */
export function Who({ onPick, inSheet, onClose }: { onPick: (home: Mode) => void; inSheet?: boolean; onClose?: () => void }) {
  const people = usePeople();
  const biz = useBusiness();
  const [pinFor, setPinFor] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);

  const enter = async (p: Person) => {
    haptic.success();
    sfx.done();
    await setDevice({ personId: p.id });
    onPick(p.home ?? 'vender');
  };
  const tap = (p: Person) => {
    haptic.tap();
    if (p.pinHash) setPinFor(p);
    else enter(p);
  };

  const body = (
    <>
      <div className="people">
        {people.map((p, i) => (
          <button key={p.id} className="person" style={{ animationDelay: `${i * 50}ms` }} onClick={() => tap(p)}>
            <Avatar p={p} size={74} />
            <b>{p.name.split(' ')[0]}</b>
            <small>{p.owner ? 'Dueña' : p.home === 'cocina' ? 'Suele cocinar' : p.home === 'despacho' ? 'Suele despachar' : 'Suele vender'}{p.pinHash ? ' · 🔒' : ''}</small>
          </button>
        ))}
        <button className="person add" onClick={() => setAdding(true)}>
          <div className="avatar" style={{ width: 74, height: 74, fontSize: 74, background: 'var(--fill)' }}><span>＋</span></div>
          <b>Soy nuevo</b>
        </button>
      </div>
      <Sheet open={!!pinFor} onClose={() => setPinFor(null)}>
        {pinFor && (
          <PinPad
            title={`Hola, ${pinFor.name.split(' ')[0]} ${pinFor.emoji}`}
            sub="Escribe tu PIN"
            onCancel={() => setPinFor(null)}
            check={async (pin) => (await hashPin(pin)) === pinFor.pinHash}
            onDone={() => { const p = pinFor; setPinFor(null); enter(p); }}
          />
        )}
      </Sheet>
      <PersonSheet person={adding ? { id: '', name: '', owner: false, home: 'vender', emoji: '🧑', color: '#2f6fff', active: true, createdAt: Date.now() } : null} onClose={() => setAdding(false)} onSaved={(p) => enter(p)} />
    </>
  );

  if (inSheet) return <Sheet open onClose={onClose ?? (() => {})} title="¿Quién está usando el teléfono?" sub="Cambia de persona con un toque">{body}</Sheet>;

  return (
    <div className="onb">
      <div className="onb-hero" style={{ marginTop: '2vh' }}>
        <div className="logo-mark" style={{ width: 56, height: 56, fontSize: 32, borderRadius: 18 }}>P</div>
        <h1 className="onb-title" style={{ fontSize: 34 }}>¿Quién está usando<br /><em>este teléfono?</em></h1>
        <p className="onb-sub">{biz.name} · así sabemos quién tomó y cobró cada pedido.</p>
      </div>
      {body}
    </div>
  );
}
