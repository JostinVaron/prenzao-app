// Reloj lógico híbrido (HLC): ordena cambios de varios teléfonos aunque sus relojes difieran.
// Formato comparable como texto: "<ms 13 dígitos>:<contador base36 4>:<dispositivo>"

let last = 0;
let counter = 0;
let node = 'local';

export function setHlcNode(id: string) {
  node = id.slice(0, 8);
}

export function hlcNow(): string {
  const now = Date.now();
  if (now > last) {
    last = now;
    counter = 0;
  } else {
    counter++;
  }
  return `${String(last).padStart(13, '0')}:${counter.toString(36).padStart(4, '0')}:${node}`;
}

/** Al recibir un cambio remoto, avanzamos nuestro reloj para no quedar "atrás". */
export function hlcObserve(remote?: string) {
  if (!remote) return;
  const ms = Number(remote.slice(0, 13));
  const c = parseInt(remote.slice(14, 18), 36) || 0;
  if (ms > last) {
    last = ms;
    counter = c + 1;
  } else if (ms === last && c >= counter) {
    counter = c + 1;
  }
}

export function hlcMax(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
