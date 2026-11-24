import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { db, save, seedBusiness, setDevice, uid } from '../lib/db';
import { parsePairCode } from '../lib/sync/crypto';
import { sync } from '../lib/sync/engine';
import { haptic } from '../lib/platform';
import { sfx, unlockAudio } from '../lib/sound';
import { useSync } from '../lib/hooks';
import type { Person } from '../lib/types';
import { Avatar, Field, Money, toast } from '../ui/kit';
import { burst } from '../ui/celebrate';

type Step = 'welcome' | 'biz' | 'me' | 'team' | 'goal' | 'join' | 'joining';
const EMO = ['👩‍🍳', '👨‍🍳', '🧑‍🍳', '👩', '👨', '🧑', '👵', '🧔'];
const COL = ['#ff4d1c', '#149a57', '#2f6fff', '#6d28d9', '#ffb800', '#d6336c'];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [biz, setBiz] = useState('Prenzao');
  const [me, setMe] = useState('');
  const [meEmoji, setMeEmoji] = useState('👩‍🍳');
  const [team, setTeam] = useState<{ name: string; emoji: string }[]>([]);
  const [newName, setNewName] = useState('');
  const [goal, setGoal] = useState(600000);
  const createSteps: Step[] = ['biz', 'me', 'team', 'goal'];
  const idx = createSteps.indexOf(step);

  const finishCreate = async () => {
    unlockAudio();
    await sync.createBusiness(biz.trim() || 'Prenzao');
    await seedBusiness(biz.trim() || 'Prenzao');
    const owner: Person = { id: uid(), name: me.trim() || 'Dueña', owner: true, home: 'vender', emoji: meEmoji, color: COL[0], active: true, createdAt: Date.now() };
    await save('people', owner);
    for (const [i, t] of team.entries()) await save('people', { id: uid(), name: t.name, owner: false, home: i === 0 ? 'cocina' : 'vender', emoji: t.emoji, color: COL[(i + 1) % COL.length], active: true, createdAt: Date.now() + i + 1 } as Person);
    const b = await db.config.get('business');
    if (b) await save('config', { ...b, dailyGoal: goal });
    await setDevice({ onboarded: true, personId: owner.id });
    burst('big');
    sfx.fanfare();
    onDone();
  };

  if (step === 'join' || step === 'joining') return <Join joining={step === 'joining'} onJoined={() => setStep('joining')} onBack={() => setStep('welcome')} onDone={onDone} />;

  return (
    <div className="onb">
      {idx >= 0 && <div className="steps">{createSteps.map((s, i) => <i key={s} className={i <= idx ? 'on' : ''} />)}</div>}

      {step === 'welcome' && (
        <>
          <div className="onb-hero">
            <div className="logo-mark">P</div>
            <h1 className="onb-title">Tu trailer,<br /><em>sin papel.</em></h1>
            <p className="onb-sub">Pedidos, cocina, domicilios y caja en todos los teléfonos del equipo, al instante. Funciona aunque se caiga la señal.</p>
          </div>
          <div className="grow" />
          <button className="choice" onClick={() => { haptic.tap(); unlockAudio(); setStep('biz'); }}>
            <span className="e">🏪</span><span className="grow"><b>Configurar el negocio</b><small>Primer teléfono (el de la dueña o el del trailer)</small></span><span>›</span>
          </button>
          <button className="choice" onClick={() => { haptic.tap(); unlockAudio(); setStep('join'); }}>
            <span className="e">📲</span><span className="grow"><b>Unirme a un negocio</b><small>Ya hay otro teléfono con Prenzao: escanea su QR</small></span><span>›</span>
          </button>
        </>
      )}

      {step === 'biz' && (
        <>
          <h1 className="onb-title">¿Cómo se llama<br />el negocio?</h1>
          <input className="input" style={{ fontSize: 22, minHeight: 62 }} autoFocus value={biz} onChange={(e) => setBiz(e.target.value)} />
          <div className="grow" />
          <button className="btn btn-go btn-block btn-xl" disabled={!biz.trim()} onClick={() => setStep('me')}>Seguir</button>
        </>
      )}

      {step === 'me' && (
        <>
          <h1 className="onb-title">¿Y tú quién eres?</h1>
          <div style={{ display: 'grid', justifyItems: 'center' }}><Avatar p={{ emoji: meEmoji, color: COL[0], name: me }} size={96} /></div>
          <input className="input" style={{ fontSize: 20 }} autoFocus placeholder="Tu nombre" value={me} onChange={(e) => setMe(e.target.value)} />
          <div className="emoji-pick">{EMO.map((e) => <button key={e} className={meEmoji === e ? 'on' : ''} onClick={() => { haptic.tap(); setMeEmoji(e); }}>{e}</button>)}</div>
          <div className="grow" />
          <button className="btn btn-go btn-block btn-xl" disabled={!me.trim()} onClick={() => setStep('team')}>Seguir</button>
        </>
      )}

      {step === 'team' && (
        <>
          <h1 className="onb-title">¿Quién más trabaja contigo?</h1>
          <p className="onb-sub">Solo el nombre. Todos pueden usar todas las vistas: el que cocina también cobra cuando el otro sale a domicilio.</p>
          <div className="people" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
            {team.map((t, i) => (
              <button key={i} className="person" onClick={() => setTeam(team.filter((_, j) => j !== i))}><Avatar p={{ ...t, color: COL[(i + 1) % COL.length] }} size={52} /><b style={{ fontSize: 15 }}>{t.name}</b><small>tocar para quitar</small></button>
            ))}
          </div>
          <div className="row">
            <input className="input" placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newName.trim() && (setTeam([...team, { name: newName.trim(), emoji: EMO[(team.length + 1) % EMO.length] }]), setNewName(''))} />
            <button className="btn btn-ink" disabled={!newName.trim()} onClick={() => { haptic.tap(); sfx.pop(team.length + 1); setTeam([...team, { name: newName.trim(), emoji: EMO[(team.length + 1) % EMO.length] }]); setNewName(''); }}>＋</button>
          </div>
          <div className="grow" />
          <button className="btn btn-go btn-block btn-xl" onClick={() => setStep('goal')}>{team.length ? 'Seguir' : 'Lo hago después'}</button>
        </>
      )}

      {step === 'goal' && (
        <>
          <h1 className="onb-title">¿Cuánto quieren vender en un buen día?</h1>
          <p className="onb-sub">Aparece como un anillo que se va llenando. Al 50% y al 100% lo celebramos 🎉 (SUPUESTO inicial, lo cambias cuando quieras).</p>
          <Field label="Meta diaria"><Money big value={goal} onChange={setGoal} /></Field>
          <div className="grow" />
          <button className="btn btn-go btn-block btn-xl" onClick={finishCreate}>¡Empezar! 🚀</button>
        </>
      )}
    </div>
  );
}

