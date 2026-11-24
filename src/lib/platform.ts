import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

export const haptic = {
  tap() {
    if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else navigator.vibrate?.(8);
  },
  medium() {
    if (isNative) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    else navigator.vibrate?.(15);
  },
  success() {
    if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else navigator.vibrate?.([10, 40, 10]);
  },
  warn() {
    if (isNative) Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
    else navigator.vibrate?.([30, 60, 30]);
  },
};

// ---------------- Notificaciones con sonido y burbuja ----------------
// Android solo muestra burbuja (heads-up) y suena si el canal es de importancia ALTA.
// Los canales no se pueden modificar después de creados → id versionado.
const CH_COBROS = 'cobros_v2';
const CH_PEDIDOS = 'pedidos_v2';

export async function setupNotifications(): Promise<boolean> {
  if (!isNative) return false;
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    if (platform === 'android') {
      await LocalNotifications.createChannel({
        id: CH_COBROS,
        name: 'Cobros pendientes',
        description: 'Insiste hasta que se confirme el pago',
        importance: 5,
        visibility: 1,
        sound: 'cobro.wav',
        vibration: true,
        lights: true,
        lightColor: '#FF5A1F',
      });
      await LocalNotifications.createChannel({
        id: CH_PEDIDOS,
        name: 'Pedidos',
        description: 'Pedidos nuevos y listos',
        importance: 5,
        visibility: 1,
        sound: 'campana.wav',
        vibration: true,
      });
    }
    return p.display === 'granted';
  } catch {
    return false;
  }
}

function baseId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2_000_000) * 100;
}

export async function schedulePayReminders(orderId: string, title: string, body: string, everyMin: number, count = 12) {
  if (!isNative) return;
  try {
    const id0 = baseId(orderId);
    const now = Date.now();
    await LocalNotifications.schedule({
      notifications: Array.from({ length: count }, (_, i) => ({
        id: id0 + i,
        title,
        body,
        channelId: CH_COBROS,
        smallIcon: 'ic_stat_prenzao',
        sound: 'cobro.wav',
        schedule: { at: new Date(now + everyMin * 60000 * (i + 1)), allowWhileIdle: true },
        extra: { orderId },
      })),
    });
  } catch {
    /* sin permiso: queda el recordatorio dentro de la app */
  }
}

export async function cancelPayReminders(orderId: string, count = 12) {
  if (!isNative) return;
  try {
    const id0 = baseId(orderId);
    await LocalNotifications.cancel({ notifications: Array.from({ length: count }, (_, i) => ({ id: id0 + i })) });
  } catch {
    /* noop */
  }
}

/** Aviso inmediato (pedido nuevo que llegó de otro teléfono con la app en segundo plano). */
export async function notifyNow(title: string, body: string, key: string) {
  if (!isNative || !document.hidden) return;
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: baseId(key) + 99, title, body, channelId: CH_PEDIDOS, smallIcon: 'ic_stat_prenzao', sound: 'campana.wav', schedule: { at: new Date(Date.now() + 300) } }],
    });
  } catch {
    /* noop */
  }
}

// ---------------- Voz (cocina anuncia pedidos) ----------------
export async function speak(text: string) {
  try {
    if (isNative) {
      await TextToSpeech.stop().catch(() => {});
      await TextToSpeech.speak({ text, lang: 'es-CO', rate: 1.02, pitch: 1, volume: 1, category: 'playback' });
      return;
    }
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-CO';
    const v = s.getVoices().find((x) => x.lang.startsWith('es'));
    if (v) u.voice = v;
    u.rate = 1.03;
    s.speak(u);
  } catch {
    /* noop */
  }
}

// ---------------- Compartir hacia Prenzao (WhatsApp → Compartir → Prenzao) ----------------
interface ShareIntakePlugin {
  getPending(): Promise<{ text?: string }>;
  addListener(ev: 'shared', fn: (d: { text: string }) => void): Promise<PluginListenerHandle>;
}
const ShareIntake = registerPlugin<ShareIntakePlugin>('ShareIntake');

export function onSharedText(fn: (text: string) => void): () => void {
  if (platform !== 'android') return () => {};
  let handle: PluginListenerHandle | null = null;
  ShareIntake.getPending()
    .then((r) => r.text && fn(r.text))
    .catch(() => {});
  ShareIntake.addListener('shared', (d) => d.text && fn(d.text))
    .then((h) => (handle = h))
    .catch(() => {});
  return () => handle?.remove();
}

/** Abre el menú de compartir del sistema (para responder en el chat de WhatsApp sin tener el número). */
export async function shareText(text: string) {
  try {
    if (isNative) await Share.share({ text });
    else if (navigator.share) await navigator.share({ text });
    else await navigator.clipboard.writeText(text);
  } catch {
    /* cancelado */
  }
}

export function openWhatsApp(phone: string | undefined, text: string) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) digits = '57' + digits;
  if (!digits) return shareText(text);
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank');
}

export function openMaps(address: string) {
  const q = encodeURIComponent(`${address}, Bogotá, Colombia`);
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
}

export function call(phone: string) {
  window.open(`tel:${phone.replace(/\D/g, '')}`, '_self');
}

// ---------------- Archivos ----------------
export async function saveTextFile(filename: string, content: string, mime: string) {
  if (isNative) {
    const res = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, url: res.uri, dialogTitle: 'Guardar o enviar' });
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------- Pantalla siempre encendida (cocina) ----------------
let wakeLock: { release: () => Promise<void> } | null = null;
export async function keepAwake(on: boolean) {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* noop */
  }
}
