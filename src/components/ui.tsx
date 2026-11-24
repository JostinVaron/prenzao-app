import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../lib/platform';

// ---------------- Pila de "atrás" (botón físico de Android) ----------------
type BackFn = () => void;
const backStack: { id: number; fn: BackFn }[] = [];
let backSeq = 0;

export function useBackHandler(active: boolean, fn: BackFn) {
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

/** Devuelve true si algo consumió el "atrás". */
export function popBack(): boolean {
  const top = backStack[backStack.length - 1];
  if (!top) return false;
  top.fn();
  return true;
}

// ---------------- Bottom sheet estilo iOS ----------------
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  dismissable?: boolean;
}

export function Sheet({ open, onClose, title, subtitle, children, footer, full, dismissable = true }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

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
      }, 240);
      return () => clearTimeout(t);
    }
  }, [open]);

  useBackHandler(open, () => dismissable && onClose());

  if (!mounted) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!dismissable) return;
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onPointerUp = () => {
    if (startY.current == null) return;
    startY.current = null;
    if (drag > 110) onClose();
    else setDrag(0);
  };

  return createPortal(
    <div className={`sheet-root ${closing ? 'closing' : ''}`}>
      <div className="sheet-backdrop" onClick={() => dismissable && onClose()} />
      <div
        className={`sheet ${full ? 'sheet-full' : ''}`}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="sheet-handle" />
          {(title || dismissable) && (
            <div className="sheet-head">
              <div>
                {title && <h2 className="sheet-title">{title}</h2>}
                {subtitle && <div className="sheet-sub">{subtitle}</div>}
              </div>
              {dismissable && (
                <button className="icon-btn" aria-label="Cerrar" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
                  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
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

// ---------------- Control segmentado ----------------
interface SegProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: 'md' | 'lg';
}
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: SegProps<T>) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`seg seg-${size}`} style={{ ['--n' as string]: options.length, ['--i' as string]: idx }}>
      <div className="seg-thumb" />
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg-opt ${o.value === value ? 'on' : ''}`}
          onClick={() => {
            if (o.value !== value) haptic.tap();
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
type ToastMsg = { id: number; text: string; tone?: 'ok' | 'warn' };
let toastListener: ((t: ToastMsg) => void) | null = null;
let toastSeq = 0;
export function toast(text: string, tone: 'ok' | 'warn' = 'ok') {
  toastListener?.({ id: ++toastSeq, text, tone });
}
export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    toastListener = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 2600);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return createPortal(
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
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
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Input de dinero con separador de miles, teclado numérico. */
export function MoneyInput({
  value,
  onChange,
  placeholder = '0',
  autoFocus,
  big,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  big?: boolean;
}) {
  return (
    <div className={`money-input ${big ? 'big' : ''}`}>
      <span className="money-prefix">$</span>
      <input
        inputMode="numeric"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value ? value.toLocaleString('es-CO') : ''}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
      />
    </div>
  );
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${value === o ? 'on' : ''}`}
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

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
    </div>
  );
}

// ---------------- Confirmación con motivo / PIN ----------------
export function PromptSheet({
  open,
  title,
  message,
  placeholder,
  confirmLabel,
  danger,
  quick,
  secret,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  quick?: string[];
  secret?: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <button className={`btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!text.trim()} onClick={() => onConfirm(text.trim())}>
          {confirmLabel}
        </button>
      }
    >
      {message && <p className="muted" style={{ marginTop: 0 }}>{message}</p>}
      {quick && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {quick.map((q) => (
            <button key={q} className={`chip ${text === q ? 'on' : ''}`} onClick={() => setText(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        type={secret ? 'password' : 'text'}
        inputMode={secret ? 'numeric' : undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={!quick}
      />
    </Sheet>
  );
}
