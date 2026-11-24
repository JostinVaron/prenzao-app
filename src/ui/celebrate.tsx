import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import { sfx } from '../lib/sound';
import { haptic } from '../lib/platform';

export function burst(power: 'small' | 'big' = 'small') {
  const colors = ['#ff4d1c', '#ff7a1a', '#ffb800', '#149a57', '#ffffff'];
  if (power === 'small') {
    confetti({ particleCount: 60, spread: 70, startVelocity: 38, origin: { y: 0.7 }, colors, ticks: 140, scalar: 0.9, disableForReducedMotion: true });
  } else {
    const end = Date.now() + 900;
    (function frame() {
      confetti({ particleCount: 7, angle: 60, spread: 60, origin: { x: 0, y: 0.75 }, colors, disableForReducedMotion: true });
      confetti({ particleCount: 7, angle: 120, spread: 60, origin: { x: 1, y: 0.75 }, colors, disableForReducedMotion: true });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }
}

type Celebration = { title: ReactNode; sub?: ReactNode; extra?: ReactNode; big?: boolean; icon?: string; stay?: boolean };
let show: ((c: Celebration) => void) | null = null;

/** Momento de premio: check gigante + sonido + confeti. Se cierra solo. */
export function celebrate(c: Celebration) {
  show?.(c);
}

export function CelebrationHost() {
  const [c, setC] = useState<Celebration | null>(null);
  useEffect(() => {
    show = (x) => {
      setC(x);
      haptic.success();
      if (x.big) {
        sfx.fanfare();
        burst('big');
      } else {
        sfx.cash();
        burst('small');
      }
    };
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!c || c.stay) return;
    const t = setTimeout(() => setC(null), c.extra ? 2600 : 1500);
    return () => clearTimeout(t);
  }, [c]);
  if (!c) return null;
  return createPortal(
    <div className="celebrate" onClick={() => setC(null)}>
      <div className="celebrate-bg" />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="big-check">{c.icon ?? '✓'}</div>
        <div className="celebrate-num">{c.title}</div>
        {c.sub && <div className="celebrate-sub">{c.sub}</div>}
        {c.extra}
        <button className="btn btn-soft btn-block" onClick={() => setC(null)}>Seguir</button>
      </div>
    </div>,
    document.body,
  );
}
