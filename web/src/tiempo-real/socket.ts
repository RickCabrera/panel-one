import { io, type Socket } from 'socket.io-client';

import { BASE_API } from '../api/base';
import { refrescarSesion, suscribirSesion, tokenActual, type EventoSesion } from '../auth/sesion';

/**
 * El socket del tiempo real (F2-142). La API AVISA por aquí que una sucursal mandó datos
 * (`ingesta { sucursalId, mesas, cheques }`); los datos se siguen pidiendo por HTTP con su scope
 * (`GET /mesas/abiertas`). Contrato en `docs/tiempo-real.md`.
 *
 * Una conexión por alcance (empresa + sucursal), compartida por todo lo que lo mire (la
 * cabecera y el Monitor ven el mismo), abierta con el primer suscriptor y cerrada con el
 * último. Si el socket no está, nada se rompe: las consultas siguen con su polling.
 *
 * Sesión: el token va en `auth` como FUNCIÓN, así cada (re)conexión manda el vigente. Cuando
 * se renueva la sesión se reconecta con el nuevo (el servidor corta al vencer el anterior); si
 * termina, se cierra todo. Un `connect_error` "No autenticado" pide UN refresh por ciclo: si
 * vuelve a fallar con el token recién renovado, ya no insiste (se queda en polling) hasta la
 * siguiente conexión buena. Sin ese tope, un rechazo por otra causa se comería el límite de
 * refresh de la API (30/min) y terminaría sacando al usuario.
 */

/** Tras el proxy de `/api` (Vite en local, Caddy en producción). */
export const RUTA_SOCKET = `${BASE_API}/socket.io`;
/**
 * Avisos que llegan juntos se juntan en uno: con 60 sucursales mandando cada ~30 s serían ~2
 * avisos por segundo, y cada uno relee la empresa entera. 1 s deja holgura al presupuesto de
 * < 5 s entre la ingesta y la pantalla.
 */
export const AGRUPAR_MS = 1_000;
/** Tope de la respuesta a `suscribir`. */
export const TOPE_SUSCRIBIR_MS = 5_000;
/** El texto con que la API rechaza el handshake sin token válido. */
const NO_AUTENTICADO = 'No autenticado';

export interface Alcance {
  empresaId: string;
  sucursalId?: string | null;
}

export interface AvisoIngesta {
  sucursalId: string;
  mesas: boolean;
  cheques: boolean;
}

interface Conexion {
  clave: string;
  alcance: Alcance;
  socket: Socket;
  /** Conectado Y suscrito: los avisos de este alcance están llegando. */
  vivo: boolean;
  /** Ya estuvo vivo alguna vez: al volver, hay que recuperar lo que pasó mientras no. */
  estuvoVivo: boolean;
  /** Ya se pidió el refresh de este ciclo de errores (ver cabecera). */
  refrescoUsado: boolean;
  oyentes: Set<() => void>;
  agrupando: ReturnType<typeof setTimeout> | null;
}

const conexiones = new Map<string, Conexion>();
const oyentesEstado = new Set<() => void>();
let quitarOyenteSesion: (() => void) | null = null;

function claveDe(alcance: Alcance): string {
  return `${alcance.empresaId}|${alcance.sucursalId ?? ''}`;
}

function avisarEstado(): void {
  for (const oyente of [...oyentesEstado]) oyente();
}

function ponerVivo(c: Conexion, vivo: boolean): void {
  if (c.vivo === vivo) return;
  c.vivo = vivo;
  avisarEstado();
}

function avisarOyentes(c: Conexion): void {
  for (const oyente of [...c.oyentes]) oyente();
}

function vigente(c: Conexion): boolean {
  return conexiones.get(c.clave) === c;
}

async function suscribirEn(c: Conexion): Promise<void> {
  const cuerpo = c.alcance.sucursalId
    ? { empresaId: c.alcance.empresaId, sucursalId: c.alcance.sucursalId }
    : { empresaId: c.alcance.empresaId };
  let respuesta: unknown;
  try {
    respuesta = await c.socket.timeout(TOPE_SUSCRIBIR_MS).emitWithAck('suscribir', cuerpo);
  } catch {
    respuesta = null;
  }
  if (!vigente(c) || !c.socket.connected) return;
  const ok =
    respuesta !== null &&
    typeof respuesta === 'object' &&
    (respuesta as { ok?: unknown }).ok === true;
  // Rechazada (fuera de alcance, inválida): el socket queda abierto pero sin avisos → polling.
  if (!ok) {
    ponerVivo(c, false);
    return;
  }
  const volvio = c.estuvoVivo;
  c.estuvoVivo = true;
  ponerVivo(c, true);
  // De vuelta tras una caída: lo que llegó mientras tanto no se avisó. Se relee una vez.
  if (volvio) avisarOyentes(c);
}

