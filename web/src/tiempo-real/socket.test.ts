import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sesion } from '../api/tipos';
import { establecerSesion, terminarSesion } from '../auth/sesion';
import { sockets, type SocketFalso } from '../test/socketFalso';
import {
  AGRUPAR_MS,
  estaVivo,
  oirEstado,
  RUTA_SOCKET,
  suscribirTiempoReal,
  type Alcance,
} from './socket';

// El gestor del socket (F2-142) contra el `socket.io-client` falso de `test-setup.ts`.

const EMPRESA = '11111111-1111-4111-8111-111111111111';
const SUCURSAL = '22222222-2222-4222-8222-222222222222';

function sesion(token: string): Sesion {
  return {
    accessToken: token,
    expiresIn: 900,
    usuario: {
      id: 'u1',
      email: 'visor@ejemplo.test',
      nombre: 'Visor',
      rol: 'visor',
      empresaId: EMPRESA,
    },
  };
}

/** Deja que corran las promesas pendientes (el ack de `suscribir`). */
const vaciar = () => new Promise<void>((r) => setTimeout(r, 0));

const bajas: Array<() => void> = [];
function suscribir(alcance: Alcance = { empresaId: EMPRESA }, alCambio = vi.fn()) {
  bajas.push(suscribirTiempoReal(alcance, alCambio));
  return { alCambio, socket: sockets[sockets.length - 1] as SocketFalso };
}

/** Conecta el socket falso y espera a que la suscripción responda. */
async function conectar(s: SocketFalso): Promise<void> {
  s.simularConexion();
  await vaciar();
}

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sockets.length = 0;
  fetchFalso = vi.fn(async () => new Response(JSON.stringify(sesion('renovado')), { status: 200 }));
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  for (const baja of bajas.splice(0)) baja();
  terminarSesion('cerrada');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('conexión', () => {
  it('sin sesión no conecta; con sesión conecta por la ruta del proxy y manda el token VIGENTE', async () => {
    const { socket } = suscribir();
    expect(socket.opciones.path).toBe(RUTA_SOCKET);
    expect(RUTA_SOCKET).toBe('/api/socket.io');
    expect(socket.conexiones).toBe(0);
    for (const baja of bajas.splice(0)) baja();

    establecerSesion(sesion('t1'));
    const { socket: s2 } = suscribir();
    expect(s2.conexiones).toBe(1);
    expect(s2.tokenDelHandshake()).toBe('t1');
    establecerSesion(sesion('t2'));
    expect(s2.tokenDelHandshake()).toBe('t2');
  });

  it('un alcance, una conexión: dos suscriptores la comparten y se cierra con el último', () => {
    establecerSesion(sesion('t1'));
    const baja1 = suscribirTiempoReal({ empresaId: EMPRESA }, vi.fn());
    const baja2 = suscribirTiempoReal({ empresaId: EMPRESA }, vi.fn());
    expect(sockets).toHaveLength(1);
    baja1();
    expect(sockets[0].desconexiones).toBe(0);
    baja2();
    expect(sockets[0].desconexiones).toBe(1);
  });

  it('al conectar pide `suscribir` con su alcance; aceptado = vivo', async () => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir({ empresaId: EMPRESA, sucursalId: SUCURSAL });
    const cambios = vi.fn();
    const dejar = oirEstado(cambios);
    expect(estaVivo({ empresaId: EMPRESA, sucursalId: SUCURSAL })).toBe(false);
    await conectar(socket);
    expect(socket.emitidos).toEqual([
      { evento: 'suscribir', cuerpo: { empresaId: EMPRESA, sucursalId: SUCURSAL } },
    ]);
    expect(estaVivo({ empresaId: EMPRESA, sucursalId: SUCURSAL })).toBe(true);
    expect(cambios).toHaveBeenCalled();
    dejar();
  });

  it.each([
    ['rechazada ("No encontrado")', { ok: false, error: 'No encontrado' }],
    ['sin respuesta (vence el tope)', null],
  ])('suscripción %s: conectado pero NO vivo (se queda en polling)', async (_c, respuesta) => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir();
    socket.respuestaSuscribir = respuesta;
    await conectar(socket);
    expect(estaVivo({ empresaId: EMPRESA })).toBe(false);
  });
});

