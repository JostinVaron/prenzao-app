import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

export const haptic = {
  tap() {
    if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else navigator.vibrate?.(8);
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

// ---------- Notificaciones locales (sobreviven aunque la app esté cerrada) ----------

/** id entero estable a partir del uuid del pedido */
function baseId(orderId: string): number {
  let h = 0;
  for (let i = 0; i < orderId.length; i++) h = (h * 31 + orderId.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2_000_000) * 100;
}

export async function ensureNotifPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    return p.display === 'granted';
  } catch {
    return false;
  }
}

/** Programa N recordatorios de cobro cada `everyMin` minutos. Se cancelan al cobrar. */
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

// ---------- Archivos: exportar respaldo / CSV ----------

export async function saveTextFile(filename: string, content: string, mime: string) {
  if (isNative) {
    const res = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
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

export function openWhatsApp(phone: string, text: string) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '57' + digits; // celular colombiano
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}
