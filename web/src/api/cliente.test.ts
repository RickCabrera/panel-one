import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  establecerSesion,
  refrescarSesion,
  suscribirSesion,
  terminarSesion,
  tokenActual,
  type EventoSesion,
} from '../auth/sesion';
import { instalarApiFalsa, json, noAutorizado, sesion, usuario } from '../test/apiFalsa';
import { ErrorApi, pedir } from './cliente';

const ANA = usuario('admin_global');

function eventos(): EventoSesion[] {
  const lista: EventoSesion[] = [];
  const desuscribir = suscribirSesion((e) => lista.push(e));
  onTestFinished(desuscribir);
  return lista;
}

/** Una promesa que el test resuelve cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  terminarSesion('cerrada');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pedir', () => {
  it('manda el access token en memoria como Bearer', async () => {
    const api = instalarApiFalsa({ 'GET /empresas': () => json(200, []) });
    establecerSesion(sesion(ANA, 'tok-1'));

    await pedir('/empresas');

    expect(api.llamadas[0].autorizacion).toBe('Bearer tok-1');
  });

  it('ante un 401 refresca y reintenta con el token nuevo', async () => {
    const api = instalarApiFalsa({
      'GET /empresas': (l) =>
        l.autorizacion === 'Bearer tok-2' ? json(200, ['ok']) : noAutorizado(),
      'POST /auth/refresh': () => json(200, sesion(ANA, 'tok-2')),
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    await expect(pedir('/empresas')).resolves.toEqual(['ok']);

    expect(api.contar('POST', '/auth/refresh')).toBe(1);
    expect(api.llamadas.map((l) => l.autorizacion)).toEqual(['Bearer tok-1', null, 'Bearer tok-2']);
    expect(tokenActual()).toBe('tok-2');
  });

  it('tres 401 a la vez disparan UN solo refresh', async () => {
    const refresh = diferida<Response>();
    const api = instalarApiFalsa({
      'GET /empresas': (l) => (l.autorizacion === 'Bearer tok-2' ? json(200, []) : noAutorizado()),
      'POST /auth/refresh': () => refresh.promesa,
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    const pendientes = [pedir('/empresas'), pedir('/empresas'), pedir('/empresas')];
    await vi.waitFor(() => expect(api.contar('POST', '/auth/refresh')).toBe(1));
    refresh.resolver(json(200, sesion(ANA, 'tok-2')));
    await Promise.all(pendientes);

    expect(api.contar('POST', '/auth/refresh')).toBe(1);
    expect(api.contar('GET', '/empresas')).toBe(6);
  });

  it('si el refresh dice que no hay sesión, la sesión expira y lanza 401', async () => {
    const vistos = eventos();
    instalarApiFalsa({
      'GET /empresas': noAutorizado,
      'POST /auth/refresh': noAutorizado,
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    const error = await pedir('/empresas').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).status).toBe(401);
    expect(tokenActual()).toBeNull();
    expect(vistos.at(-1)).toEqual({ tipo: 'terminada', motivo: 'expirada' });
  });

  it('no hay bucle: si el reintento vuelve a dar 401, no refresca otra vez', async () => {
    const api = instalarApiFalsa({
      'GET /empresas': noAutorizado,
      'POST /auth/refresh': () => json(200, sesion(ANA, 'tok-2')),
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    await expect(pedir('/empresas')).rejects.toMatchObject({ status: 401 });

    expect(api.contar('POST', '/auth/refresh')).toBe(1);
    expect(api.contar('GET', '/empresas')).toBe(2);
  });

  // B1 del revisor: un 401 del login son credenciales malas. Refrescar ahí entraría
  // con la cookie del usuario anterior.
  it('un 401 del login NO dispara el refresh y deja la sesión anónima', async () => {
    const api = instalarApiFalsa({
      'POST /auth/login': noAutorizado,
      'POST /auth/refresh': () => json(200, sesion(usuario('admin_global', 'Otro Usuario'))),
    });

    await expect(
      pedir('/auth/login', { method: 'POST', body: { email: 'x@y.z', password: 'mala' } }),
    ).rejects.toMatchObject({ status: 401 });

    expect(api.contar('POST', '/auth/refresh')).toBe(0);
    expect(api.contar('POST', '/auth/login')).toBe(1);
    expect(tokenActual()).toBeNull();
  });

  it('un 401 de /auth/me tampoco dispara el refresh', async () => {
    const api = instalarApiFalsa({
      'GET /auth/me': noAutorizado,
      'POST /auth/refresh': () => json(200, sesion(ANA)),
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    await expect(pedir('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(api.contar('POST', '/auth/refresh')).toBe(0);
  });

  it('un fallo de red es ErrorApi con status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(pedir('/empresas')).rejects.toMatchObject({ status: 0 });
  });

  it('arma el query string sin los valores vacíos', async () => {
    const api = instalarApiFalsa({ 'GET /sucursales': () => json(200, []) });

    await pedir('/sucursales', { query: { empresaId: 'E', otro: undefined, nada: null } });

    expect(api.llamadas[0].query.toString()).toBe('empresaId=E');
  });
});

describe('refresh proactivo', () => {
  it('refresca 60 s antes de que venza el access token', async () => {
    const api = instalarApiFalsa({ 'POST /auth/refresh': () => json(200, sesion(ANA, 'tok-2')) });
    establecerSesion(sesion(ANA, 'tok-1')); // expiresIn 900 → a los 840 s

    await vi.advanceTimersByTimeAsync(839_000);
    expect(api.contar('POST', '/auth/refresh')).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(tokenActual()).toBe('tok-2'));
    expect(api.contar('POST', '/auth/refresh')).toBe(1);
  });

  it('si el refresh proactivo da 401, la sesión expira', async () => {
    const vistos = eventos();
    instalarApiFalsa({ 'POST /auth/refresh': noAutorizado });
    establecerSesion(sesion(ANA, 'tok-1'));

    await vi.advanceTimersByTimeAsync(840_000);

    await vi.waitFor(() =>
      expect(vistos.at(-1)).toEqual({ tipo: 'terminada', motivo: 'expirada' }),
    );
    expect(tokenActual()).toBeNull();
  });

  it('cerrar sesión cancela el timer proactivo', async () => {
    const api = instalarApiFalsa({ 'POST /auth/refresh': () => json(200, sesion(ANA)) });
    establecerSesion(sesion(ANA, 'tok-1'));

    terminarSesion('cerrada');
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(api.contar('POST', '/auth/refresh')).toBe(0);
  });

  it('comparte el refresh en vuelo con los 401', async () => {
    const refresh = diferida<Response>();
    const api = instalarApiFalsa({
      'GET /empresas': (l) => (l.autorizacion === 'Bearer tok-2' ? json(200, []) : noAutorizado()),
      'POST /auth/refresh': () => refresh.promesa,
    });
    establecerSesion(sesion(ANA, 'tok-1'));

    await vi.advanceTimersByTimeAsync(840_000); // sale el proactivo y queda en vuelo
    const pendiente = pedir('/empresas');
    await vi.waitFor(() => expect(api.contar('GET', '/empresas')).toBe(1));
    refresh.resolver(json(200, sesion(ANA, 'tok-2')));
    await pendiente;

    expect(api.contar('POST', '/auth/refresh')).toBe(1);
  });
});

describe('refrescarSesion', () => {
  it('un refresh que responde DESPUÉS de cerrar sesión no la revive', async () => {
    const refresh = diferida<Response>();
    instalarApiFalsa({ 'POST /auth/refresh': () => refresh.promesa });

    const enVuelo = refrescarSesion();
    terminarSesion('cerrada');
    refresh.resolver(json(200, sesion(ANA, 'tok-tarde')));

    await expect(enVuelo).resolves.toBeNull();
    expect(tokenActual()).toBeNull();
  });

  it('un 5xx se lanza: no prueba que la sesión haya terminado', async () => {
    instalarApiFalsa({ 'POST /auth/refresh': () => json(503, {}) });

    await expect(refrescarSesion()).rejects.toThrow('503');
  });
});