function Join({ joining, onJoined, onBack, onDone }: { joining: boolean; onJoined: () => void; onBack: () => void; onDone: () => void }) {
  const st = useSync();
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState('');
  const [camErr, setCamErr] = useState(false);
  const [people, setPeople] = useState(0);

  const tryCode = async (c: string) => {
    const p = parsePairCode(c);
    if (!p) return false;
    haptic.success();
    sfx.done();
    await sync.join(p.secret, p.relays, p.name);
    onJoined();
    return true;
  };

  useEffect(() => {
    if (joining) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stop || !video.current) return;
          const v = video.current;
          if (v.videoWidth) {
            canvas.width = 480;
            canvas.height = Math.round((480 * v.videoHeight) / v.videoWidth);
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r?.data && (await tryCode(r.data))) return;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamErr(true);
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [joining]);

  useEffect(() => {
    if (!joining) return;
    const t = setInterval(async () => setPeople(await db.people.count()), 600);
    return () => clearInterval(t);
  }, [joining]);

  if (joining) {
    const ready = people > 0 && st.initialDone;
    return (
      <div className="onb" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="logo-mark" style={{ margin: '0 auto', animation: ready ? 'none' : 'breathe 1s ease-in-out infinite alternate' }}>{ready ? '✓' : 'P'}</div>
        <h1 className="onb-title" style={{ fontSize: 32 }}>{ready ? '¡Conectado!' : 'Trayendo la información…'}</h1>
        <p className="onb-sub">{st.received} datos recibidos · {st.relays.filter((r) => r.ok).length} rutas activas</p>
        {!ready && st.initialDone && people === 0 && <div className="callout warn">Aún no llega nada. Revisa que el otro teléfono tenga internet y Prenzao abierto.</div>}
        <button className="btn btn-go btn-block btn-xl" disabled={!ready} onClick={async () => { await setDevice({ onboarded: true }); burst('big'); onDone(); }}>Seguir</button>
      </div>
    );
  }

  return (
    <div className="onb">
      <button className="icon-btn flat" onClick={onBack}>←</button>
      <h1 className="onb-title" style={{ fontSize: 32 }}>Escanea el QR del otro teléfono</h1>
      <p className="onb-sub">En el teléfono de la dueña: Negocio → Ajustes → Conectar otro teléfono.</p>
      {!camErr ? (
        <div className="scanner"><video ref={video} playsInline muted /><div className="scan-line" /></div>
      ) : (
        <div className="callout warn">No pude abrir la cámara. Pega el código que te mandaron por WhatsApp.</div>
      )}
      <Field label="¿O te mandaron el código?">
        <div className="row">
          <input className="input" placeholder="PZ1.…" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-ink" onClick={async () => {
            let c = code;
            if (!c) { try { c = await navigator.clipboard.readText(); setCode(c); } catch { /* noop */ } }
            if (!(await tryCode(c))) toast('Ese código no sirve. Pídelo de nuevo.', 'warn');
          }}>{code ? 'Unir' : 'Pegar'}</button>
        </div>
      </Field>
    </div>
  );
}
