/**
 * La lógica del service worker de la PWA (F2-146), separada de los eventos para poder
 * probarla sin navegador. `sw.ts` sólo conecta estos manejadores a `self`.
 *
 * Qué hace y qué NO hace:
 * - **Armazón sin red.** Instala (precache) el `index.html`, el manifest, los íconos y TODOS
 *   los assets del build. Sin red, una navegación responde con ese `index.html`: el layout
 *   carga y cada vista dice que no pudo leer sus datos (no se inventa nada).
 * - **Nunca cachea datos.** `/api/*` (ventas, mesas, alertas, con scope por usuario) y el
 *   socket pasan directo a la red. Una cifra vieja servida desde caché sería una mentira, y
 *   una caché compartida en el navegador podría mostrar datos de la sesión anterior.
 * - **Push.** Muestra la notificación que manda el api (`MensajePush`) y, al tocarla, abre
 *   el panel en la ruta que trae, siempre del MISMO origen.
 */

/** El cuerpo que manda el api (`api/src/adaptadores/push/puerto.ts#MensajePush`). */
export interface MensajePush {
  titulo: string;
  cuerpo: string;
  url: string;
  etiqueta: string;
}

export type Estrategia = 'ignorar' | 'armazon' | 'cache-primero';

/** Lo mínimo de un `Request` que decide la estrategia. */
export interface PeticionSW {
  url: string;
  method: string;
  mode: string;
}

export const PREFIJO_CACHE = 'monitor-armazon-';
export const INDEX = '/index.html';
export const ICONO_NOTIFICACION = '/iconos/icono-192.png';

/** Rutas que NUNCA toca el service worker (datos, tiempo real, archivos firmados). */
const NUNCA = ['/api/', '/socket.io/'];

export function nombreCache(version: string): string {
  return `${PREFIJO_CACHE}${version}`;
}

export function estrategia(p: PeticionSW, origen: string): Estrategia {
  if (p.method !== 'GET') return 'ignorar';
  let url: URL;
  try {
    url = new URL(p.url);
  } catch {
    return 'ignorar';
  }
  if (url.origin !== origen) return 'ignorar';
  if (NUNCA.some((prefijo) => url.pathname.startsWith(prefijo))) return 'ignorar';
  if (p.mode === 'navigate') return 'armazon';
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/iconos/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.svg'
  ) {
    return 'cache-primero';
  }
  return 'ignorar';
}

/**
 * La ruta a abrir al tocar una notificación: sólo rutas del mismo origen. Cualquier otra
 * cosa (otro dominio, `javascript:`, basura) abre el inicio.
 */
export function urlDestino(url: unknown, origen: string): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/';
  try {
    const u = new URL(url, origen);
    return u.origin === origen ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch {
    return '/';
  }
}

/** Lo que se muestra. Un cuerpo ilegible igual muestra un aviso: Chrome exige mostrar uno. */
export function notificacionDePush(texto: string | null): {
  titulo: string;
  opciones: { body: string; tag: string; icon: string; badge: string; data: { url: string } };
} {
  let m: Partial<MensajePush> = {};
  try {
    const crudo: unknown = texto ? JSON.parse(texto) : null;
    if (crudo && typeof crudo === 'object') m = crudo as Partial<MensajePush>;
  } catch {
    m = {};
  }
  const cadena = (v: unknown, def: string) => (typeof v === 'string' && v !== '' ? v : def);
  return {
    titulo: cadena(m.titulo, 'Monitor SoftRestaurant'),
    opciones: {
      body: cadena(m.cuerpo, 'Tienes un aviso nuevo. Ábrelo para verlo.'),
      tag: cadena(m.etiqueta, 'aviso'),
      icon: ICONO_NOTIFICACION,
      badge: ICONO_NOTIFICACION,
      data: { url: cadena(m.url, '/') },
    },
  };
}

// --------------------------------------------------------------- manejadores

export interface CacheSW {
  addAll(urls: string[]): Promise<void>;
  match(
    peticion: Request | string,
    opciones?: { ignoreVary?: boolean },
  ): Promise<Response | undefined>;
  put(peticion: Request | string, respuesta: Response): Promise<void>;
}

export interface CachesSW {
  open(nombre: string): Promise<CacheSW>;
  keys(): Promise<string[]>;
  delete(nombre: string): Promise<boolean>;
}

export interface VentanaSW {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

export interface EntornoSW {
  origen: string;
  caches: CachesSW;
  fetch: (peticion: Request) => Promise<Response>;
  ventanas(): Promise<readonly VentanaSW[]>;
  abrirVentana(url: string): Promise<unknown>;
  mostrar(
    titulo: string,
    opciones: ReturnType<typeof notificacionDePush>['opciones'],
  ): Promise<void>;
}

export interface ManejadoresSW {
  instalar(): Promise<void>;
  activar(): Promise<void>;
  /** null = el service worker no responde (el navegador sigue como si no existiera). */
  responder(peticion: Request): Promise<Response> | null;
  push(texto: string | null): Promise<void>;
  clic(data: unknown): Promise<void>;
}

/**
 * Los servidores (Vite, Caddy) responden los assets con `Vary: Origin`, y un
 * `<script type="module">` los pide CON `Origin`: sin esto, la caché no encuentra el JS que
 * guardó el `install` (que se pidió sin `Origin`) y el armazón abre en blanco sin red. Lo
 * fija un test de `sw-logica.test.ts`; falta verlo en Chrome real (F2-191). Los assets son
 * del mismo origen e inmutables (nombre con hash): ignorar `Vary` es seguro.
 */
const SIN_VARY = { ignoreVary: true } as const;

export function crearManejadores(
  entorno: EntornoSW,
  precache: readonly string[],
  version: string,
): ManejadoresSW {
  const nombre = nombreCache(version);

  async function armazon(peticion: Request): Promise<Response> {
    try {
      return await entorno.fetch(peticion);
    } catch {
      const cache = await entorno.caches.open(nombre);
      return (await cache.match(INDEX, SIN_VARY)) ?? Response.error();
    }
  }

  async function cachePrimero(peticion: Request): Promise<Response> {
    const cache = await entorno.caches.open(nombre);
    const guardada = await cache.match(peticion, SIN_VARY);
    if (guardada) return guardada;
    const respuesta = await entorno.fetch(peticion);
    if (respuesta.ok) await cache.put(peticion, respuesta.clone());
    return respuesta;
  }

  return {
    async instalar() {
      const cache = await entorno.caches.open(nombre);
      await cache.addAll([...precache]);
    },

    async activar() {
      for (const clave of await entorno.caches.keys()) {
        if (clave.startsWith(PREFIJO_CACHE) && clave !== nombre) await entorno.caches.delete(clave);
      }
    },

    responder(peticion) {
      switch (estrategia(peticion, entorno.origen)) {
        case 'armazon':
          return armazon(peticion);
        case 'cache-primero':
          return cachePrimero(peticion);
        default:
          return null;
      }
    },

    async push(texto) {
      const { titulo, opciones } = notificacionDePush(texto);
      await entorno.mostrar(titulo, opciones);
    },

    async clic(data) {
      const destino = urlDestino((data as { url?: unknown } | null)?.url, entorno.origen);
      const abiertas = (await entorno.ventanas()).filter((v) => {
        try {
          return new URL(v.url).origin === entorno.origen;
        } catch {
          return false;
        }
      });
      if (abiertas.length > 0) {
        await abiertas[0].navigate(destino);
        await abiertas[0].focus();
        return;
      }
      await entorno.abrirVentana(destino);
    },
  };
}
