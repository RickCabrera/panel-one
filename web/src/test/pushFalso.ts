import { vi } from 'vitest';

/**
 * Un navegador con push FALSO (F2-146): `navigator.serviceWorker`, `PushManager` y
 * `Notification`, controlables desde el test. jsdom no trae ninguno de los tres.
 */

export const ENDPOINT_FALSO = 'https://fcm.googleapis.com/fcm/send/navegador-de-prueba';
export const LLAVES_FALSAS = { p256dh: 'BPp256dh-sintetica', auth: 'auth-sintetica' };

export interface OpcionesPushFalso {
  /** Permiso actual del sitio. */
  permiso?: NotificationPermission;
  /** Lo que contesta `requestPermission()`. */
  respuestaPermiso?: NotificationPermission;
  /** false = no hay service worker registrado (modo desarrollo). */
  conRegistro?: boolean;
  /** Suscripción previa, con la llave de servidor dada (bytes). */
  suscritaCon?: Uint8Array | null;
}

export function instalarPushFalso(o: OpcionesPushFalso = {}) {
  let permiso: NotificationPermission = o.permiso ?? 'default';
  const bajas: string[] = [];

  function crearSuscripcion(clave: Uint8Array) {
    const s = {
      endpoint: ENDPOINT_FALSO,
      options: { applicationServerKey: clave.slice().buffer },
      toJSON: () => ({ endpoint: ENDPOINT_FALSO, keys: { ...LLAVES_FALSAS } }),
      unsubscribe: vi.fn(async () => {
        bajas.push(ENDPOINT_FALSO);
        estado.suscripcion = null;
        return true;
      }),
    };
    return s;
  }

  const estado = {
    suscripcion: o.suscritaCon ? crearSuscripcion(o.suscritaCon) : null,
  } as { suscripcion: ReturnType<typeof crearSuscripcion> | null };

  const pushManager = {
    getSubscription: vi.fn(async () => estado.suscripcion),
    subscribe: vi.fn(async (op: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => {
      estado.suscripcion = crearSuscripcion(op.applicationServerKey);
      return estado.suscripcion;
    }),
  };
  const registro = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => (o.conRegistro === false ? undefined : registro)),
    register: vi.fn(async () => registro),
  };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    get permission() {
      return permiso;
    },
    requestPermission: vi.fn(async () => {
      permiso = o.respuestaPermiso ?? 'granted';
      return permiso;
    }),
  });

  return { estado, pushManager, serviceWorker, bajas };
}

/** Quita lo que `instalarPushFalso` puso en `navigator` (lo demás lo quita `unstubAllGlobals`). */
export function quitarPushFalso(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
}
