import { ErrorApi, pedir } from '../api/cliente';
import type { NotificacionesCuenta, RegistrarDispositivo } from '../api/tipos';

/**
 * El push en ESTE navegador (F2-146): suscribirlo, darlo de baja y renovarlo. Las
 * preferencias (qué avisos) son del usuario y valen en todos sus navegadores; esto es sólo
 * si este dispositivo los recibe.
 *
 * Todo lee `navigator`/`Notification` al llamarse (no al importar), para que los tests los
 * sustituyan.
 */

export type EstadoDispositivo =
  /** El navegador no tiene push (o iPhone sin instalar el panel en la pantalla de inicio). */
  | 'sin-soporte'
  /** No hay service worker registrado (modo desarrollo, o todavía no termina de instalarse). */
  | 'sin-service-worker'
  /** El usuario bloqueó las notificaciones de este sitio. */
  | 'bloqueado'
  | 'inactivo'
  | 'activo';

export function hayPush(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!hayPush()) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

export async function suscripcionActual(): Promise<PushSubscription | null> {
  const r = await registro();
  return r ? r.pushManager.getSubscription() : null;
}

export async function estadoDispositivo(): Promise<EstadoDispositivo> {
  if (!hayPush()) return 'sin-soporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  const r = await registro();
  if (!r) return 'sin-service-worker';
  const s = await r.pushManager.getSubscription();
  return s && Notification.permission === 'granted' ? 'activo' : 'inactivo';
}

/** Llave VAPID base64url → bytes, como la pide `pushManager.subscribe`. */
export function llaveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

function mismaLlave(s: PushSubscription, clave: Uint8Array): boolean {
  const actual = s.options.applicationServerKey;
  if (!actual) return false;
  const a = new Uint8Array(actual);
  return a.length === clave.length && a.every((b, i) => b === clave[i]);
}

function cuerpo(s: PushSubscription): RegistrarDispositivo {
  const json = s.toJSON();
  return {
    endpoint: s.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/**
 * Pide permiso, suscribe este navegador con la llave del servidor y lo registra en el api.
 * Si ya estaba suscrito con OTRA llave (el servidor cambió sus VAPID), se re-suscribe.
 */
export async function activarEnEsteDispositivo(
  clavePublica: string,
): Promise<NotificacionesCuenta> {
  const r = await registro();
  if (!r) throw new Error('Este navegador todavía no tiene lista la app. Recarga la página.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error(
      permiso === 'denied'
        ? 'Bloqueaste las notificaciones. Permítelas en la configuración del sitio y vuelve a intentar.'
        : 'No se dio permiso para mostrar notificaciones.',
    );
  }
  const clave = llaveABytes(clavePublica);
  let s = await r.pushManager.getSubscription();
  if (s && !mismaLlave(s, clave)) {
    await s.unsubscribe();
    s = null;
  }
  s ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
  return pedir<NotificacionesCuenta>('/cuenta/notificaciones/dispositivos', {
    method: 'POST',
    body: cuerpo(s),
  });
}

/**
 * Da de baja este navegador: primero en el api (para que no se le mande nada más) y luego
 * en el navegador. Un 404 del api = ya no estaba registrado a este usuario: se sigue.
 */
export async function desactivarEnEsteDispositivo(): Promise<void> {
  const s = await suscripcionActual();
  if (!s) return;
  try {
    await pedir<NotificacionesCuenta>('/cuenta/notificaciones/dispositivos', {
      method: 'DELETE',
      body: { endpoint: s.endpoint },
    });
  } catch (error) {
    if (!(error instanceof ErrorApi && error.status === 404)) throw error;
  }
  await s.unsubscribe();
}

/**
 * Renueva el registro de este navegador (cada vez que el panel abre con sesión): un
 * navegador que no se renueva en 7 días, o de antes de un cambio de contraseña, deja de
 * recibir. Silencioso: si falla, no pasa nada visible.
 */
export async function renovarEsteDispositivo(): Promise<void> {
  try {
    if (!hayPush() || Notification.permission !== 'granted') return;
    const s = await suscripcionActual();
    if (!s) return;
    await pedir<NotificacionesCuenta>('/cuenta/notificaciones/dispositivos', {
      method: 'POST',
      body: cuerpo(s),
    });
  } catch {
    // Best-effort.
  }
}

/** Tope para no dejar "Salir" colgado si la red no contesta. */
export const TOPE_DESVINCULAR_MS = 3000;

/**
 * Al cerrar sesión: este navegador deja de recibir los avisos de ESTE usuario (el siguiente
 * que entre en el mismo navegador no los ve). Best-effort y con tope de tiempo.
 */
export async function desvincularAlSalir(): Promise<void> {
  try {
    await Promise.race([
      desactivarEnEsteDispositivo(),
      new Promise((listo) => setTimeout(listo, TOPE_DESVINCULAR_MS)),
    ]);
  } catch {
    // Best-effort: salir nunca falla por esto.
  }
}
