import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getDevice } from './lib/db';
import { sync } from './lib/sync/engine';
import { isNative, onSharedText, platform, setupNotifications } from './lib/platform';
import { setSoundEnabled, unlockAudio, sfx } from './lib/sound';
import { haptic } from './lib/platform';
import { useActiveOrders, useDeviceSettings, useDueOrders, useMe, useSync } from './lib/hooks';
import type { Mode, OrderItem } from './lib/types';
import { Avatar, popBack, Toasts } from './ui/kit';
import { CelebrationHost } from './ui/celebrate';
import { Announcer, Nudges } from './ui/alerts';
import { WhatsAppIntake, readClipboard } from './ui/wa';
import type { CustomerDraft } from './ui/order';
import { Onboarding } from './screens/Onboarding';
import { Who } from './screens/Who';
import { Vender, emptyCart, type Cart } from './screens/Vender';
import { Cocina } from './screens/Cocina';
import { Despacho } from './screens/Despacho';
import { Caja } from './screens/Caja';
import { Negocio } from './screens/Negocio';
import { Pedir } from './screens/Pedir';
import { toast } from './ui/kit';

const NAV: { id: Mode; label: string; icon: string }[] = [
  { id: 'vender', label: 'Vender', icon: '🛒' },
  { id: 'cocina', label: 'Cocina', icon: '🔥' },
  { id: 'despacho', label: 'Despacho', icon: '🛵' },
  { id: 'caja', label: 'Caja', icon: '💰' },
  { id: 'negocio', label: 'Negocio', icon: '📊' },
];

(window as unknown as { __pz: unknown }).__pz = { sync };

export default function App() {
  if (location.hash.includes('pedir=')) return <Pedir />;
  return <Main />;
}

function Main() {
  const [ready, setReady] = useState(false);
  const dev = useDeviceSettings();

  useEffect(() => {
    (async () => {
      await getDevice();
      if (await sync.isPaired()) sync.start();
      setReady(true);
    })();
    if (isNative) {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      setupNotifications();
    }
    if (platform === 'android') document.documentElement.classList.add('android');
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
  }, []);

  useEffect(() => setSoundEnabled(dev?.soundOn ?? true), [dev?.soundOn]);

  if (!ready || !dev) return <div className="boot"><div className="logo-mark">P</div></div>;
  if (!dev.onboarded) return <Onboarding onDone={() => {}} />;
  if (!dev.personId) return <Who onPick={() => {}} />;
  return <Shell />;
}

function Shell() {
  const me = useMe();
  const active = useActiveOrders();
  const due = useDueOrders();
  const st = useSync();
  const [mode, setMode] = useState<Mode>(me?.home ?? 'vender');
  const [who, setWho] = useState(false);
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [waText, setWaText] = useState<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const homeRef = useRef<Mode>('vender');
  homeRef.current = me?.home ?? 'vender';

  useEffect(() => { if (me?.home) setMode(me.home); }, [me?.id]);
  useEffect(() => {
    document.body.classList.toggle('theme-dark', mode === 'cocina');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', mode === 'cocina' ? '#120e0c' : '#f6f1e9');
    if (isNative) StatusBar.setStyle({ style: mode === 'cocina' ? Style.Dark : Style.Light }).catch(() => {});
    window.scrollTo(0, 0);
  }, [mode]);

  // WhatsApp → Compartir → Prenzao
  useEffect(() => onSharedText((t) => { setMode('vender'); setWaText(t); haptic.success(); sfx.pop(3); }), []);

  // tocar una notificación de cobro lleva a Caja
  useEffect(() => {
    if (!isNative) return;
    const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      if ((a.notification.title ?? '').includes('Cobro')) setMode('caja');
      else setMode('despacho');
    });
    return () => { h.then((x) => x.remove()); };
  }, []);

  // botón atrás: hojas → vista habitual → minimizar (nunca cerrar)
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('backButton', () => {
      if (popBack()) return;
      if (modeRef.current !== homeRef.current) setMode(homeRef.current);
      else CapApp.minimizeApp();
    });
    return () => { h.then((x) => x.remove()); };
  }, []);

  const paste = async () => {
    const t = await readClipboard();
    if (t) setWaText(t);
    else toast('Copia primero el mensaje del cliente en WhatsApp', 'warn');
  };
  const toCart = (items: OrderItem[], c: CustomerDraft) => {
    setCart({ channel: c.address ? 'domicilio' : 'mostrador', items, customer: c });
    setMode('vender');
  };

  const cooking = active.filter((o) => o.status === 'preparando').length;
  const ready = active.filter((o) => o.status === 'listo').length;
  const onWay = active.filter((o) => o.status === 'enviado').length;
  const okRelays = st.relays.filter((r) => r.ok).length;
  const syncCls = !st.paired ? 'off' : okRelays === 0 ? 'off' : st.pending > 0 ? 'wait' : 'on';
  const go = (m: Mode) => { if (m !== mode) { haptic.tap(); sfx.tick(); } setMode(m); };

  const nav = NAV.filter((n) => n.id !== 'negocio' || me?.owner);
  const badge: Partial<Record<Mode, { n: number; red?: boolean }>> = {
    cocina: cooking ? { n: cooking } : undefined,
    despacho: ready + onWay ? { n: ready + onWay } : undefined,
    caja: due.length ? { n: due.length, red: true } : undefined,
  };

  return (
    <div className={`shell ${mode === 'cocina' ? 'theme-dark' : ''}`}>
      <header className="pulse">
        <button className="me-btn" onClick={() => setWho(true)}>
          <Avatar p={me} size={34} />
          <span className="me-name">{me?.name.split(' ')[0] ?? '¿Quién?'}</span>
        </button>
        <div className="pulse-chips">
          {cooking > 0 && mode !== 'cocina' && <button className="pchip hot" onClick={() => go('cocina')}>🔥 <b>{cooking}</b></button>}
          {ready > 0 && mode !== 'despacho' && <button className="pchip ready" onClick={() => go('despacho')}>✅ <b>{ready}</b> listos</button>}
          {due.length > 0 && mode !== 'caja' && <button className="pchip due" onClick={() => go('caja')}>💰 <b>{due.length}</b></button>}
          <span className="pchip" title={`${okRelays}/${st.relays.length} rutas · ${st.pending} pendientes`}><span className={`sync-dot ${syncCls}`} /></span>
        </div>
      </header>

      <main key={mode}>
        {mode === 'vender' && <Vender cart={cart} setCart={setCart} onPaste={paste} />}
        {mode === 'cocina' && <Cocina />}
        {mode === 'despacho' && <Despacho />}
        {mode === 'caja' && <Caja />}
        {mode === 'negocio' && me?.owner && <Negocio />}
      </main>

      <nav className="nav">
        {nav.map((n) => (
          <button key={n.id} className={`nav-btn ${mode === n.id ? 'on' : ''}`} onClick={() => go(n.id)}>
            <span className="nav-ico">{n.icon}</span>
            <span className="nav-lbl">{n.label}</span>
            {badge[n.id] && <b className={`nav-badge ${badge[n.id]!.red ? 'red' : ''}`}>{badge[n.id]!.n}</b>}
          </button>
        ))}
      </nav>

      {who && <Who inSheet onClose={() => setWho(false)} onPick={(home) => { setWho(false); setMode(home); }} />}
      <WhatsAppIntake text={waText} onClose={() => setWaText(null)} onToCart={toCart} />
      <Announcer mode={mode} />
      <Nudges paused={!!waText || who} />
      <CelebrationHost />
      <Toasts />
    </div>
  );
}
