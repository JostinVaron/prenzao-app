// Sonidos sintetizados en vivo (sin archivos): cortos, cálidos y con "premio".
// Refuerzo inmediato = la gente siente que la app responde y le dan ganas de usarla.

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Desbloquea el audio en el primer toque (iOS/Android lo exigen). */
export function unlockAudio() {
  ac();
}

function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** agregar producto: "pop" que sube de tono con la cantidad */
  pop(n = 1) {
    const f = 520 * Math.pow(1.06, Math.min(n - 1, 12));
    tone(f, 0, 0.09, { type: 'triangle', gain: 0.16, slideTo: f * 1.5 });
  },
  remove() {
    tone(420, 0, 0.08, { type: 'triangle', gain: 0.12, slideTo: 300 });
  },
  tick() {
    tone(1400, 0, 0.03, { type: 'square', gain: 0.03 });
  },
  /** cobro: caja registradora brillante */
  cash() {
    tone(1318.5, 0, 0.16, { type: 'triangle', gain: 0.16 });
    tone(1760, 0.07, 0.32, { type: 'triangle', gain: 0.16 });
    tone(2637, 0.07, 0.25, { gain: 0.05 });
  },
  /** pedido nuevo en cocina: campana */
  bell() {
    [0, 0.42].forEach((s) => {
      tone(880, s, 1.1, { gain: 0.16 });
      tone(1318.5, s, 0.9, { gain: 0.08 });
      tone(2217, s, 0.5, { gain: 0.03 });
    });
  },
  /** listo / entregado: arpegio ascendente */
  done() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.065, 0.22, { type: 'triangle', gain: 0.13 }));
  },
  /** meta alcanzada / caja cuadrada */
  fanfare() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.09, 0.4, { type: 'triangle', gain: 0.14 }));
    tone(1568, 0.5, 0.7, { gain: 0.08 });
  },
  warn() {
    tone(392, 0, 0.18, { type: 'square', gain: 0.06 });
    tone(330, 0.2, 0.25, { type: 'square', gain: 0.06 });
  },
};