describe('avisos', () => {
  it('varios avisos seguidos se juntan en UNA relectura, a los AGRUPAR_MS', async () => {
    establecerSesion(sesion('t1'));
    const { socket, alCambio } = suscribir();
    await conectar(socket);
    vi.useFakeTimers();
    for (let i = 0; i < 3; i += 1) {
      socket.recibir('ingesta', { sucursalId: SUCURSAL, mesas: true, cheques: false });
    }
    expect(alCambio).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AGRUPAR_MS);
    expect(alCambio).toHaveBeenCalledTimes(1);
    expect(AGRUPAR_MS).toBeLessThan(5_000);
  });

  it('un aviso con la conexión NO viva no dispara nada', async () => {
    establecerSesion(sesion('t1'));
    const { socket, alCambio } = suscribir();
    socket.respuestaSuscribir = { ok: false, error: 'No encontrado' };
    await conectar(socket);
    vi.useFakeTimers();
    socket.recibir('ingesta', { sucursalId: SUCURSAL, mesas: true, cheques: false });
    vi.advanceTimersByTime(AGRUPAR_MS);
    expect(alCambio).not.toHaveBeenCalled();
  });

  it('caída → deja de estar vivo; al volver se relee UNA vez (lo que pasó mientras tanto)', async () => {
    establecerSesion(sesion('t1'));
    const { socket, alCambio } = suscribir();
    await conectar(socket);
    // La primera conexión no relee: la consulta acaba de pedir.
    expect(alCambio).not.toHaveBeenCalled();
    socket.simularCaida('transport close');
    expect(estaVivo({ empresaId: EMPRESA })).toBe(false);
    await conectar(socket);
    expect(estaVivo({ empresaId: EMPRESA })).toBe(true);
    expect(alCambio).toHaveBeenCalledTimes(1);
  });
});

describe('sesión', () => {
  it('el servidor corta (venció el token) → reconecta con el vigente', async () => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir();
    await conectar(socket);
    socket.simularCaida('io server disconnect');
    expect(socket.conexiones).toBe(2);
  });

  it('sesión renovada con el socket arriba → reconecta para usar el token nuevo', async () => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir();
    await conectar(socket);
    establecerSesion(sesion('t2'));
    expect(socket.desconexiones).toBe(1);
    expect(socket.conexiones).toBe(2);
    expect(socket.tokenDelHandshake()).toBe('t2');
  });

  it('sesión terminada → se cierra y deja de estar vivo', async () => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir();
    await conectar(socket);
    terminarSesion('cerrada');
    expect(socket.connected).toBe(false);
    expect(estaVivo({ empresaId: EMPRESA })).toBe(false);
  });

  it('dos `connect_error` "No autenticado" seguidos piden EXACTAMENTE un refresh', async () => {
    establecerSesion(sesion('viejo'));
    const { socket } = suscribir();
    socket.simularErrorConexion('No autenticado');
    await vaciar();
    await vaciar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(String(fetchFalso.mock.calls[0][0])).toBe('/api/auth/refresh');
    // La sesión renovada reconecta con el token nuevo…
    expect(socket.tokenDelHandshake()).toBe('renovado');
    expect(socket.conexiones).toBe(2);
    // …y si vuelve a rechazar, ya no se insiste: polling.
    socket.simularErrorConexion('No autenticado');
    await vaciar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('tras una conexión buena, el tope de un refresh vuelve a estar disponible', async () => {
    establecerSesion(sesion('viejo'));
    const { socket } = suscribir();
    socket.simularErrorConexion('No autenticado');
    await vaciar();
    await vaciar();
    await conectar(socket);
    socket.simularCaida('io server disconnect');
    socket.simularErrorConexion('No autenticado');
    await vaciar();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('un error de RED (socket.io reintenta solo) o de otra causa no pide refresh', async () => {
    establecerSesion(sesion('t1'));
    const { socket } = suscribir();
    socket.simularErrorConexion('xhr poll error', true);
    socket.simularErrorConexion('otra cosa');
    await vaciar();
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
