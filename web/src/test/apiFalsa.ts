import { vi } from 'vitest';

import type { Empresa, Sesion, Sucursal, UsuarioActual } from '../api/tipos';

/**
 * Una API falsa sobre `fetch`, para probar la SPA sin red. Cada ruta se responde con
 * un manejador (`'POST /auth/refresh'`, sin el prefijo `/api`) y cada llamada queda
 * registrada para poder contar, por ejemplo, cuántos refresh salieron.
 */

export interface Llamada {
  metodo: string;
  ruta: string;
  query: URLSearchParams;
  autorizacion: string | null;
  cuerpo: unknown;
  /** F2-143: un cuerpo binario (Blob) tal cual, y su Content-Type. */
  binario?: Blob;
  contentType?: string | null;
}

export type Manejador = (llamada: Llamada) => Response | Promise<Response>;

export function json(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const noAutorizado = (): Response => json(401, { statusCode: 401, message: 'Unauthorized' });

export function instalarApiFalsa(inicial: Record<string, Manejador> = {}) {
  const manejadores: Record<string, Manejador> = { ...inicial };
  const llamadas: Llamada[] = [];

  const fetchFalso = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(entrada), 'http://localhost');
    if (!url.pathname.startsWith('/api/')) throw new Error(`fetch fuera de /api: ${url.pathname}`);
    const llamada: Llamada = {
      metodo: init?.method ?? 'GET',
      ruta: url.pathname.slice('/api'.length),
      query: url.searchParams,
      autorizacion: new Headers(init?.headers).get('Authorization'),
      cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      binario: init?.body instanceof Blob ? init.body : undefined,
      contentType: new Headers(init?.headers).get('Content-Type'),
    };
    llamadas.push(llamada);
    const manejador = manejadores[`${llamada.metodo} ${llamada.ruta}`];
    if (!manejador) return json(404, { statusCode: 404, message: 'Not Found' });
    return manejador(llamada);
  });
  vi.stubGlobal('fetch', fetchFalso);

  return {
    manejadores,
    llamadas,
    contar: (metodo: string, ruta: string) =>
      llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta).length,
  };
}

// --- Datos sintéticos -------------------------------------------------------------

export const EMPRESA_A: Empresa = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Tacos Demo',
  activo: true,
};
export const EMPRESA_B: Empresa = {
  id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Mariscos Demo',
  activo: false,
};
export const SUCURSAL_A1: Sucursal = {
  id: 'aaaaaaa1-0000-4000-8000-000000000001',
  empresaId: EMPRESA_A.id,
  nombre: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  activo: true,
};
export const SUCURSAL_A2: Sucursal = {
  id: 'aaaaaaa2-0000-4000-8000-000000000002',
  empresaId: EMPRESA_A.id,
  nombre: 'Tijuana',
  zonaHoraria: 'America/Tijuana',
  activo: true,
};
export const SUCURSAL_B1: Sucursal = {
  id: 'bbbbbbb1-0000-4000-8000-000000000001',
  empresaId: EMPRESA_B.id,
  nombre: 'Puerto',
  zonaHoraria: 'America/Mexico_City',
  activo: true,
};

export function usuario(rol: UsuarioActual['rol'], nombre = 'Ana Global'): UsuarioActual {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'ana@demo.local',
    nombre,
    rol,
    empresaId: rol === 'admin_global' ? null : EMPRESA_A.id,
  };
}

export function sesion(u: UsuarioActual, accessToken = `token-${u.nombre}`): Sesion {
  return { accessToken, expiresIn: 900, usuario: u };
}
