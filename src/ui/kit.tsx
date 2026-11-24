import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../lib/platform';
import { sfx } from '../lib/sound';
import type { Person } from '../lib/types';

// ---------------- Botón "atrás" de Android ----------------
type BackFn = () => void;
const backStack: { id: number; fn: BackFn }[] = [];
let backSeq = 0;

export function useBack(active: boolean, fn: BackFn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = ++backSeq;
    backStack.push({ id, fn: () => ref.current() });
    return () => {
      const i = backStack.findIndex((b) => b.id === id);
      if (i >= 0) backStack.splice(i, 1);
    };
  }, [active]);
}

export function popBack(): boolean {
  const top = backStack[backStack.length - 1];
  if (!top) return false;
  top.fn();
  return true;
}

// ---------------- Hoja inferior ----------------
export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  full,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  dismissable?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const y0 = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setDrag(0);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 230);
      return () => clearTimeout(t);
    }
  }, [open]);

  useBack(open, () => dismissable && onClose());
  if (!mounted) return null;

  return createPortal(
    <div className={`sheet-root ${closing ? 'closing' : ''}`}>
      <div className="sheet-backdrop" onClick={() => dismissable && onClose()} />
      <div className={`sheet ${full ? 'full' : ''}`} style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined} role="dialog">
        <div
          className="sheet-grab"
          onPointerDown={(e) => {
            if (!dismissable) return;
            y0.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => y0.current != null && setDrag(Math.max(0, e.clientY - y0.current))}
          onPointerUp={() => {
            if (y0.current == null) return;
            y0.current = null;
            if (drag > 110) onClose();
            else setDrag(0);
          }}
        >
          <div className="sheet-handle" />
          {(title || dismissable) && (
            <div className="sheet-head">
              <div>
                {title && <h2 className="sheet-title">{title}</h2>}
                {sub && <div className="sheet-sub">{sub}</div>}
              </div>
              {dismissable && (
                <button className="x-btn" aria-label="Cerrar" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Segmentado ----------------
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" style={{ ['--n' as string]: options.length, ['--i' as string]: i }}>
      <div className="seg-thumb" />
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          onClick={() => {
            if (o.value !== value) {
              haptic.tap();
              sfx.tick();
            }
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Toast ----------------
type T = { id: number; text: string; tone?: 'ok' | 'warn' };
let push: ((t: T) => void) | null = null;
let seq = 0;
export function toast(text: string, tone: 'ok' | 'warn' = 'ok') {
  push?.({ id: ++seq, text, tone });
}
export function Toasts() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((p) => [...p, t]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), 2600);
    };
    return () => {
      push = null;
    };
  }, []);
  return createPortal(
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'warn' ? 'warn' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------------- Campos ----------------
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Money({ value, onChange, big, autoFocus, placeholder = '0' }: { value: number; onChange: (n: number) => void; big?: boolean; autoFocus?: boolean; placeholder?: string }) {
  return (
    <div className={`money ${big ? 'big' : ''}`}>
      <span>$</span>
      <input inputMode="numeric" autoFocus={autoFocus} placeholder={placeholder} value={value ? value.toLocaleString('es-CO') : ''} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
    </div>
  );
}

export function Chips<V extends string>({ value, options, onChange, small }: { value?: V; options: V[]; onChange: (v: V) => void; small?: boolean }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${small ? 'sm' : ''} ${value === o ? 'on' : ''}`}
          onClick={() => {
            haptic.tap();
            onChange(o);
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="stepper">
      <button onClick={() => { haptic.tap(); onChange(Math.max(min, value - 1)); }} aria-label="Menos">−</button>
      <span>{value}</span>
      <button onClick={() => { haptic.tap(); onChange(value + 1); }} aria-label="Más">+</button>
    </div>
  );
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <b>{title}</b>
      {text && <p>{text}</p>}
    </div>
  );
}

export function Avatar({ p, size = 40 }: { p?: Pick<Person, 'emoji' | 'color' | 'name'>; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size, ['--c' as string]: p?.color ?? '#8c8178' }}>
      <span>{p?.emoji ?? '🙂'}</span>
    </div>
  );
}

/** Anillo de progreso (meta del día). */
export function Ring({ value, size = 64, stroke = 8, color = '#ff4d1c', track = 'rgba(255,255,255,.14)', children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.32,.72,0,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  );
}

// ---------------- PIN ----------------
export function PinPad({ title, sub, onDone, onCancel, check }: { title: string; sub?: string; onDone: (pin: string) => void; onCancel?: () => void; check?: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const press = async (d: string) => {
    haptic.tap();
    sfx.tick();
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      if (check && !(await check(next))) {
        haptic.warn();
        sfx.warn();
        setErr(true);
        setTimeout(() => {
          setErr(false);
          setPin('');
        }, 450);
        return;
      }
      onDone(next);
      setPin('');
    }
  };
  return (
    <div>
      <div className="center" style={{ marginBottom: 4 }}>
        <div className="sheet-title">{title}</div>
        {sub && <div className="sheet-sub">{sub}</div>}
      </div>
      <div className={`pin-dots ${err ? 'err' : ''}`}>{[0, 1, 2, 3].map((i) => <i key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button className="ghost" onClick={onCancel}>{onCancel ? 'Cancelar' : ''}</button>
        <button onClick={() => press('0')}>0</button>
        <button className="ghost" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
      </div>
    </div>
  );
}

export function PromptSheet({ open, title, sub, quick, placeholder, confirm, danger, onOk, onClose }: { open: boolean; title: string; sub?: string; quick?: string[]; placeholder?: string; confirm: string; danger?: boolean; onOk: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={title} sub={sub} footer={<button className={`btn btn-block btn-xl ${danger ? 'btn-danger' : 'btn-go'}`} disabled={!v.trim()} onClick={() => onOk(v.trim())}>{confirm}</button>}>
      {quick && <div style={{ marginBottom: 12 }}><Chips value={v} options={quick} onChange={setV} /></div>}
      <input className="input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
    </Sheet>
  );
}
