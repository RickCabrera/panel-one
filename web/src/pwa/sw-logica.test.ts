import { describe, expect, it, vi } from 'vitest';

import {
  crearManejadores,
  estrategia,
  INDEX,
  nombreCache,
  notificacionDePush,
  urlDestino,
  type CacheSW,
  type CachesSW,
  type EntornoSW,
  type VentanaSW,
} from './sw-logica';

// F2-146: el service worker, sin navegador. Las cachés y la red son falsas; lo que se prueba
// es lo que el AC pide ("el service worker sirve el armazón sin red") y lo que no debe hacer
// nunca (guardar datos de la API).

const ORIGEN = 'https://panel.ejemplo.test';

function req(ruta: string, p: { method?: string; mode?: RequestMode } = {}): Request {
  const r = new Request(`${ORIGEN}${ruta}`, { method: p.method ?? 'GET' });
  // jsdom/undici no deja poner mode "navigate" en el constructor.
  if (p.mode) Object.defineProperty(r, 'mode', { value: p.mode });
  return r;
}

/**
 * CacheStorage en memoria, por URL, que respeta `Vary: Origin` como Chrome: una petición CON
 * `Origin` (un `<script type="module">`) no encuentra lo guardado sin él, salvo `ignoreVary`.
 */
function cachesFalsas() {
  const cajas = new Map<string, Map<string, Response>>();
  const clave = (p: Request | string) => (typeof p === 'string' ? new URL(p, ORIGEN).href : p.url);
  const conOrigin = (p: Request | string) => typeof p !== 'string' && p.headers.has('Origin');
  const abrir = (nombre: string): CacheSW => {
    if (!cajas.has(nombre)) cajas.set(nombre, new Map());
    const caja = cajas.get(nombre)!;
    return {
      addAll: async (urls) => {
        for (const u of urls)
          caja.set(
            clave(u),
            new Response(`contenido de ${u}`, { status: 200, headers: { Vary: 'Origin' } }),
          );
      },
      match: async (p, opciones) => {
        const r = caja.get(clave(p));
        if (!r) return undefined;
        const varia = (r.headers.get('Vary') ?? '').includes('Origin');
        if (varia && conOrigin(p) && !opciones?.ignoreVary) return undefined;
        return r.clone();
      },
      put: async (p, r) => {
        caja.set(clave(p), r);
      },
    };
  };
  const caches: CachesSW = {
    open: async (n) => abrir(n),
    keys: async () => [...cajas.keys()],
    delete: async (n) => cajas.delete(n),
  };
  return { caches, cajas };
}

function entorno(p: Partial<EntornoSW> = {}) {
  const { caches, cajas } = cachesFalsas();
  const fetch = vi.fn<(r: Request) => Promise<Response>>(async () => new Response('de la red'));
  const mostrar = vi.fn<EntornoSW['mostrar']>(async () => undefined);
  const abrirVentana = vi.fn(async () => undefined);
  const e: EntornoSW = {
    origen: ORIGEN,
    caches,
    fetch,
    ventanas: async () => [],
    abrirVentana,
    mostrar,
    ...p,
  };
  return { e, cajas, fetch, mostrar, abrirVentana };
}

const PRECACHE = [INDEX, '/assets/index-abc.js', '/assets/index-abc.css', '/manifest.webmanifest'];

describe('estrategia por petición', () => {
  it.each([
    ['/api/ventas/resumen', 'GET', 'cors', 'ignorar'],
    ['/api/auth/refresh', 'POST', 'cors', 'ignorar'],
    ['/api/mesas/abiertas', 'GET', 'navigate', 'ignorar'],
    ['/socket.io/?EIO=4', 'GET', 'cors', 'ignorar'],
    ['/mesas?empresa=x', 'GET', 'navigate', 'armazon'],
    ['/', 'GET', 'navigate', 'armazon'],
    ['/assets/index-abc.js', 'GET', 'cors', 'cache-primero'],
    ['/iconos/icono-192.png', 'GET', 'no-cors', 'cache-primero'],
    ['/manifest.webmanifest', 'GET', 'cors', 'cache-primero'],
    ['/archivos/factura.pdf', 'GET', 'cors', 'ignorar'],
    ['/assets/index-abc.js', 'POST', 'cors', 'ignorar'],
  ])('%s %s (%s) → %s', (ruta, method, mode, esperada) => {
    expect(estrategia({ url: `${ORIGEN}${ruta}`, method, mode }, ORIGEN)).toBe(esperada);
  });

  it('otro origen nunca se toca', () => {
    expect(
      estrategia({ url: 'https://cdn.otro.test/assets/x.js', method: 'GET', mode: 'cors' }, ORIGEN),
    ).toBe('ignorar');
  });
});

