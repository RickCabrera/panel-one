import { BASE_API } from '../api/base';
import type { Sesion, UsuarioActual } from '../api/tipos';

/**
 * La sesión del panel, en memoria y SÓLO en memoria. El access token nunca va a
 * localStorage ni a sessionStorage: cualquier XSS lo leería de ahí. Recargar la
 * página lo pierde, y el refresh silencioso del arranque lo recupera con la cookie
 * httpOnly de refresh, que JavaScript no puede leer.
 *
 * Los tres caminos que refrescan —el 401 de un request, el timer proactivo y el
 * arranque— pasan por `refrescarSesion()`, que es single-flight: si ya hay un
 * refresh en vuelo, todos esperan ese mismo. Así un puñado de requests con 401 a la
 * vez (o el doble montaje de StrictMode) hacen UN solo `POST /auth/refresh`, y la
 * API no ve una rotación de cookie pisando a otra.
 */

export type EventoSesion =
  | { tipo: 'establecida'; usuario: UsuarioActual }
  | { tipo: 'terminada'; motivo: 'cerrada' | 'expirada' };

type Oyente = (evento: EventoSesion) => void;

/** Cuánto antes de que venza el access token se pide uno nuevo. */
const MARGEN_REFRESH_SEGUNDOS = 60;
/** Piso del timer proactivo, por si la API manda una vida absurda de corta. */
const MINIMO_REFRESH_SEGUNDOS = 10;

let token: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let enVuelo: Promise<Sesion | null> | null = null;
/**
 * Sube cada vez que la sesión termina. Un refresh que salió antes de un "cerrar
 * sesión" y responde después NO debe revivir la sesión: compara la generación con
 * la que tenía al salir y, si cambió, tira el resultado.
 */
let generacion = 0;
const oyentes = new Set<Oyente>();

function emitir(evento: EventoSesion): void {
  for (const oyente of oyentes) oyente(evento);
}

function cancelarTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export function tokenActual(): string | null {
  return token;
}

export function suscribirSesion(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** Guarda la sesión recién emitida y programa el refresh proactivo. */
export function establecerSesion(sesion: Sesion): void {
  token = sesion.accessToken;
  cancelarTimer();
  const segundos = Math.max(sesion.expiresIn - MARGEN_REFRESH_SEGUNDOS, MINIMO_REFRESH_SEGUNDOS);
  timer = setTimeout(() => {
    timer = null;
    void refrescarOExpirar();
  }, segundos * 1000);
  emitir({ tipo: 'establecida', usuario: sesion.usuario });
}

/** Borra el token, cancela el timer y avisa. Invalida los refresh en vuelo. */
export function terminarSesion(motivo: 'cerrada' | 'expirada'): void {
  generacion += 1;
  token = null;
  enVuelo = null;
  cancelarTimer();
  emitir({ tipo: 'terminada', motivo });
}

/**
 * `POST /auth/refresh` con la cookie. Devuelve la sesión nueva, o `null` si la API
 * dice que no hay sesión (401). Un error de red o un 5xx se lanza: eso no prueba que
 * la sesión haya terminado, y quien llama decide qué hacer.
 */
export function refrescarSesion(): Promise<Sesion | null> {
  if (enVuelo) return enVuelo;
  const generacionAlSalir = generacion;
  const promesa = (async (): Promise<Sesion | null> => {
    const respuesta = await fetch(`${BASE_API}/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (generacionAlSalir !== generacion) return null;
    if (respuesta.status === 401) return null;
    if (!respuesta.ok) throw new Error(`El refresh respondió ${respuesta.status}`);
    const sesion = (await respuesta.json()) as Sesion;
    if (generacionAlSalir !== generacion) return null;
    establecerSesion(sesion);
    return sesion;
  })();
  enVuelo = promesa;
  const limpiar = (): void => {
    if (enVuelo === promesa) enVuelo = null;
  };
  promesa.then(limpiar, limpiar);
  return promesa;
}

/**
 * Espera el refresh que esté en vuelo, si hay uno; no inicia ninguno. Lo usa el
 * cambio de contraseña propio (F1-060) antes de mandar el POST: un refresh que
 * saliera con la cookie vieja y respondiera DESPUÉS del cambio recibiría 401 y
 * cerraría la sesión recién emitida. Esto cubre el refresh ya en vuelo; uno que
 * arranque durante el POST (el timer proactivo) sigue siendo una carrera
 * posible, anotada en docs/nocturno-log.md.
 */
export async function esperarRefreshEnVuelo(): Promise<void> {
  if (!enVuelo) return;
  try {
    await enVuelo;
  } catch {
    // Si falló, no hay nada que esperar: el POST sigue igual.
  }
}

/**
 * El timer proactivo. Si la API dice que ya no hay sesión, la sesión expira. Si el
 * refresh falla por red, no se da por muerta: el siguiente request con 401 lo
 * vuelve a intentar.
 */
async function refrescarOExpirar(): Promise<void> {
  const generacionAlSalir = generacion;
  try {
    const sesion = await refrescarSesion();
    if (sesion === null && generacionAlSalir === generacion) terminarSesion('expirada');
  } catch {
    // Red caída o 5xx: se reintenta con el próximo 401.
  }
}