function abrir(alcance: Alcance): Conexion {
  const socket = io({
    path: RUTA_SOCKET,
    autoConnect: false,
    auth: (cb) => cb({ token: tokenActual() ?? '' }),
  });
  const c: Conexion = {
    clave: claveDe(alcance),
    alcance,
    socket,
    vivo: false,
    estuvoVivo: false,
    refrescoUsado: false,
    oyentes: new Set(),
    agrupando: null,
  };

  socket.on('connect', () => {
    c.refrescoUsado = false;
    void suscribirEn(c);
  });
  socket.on('disconnect', (motivo: Socket.DisconnectReason) => {
    ponerVivo(c, false);
    // El servidor cortó (venció el token): socket.io no reintenta solo. Se reconecta con el
    // token vigente; si ya no sirve, `connect_error` lleva al refresh.
    if (motivo === 'io server disconnect' && vigente(c) && tokenActual() !== null) {
      socket.connect();
    }
  });
  socket.on('connect_error', (error: Error) => {
    ponerVivo(c, false);
    // Error de red: socket.io reintenta solo, con espera creciente.
    if (socket.active) return;
    if (error.message !== NO_AUTENTICADO || c.refrescoUsado || tokenActual() === null) return;
    c.refrescoUsado = true;
    // Si hay sesión nueva, `establecida` reconecta (ver `alEventoSesion`).
    refrescarSesion().catch(() => null);
  });
  socket.on('ingesta', () => {
    if (!c.vivo || c.agrupando !== null) return;
    c.agrupando = setTimeout(() => {
      c.agrupando = null;
      if (vigente(c)) avisarOyentes(c);
    }, AGRUPAR_MS);
  });
  return c;
}

function cerrar(c: Conexion): void {
  conexiones.delete(c.clave);
  if (c.agrupando !== null) clearTimeout(c.agrupando);
  c.socket.removeAllListeners();
  c.socket.disconnect();
  if (c.vivo) {
    c.vivo = false;
    avisarEstado();
  }
  if (conexiones.size === 0 && quitarOyenteSesion !== null) {
    quitarOyenteSesion();
    quitarOyenteSesion = null;
  }
}

function alEventoSesion(evento: EventoSesion): void {
  for (const c of conexiones.values()) {
    if (evento.tipo === 'terminada') {
      c.socket.disconnect();
      ponerVivo(c, false);
    } else if (c.socket.connected) {
      // Token nuevo: se reconecta con él antes de que el servidor corte al vencer el anterior.
      c.socket.disconnect();
      c.socket.connect();
    } else if (!c.socket.active) {
      c.socket.connect();
    }
  }
}

/**
 * Escucha los avisos de un alcance. `alCambio` se llama (agrupado) cuando llega un aviso, y
 * una vez al volver de una caída. Devuelve la baja.
 */
export function suscribirTiempoReal(alcance: Alcance, alCambio: () => void): () => void {
  const clave = claveDe(alcance);
  let c = conexiones.get(clave);
  if (!c) {
    c = abrir(alcance);
    conexiones.set(clave, c);
    quitarOyenteSesion ??= suscribirSesion(alEventoSesion);
    if (tokenActual() !== null) c.socket.connect();
  }
  const conexion = c;
  conexion.oyentes.add(alCambio);
  return () => {
    conexion.oyentes.delete(alCambio);
    if (conexion.oyentes.size === 0 && vigente(conexion)) cerrar(conexion);
  };
}

/** ¿Llegan los avisos de este alcance ahora mismo? */
export function estaVivo(alcance: Alcance): boolean {
  return conexiones.get(claveDe(alcance))?.vivo ?? false;
}

/** Para `useSyncExternalStore`: avisa cuando cualquier conexión cambia de estado. */
export function oirEstado(oyente: () => void): () => void {
  oyentesEstado.add(oyente);
  return () => oyentesEstado.delete(oyente);
}