describe('manejadores', () => {
  it('instalar precachea la lista del build en la caché de SU versión', async () => {
    const { e, cajas } = entorno();
    await crearManejadores(e, PRECACHE, 'v2').instalar();
    const caja = cajas.get(nombreCache('v2'))!;
    expect([...caja.keys()].sort()).toEqual(PRECACHE.map((p) => `${ORIGEN}${p}`).sort());
  });

  it('AC: SIN RED, una navegación responde con el index.html del precache (el armazón)', async () => {
    const { e, fetch } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    await m.instalar();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await m.responder(req('/mesas?empresa=x', { mode: 'navigate' }))!;
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(`contenido de ${INDEX}`);
  });

  it('CON red, la navegación va a la red (el index nuevo manda)', async () => {
    const { e, fetch } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    await m.instalar();
    const r = await m.responder(req('/', { mode: 'navigate' }))!;
    expect(await r.text()).toBe('de la red');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sin red y sin precache: error de red, no una página inventada', async () => {
    const { e, fetch } = entorno();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await crearManejadores(e, PRECACHE, 'v1').responder(req('/', { mode: 'navigate' }))!;
    expect(r.type).toBe('error');
  });

  it('sin red, el JS del armazón sale de caché aunque lo pida un <script type="module"> (con Origin y Vary: Origin)', async () => {
    const { e, fetch } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    await m.instalar();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const modulo = new Request(`${ORIGEN}/assets/index-abc.js`, { headers: { Origin: ORIGEN } });
    const r = await m.responder(modulo)!;
    expect(await r.text()).toBe('contenido de /assets/index-abc.js');
  });

  it('los assets salen de caché sin red; uno nuevo se guarda al pasar', async () => {
    const { e, fetch, cajas } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    await m.instalar();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await (await m.responder(req('/assets/index-abc.js'))!).text()).toBe(
      'contenido de /assets/index-abc.js',
    );
    fetch.mockResolvedValue(new Response('chunk perezoso', { status: 200 }));
    await m.responder(req('/assets/perezoso-1.js'));
    expect(cajas.get(nombreCache('v1'))!.has(`${ORIGEN}/assets/perezoso-1.js`)).toBe(true);
  });

  it('un 404 de un asset NO se guarda', async () => {
    const { e, fetch, cajas } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    fetch.mockResolvedValue(new Response('no', { status: 404 }));
    await m.responder(req('/assets/viejo.js'));
    expect(cajas.get(nombreCache('v1'))?.has(`${ORIGEN}/assets/viejo.js`) ?? false).toBe(false);
  });

  it('la API NUNCA pasa por el service worker (ni se responde ni se guarda)', async () => {
    const { e, fetch, cajas } = entorno();
    const m = crearManejadores(e, PRECACHE, 'v1');
    await m.instalar();
    expect(m.responder(req('/api/ventas/resumen'))).toBeNull();
    expect(m.responder(req('/api/auth/login', { method: 'POST' }))).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    for (const caja of cajas.values()) {
      expect([...caja.keys()].some((k) => k.includes('/api/'))).toBe(false);
    }
  });

  it('activar borra las cachés de versiones viejas (sólo las suyas)', async () => {
    const { e, cajas } = entorno();
    await crearManejadores(e, PRECACHE, 'v1').instalar();
    await e.caches.open('otra-cosa-de-otra-app');
    const nueva = crearManejadores(e, PRECACHE, 'v2');
    await nueva.instalar();
    await nueva.activar();
    expect([...cajas.keys()].sort()).toEqual([nombreCache('v2'), 'otra-cosa-de-otra-app'].sort());
  });

  it('push: muestra lo que manda el api', async () => {
    const { e, mostrar } = entorno();
    await crearManejadores(e, PRECACHE, 'v1').push(
      JSON.stringify({
        titulo: 'Sucursal sin reportar',
        cuerpo: 'Centro (Demo) no reporta desde hace 14 min.',
        url: '/alertas?empresa=e&sucursal=s',
        etiqueta: 'alerta-1',
      }),
    );
    expect(mostrar).toHaveBeenCalledWith('Sucursal sin reportar', {
      body: 'Centro (Demo) no reporta desde hace 14 min.',
      tag: 'alerta-1',
      icon: '/iconos/icono-192.png',
      badge: '/iconos/icono-192.png',
      data: { url: '/alertas?empresa=e&sucursal=s' },
    });
  });

  it('push ilegible o vacío: igual muestra un aviso genérico (Chrome lo exige)', async () => {
    for (const texto of [null, 'no es json', '[]', '{"titulo": 3}']) {
      expect(notificacionDePush(texto).titulo).toBe('Monitor SoftRestaurant');
    }
  });

  it('clic: con el panel abierto lo enfoca y navega; sin ventana, abre una', async () => {
    const ventana: VentanaSW = {
      url: `${ORIGEN}/inicio`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const ajena: VentanaSW = { url: 'https://otro.test/', focus: vi.fn(), navigate: vi.fn() };
    const con = entorno({ ventanas: async () => [ajena, ventana] });
    await crearManejadores(con.e, PRECACHE, 'v1').clic({ url: '/mesas?sucursal=s' });
    expect(ventana.navigate).toHaveBeenCalledWith('/mesas?sucursal=s');
    expect(ventana.focus).toHaveBeenCalled();
    expect(ajena.navigate).not.toHaveBeenCalled();

    const sin = entorno();
    await crearManejadores(sin.e, PRECACHE, 'v1').clic({ url: '/alertas' });
    expect(sin.abrirVentana).toHaveBeenCalledWith('/alertas');
  });

  it.each([
    ['https://malo.test/robar', '/'],
    ['//malo.test/x', '/'],
    ['javascript:alert(1)', '/'],
    [42, '/'],
    [undefined, '/'],
    ['/facturacion?tab=folios', '/facturacion?tab=folios'],
  ])('urlDestino(%j) = %s: sólo rutas del mismo origen', (url, esperada) => {
    expect(urlDestino(url, ORIGEN)).toBe(esperada);
  });
});
