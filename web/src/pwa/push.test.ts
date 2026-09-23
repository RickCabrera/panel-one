import { afterEach, describe, expect, it, vi } from 'vitest';

import { terminarSesion } from '../auth/sesion';
import { instalarApiFalsa, json } from '../test/apiFalsa';
import {
  ENDPOINT_FALSO,
  instalarPushFalso,
  LLAVES_FALSAS,
  quitarPushFalso,
} from '../test/pushFalso';
import {
  activarEnEsteDispositivo,
  desactivarEnEsteDispositivo,
  desvincularAlSalir,
  estadoDispositivo,
  llaveABytes,
  renovarEsteDispositivo,
  TOPE_DESVINCULAR_MS,
} from './push';
import { registrarServiceWorker } from './registrar';

// F2-146: el push de ESTE navegador (suscribir, dar de baja, renovar) con un navegador falso.

const CLAVE =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const OTRA =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const VISTA = {
  clavePublica: CLAVE,
  preferencias: {
    mesaAbierta: false,
    sucursalSinReporte: true,
    foliosBajo: false,
    cierreDia: false,
  },
  disponibles: ['mesa_abierta', 'sucursal_sin_reporte', 'cierre_dia'],
  dispositivos: 1,
};

afterEach(() => {
  quitarPushFalso();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  terminarSesion('cerrada');
});

describe('llaveABytes', () => {
  it('base64url sin relleno → los 65 bytes de una llave P-256 (0x04…)', () => {
    const b = llaveABytes(CLAVE);
    expect(b).toHaveLength(65);
    expect(b[0]).toBe(4);
  });
});

describe('estado de este dispositivo', () => {
  it('sin push en el navegador (jsdom, iPhone sin instalar)', async () => {
    expect(await estadoDispositivo()).toBe('sin-soporte');
  });

  it('bloqueado, sin service worker, inactivo y activo', async () => {
    instalarPushFalso({ permiso: 'denied' });
    expect(await estadoDispositivo()).toBe('bloqueado');
    quitarPushFalso();
    instalarPushFalso({ conRegistro: false });
    expect(await estadoDispositivo()).toBe('sin-service-worker');
    quitarPushFalso();
    instalarPushFalso();
    expect(await estadoDispositivo()).toBe('inactivo');
    quitarPushFalso();
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    expect(await estadoDispositivo()).toBe('activo');
  });
});

describe('activar', () => {
  it('pide permiso, suscribe con la llave del servidor y registra la suscripción en el api', async () => {
    const nav = instalarPushFalso();
    const api = instalarApiFalsa({
      'POST /cuenta/notificaciones/dispositivos': () => json(200, VISTA),
    });
    expect(await activarEnEsteDispositivo(CLAVE)).toEqual(VISTA);
    expect(nav.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: llaveABytes(CLAVE),
    });
    expect(api.llamadas.at(-1)!.cuerpo).toEqual({ endpoint: ENDPOINT_FALSO, keys: LLAVES_FALSAS });
  });

  it('permiso denegado: no suscribe ni llama al api, y dice qué hacer', async () => {
    const nav = instalarPushFalso({ respuestaPermiso: 'denied' });
    const api = instalarApiFalsa();
    await expect(activarEnEsteDispositivo(CLAVE)).rejects.toThrow(/Bloqueaste las notificaciones/);
    expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.llamadas).toHaveLength(0);
  });

  it('suscrito con OTRA llave (el servidor cambió sus VAPID): se re-suscribe', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(OTRA) });
    instalarApiFalsa({ 'POST /cuenta/notificaciones/dispositivos': () => json(200, VISTA) });
    await activarEnEsteDispositivo(CLAVE);
    expect(nav.bajas).toEqual([ENDPOINT_FALSO]);
    expect(nav.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('suscrito con la MISMA llave: reusa la suscripción', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    instalarApiFalsa({ 'POST /cuenta/notificaciones/dispositivos': () => json(200, VISTA) });
    await activarEnEsteDispositivo(CLAVE);
    expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    expect(nav.bajas).toEqual([]);
  });
});

describe('desactivar, renovar y salir', () => {
  it('desactivar: primero el api (DELETE con el endpoint), después el navegador', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    const api = instalarApiFalsa({
      'DELETE /cuenta/notificaciones/dispositivos': () => {
        expect(nav.bajas).toEqual([]); // el navegador todavía no se da de baja
        return json(200, { ...VISTA, dispositivos: 0 });
      },
    });
    await desactivarEnEsteDispositivo();
    expect(api.llamadas.at(-1)!.cuerpo).toEqual({ endpoint: ENDPOINT_FALSO });
    expect(nav.bajas).toEqual([ENDPOINT_FALSO]);
  });

  it('desactivar con 404 del api (ya no era de este usuario): igual se da de baja aquí', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    instalarApiFalsa();
    await desactivarEnEsteDispositivo();
    expect(nav.bajas).toEqual([ENDPOINT_FALSO]);
  });

  it('desactivar con otro error: NO se da de baja en el navegador (y lo dice)', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    instalarApiFalsa({
      'DELETE /cuenta/notificaciones/dispositivos': () => json(500, { message: 'caído' }),
    });
    await expect(desactivarEnEsteDispositivo()).rejects.toThrow();
    expect(nav.bajas).toEqual([]);
  });

  it('renovar: con permiso y suscripción vuelve a registrar; sin ellos no llama a nadie', async () => {
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    const api = instalarApiFalsa({
      'POST /cuenta/notificaciones/dispositivos': () => json(200, VISTA),
    });
    await renovarEsteDispositivo();
    expect(api.contar('POST', '/cuenta/notificaciones/dispositivos')).toBe(1);
    quitarPushFalso();
    instalarPushFalso({ permiso: 'default' });
    await renovarEsteDispositivo();
    expect(api.contar('POST', '/cuenta/notificaciones/dispositivos')).toBe(1);
  });

  it('renovar nunca lanza (best-effort)', async () => {
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    instalarApiFalsa({ 'POST /cuenta/notificaciones/dispositivos': () => json(500, {}) });
    await expect(renovarEsteDispositivo()).resolves.toBeUndefined();
  });

  it('al salir: si el api no contesta, no se queda colgado más del tope', async () => {
    vi.useFakeTimers();
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    instalarApiFalsa({
      'DELETE /cuenta/notificaciones/dispositivos': () => new Promise<Response>(() => {}),
    });
    const salida = desvincularAlSalir();
    await vi.advanceTimersByTimeAsync(TOPE_DESVINCULAR_MS);
    await expect(salida).resolves.toBeUndefined();
  });
});

describe('registrarServiceWorker', () => {
  function ventana(readyState: DocumentReadyState) {
    const oyentes: Array<() => void> = [];
    return {
      win: {
        document: { readyState },
        addEventListener: (_: string, f: () => void) => oyentes.push(f),
      } as unknown as Parameters<typeof registrarServiceWorker>[2],
      cargar: () => oyentes.forEach((f) => f()),
    };
  }

  it('en desarrollo no registra nada', () => {
    const nav = instalarPushFalso();
    const { win } = ventana('complete');
    registrarServiceWorker(false, navigator, win);
    expect(nav.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('en producción registra /sw.js con alcance "/" al terminar de cargar', () => {
    const nav = instalarPushFalso();
    const { win, cargar } = ventana('loading');
    registrarServiceWorker(true, navigator, win);
    expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    cargar();
    expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('sin service worker en el navegador: no truena', () => {
    const { win } = ventana('complete');
    expect(() => registrarServiceWorker(true, navigator, win)).not.toThrow();
  });
});
