import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { ClipboardList, LayoutGrid, Receipt, ShoppingBag, ChartNoAxesColumn } from 'lucide-react';
import { db, ensureSeed } from './lib/db';
import { ensureNotifPermission, haptic, isNative, platform } from './lib/platform';
import { popBack, ToastHost } from './components/ui';
import { Nudges } from './components/Nudges';
import { Vender, type CartState } from './screens/Vender';
import { Pedidos } from './screens/Pedidos';
import { Gastos } from './screens/Gastos';
import { Hoy } from './screens/Hoy';
import { Mas } from './screens/Mas';

type Tab = 'vender' | 'pedidos' | 'gastos' | 'hoy' | 'mas';

const CART_KEY = 'prenzao.cart';

function loadCart(): CartState {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { channel: 'mostrador', items: [] };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('vender');
  const [cart, setCartState] = useState<CartState>(loadCart);
  const tabRef = useRef<Tab>('vender');

  const setCart = (c: CartState) => {
    setCartState(c);
    try { sessionStorage.setItem(CART_KEY, JSON.stringify(c)); } catch { /* noop */ }
  };

  useEffect(() => {
    ensureSeed().then(() => setReady(true));
    if (isNative) {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      ensureNotifPermission();
    }
    if (platform === 'android') document.documentElement.classList.add('android');
  }, []);

  // Botón "atrás" de Android: cierra hojas → vuelve a Vender → minimiza (nunca cierra la app)
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('backButton', () => {
      if (popBack()) return;
      if (tabRef.current !== 'vender') setTab('vender');
      else CapApp.minimizeApp();
    });
    return () => { h.then((x) => x.remove()); };
  }, []);
  tabRef.current = tab;

  const activeCount = useLiveQuery(() => db.orders.where('status').anyOf('preparando', 'listo', 'enviado').count(), []) ?? 0;
  const dueCount = useLiveQuery(async () => (await db.orders.where('payStatus').equals('pendiente').toArray()).filter((o) => o.status !== 'cancelado').length, []) ?? 0;

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  if (!ready) return <div className="boot"><div className="boot-logo">P</div></div>;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number; red?: boolean }[] = [
    { id: 'vender', label: 'Vender', icon: <ShoppingBag size={23} /> },
    { id: 'pedidos', label: 'Pedidos', icon: <ClipboardList size={23} />, badge: activeCount || dueCount, red: dueCount > 0 },
    { id: 'gastos', label: 'Gastos', icon: <Receipt size={23} /> },
    { id: 'hoy', label: 'Hoy', icon: <ChartNoAxesColumn size={23} /> },
    { id: 'mas', label: 'Más', icon: <LayoutGrid size={23} /> },
  ];

  return (
    <div className="app">
      <main className="content" key={tab}>
        {tab === 'vender' && <Vender cart={cart} setCart={setCart} />}
        {tab === 'pedidos' && <Pedidos />}
        {tab === 'gastos' && <Gastos />}
        {tab === 'hoy' && <Hoy />}
        {tab === 'mas' && <Mas />}
      </main>

      <nav className="tabbar">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => { if (tab !== t.id) haptic.tap(); setTab(t.id); }}>
            <span className="tab-ico">
              {t.icon}
              {t.badge ? <b className={`tab-badge ${t.red ? 'red' : ''}`}>{t.badge}</b> : null}
            </span>
            <span className="tab-lbl">{t.label}</span>
          </button>
        ))}
      </nav>

      <Nudges />
      <ToastHost />
    </div>
  );
}
