import { refrescarSesion, terminarSesion, tokenActual } from '../auth/sesion';
import { BASE_API } from './base';
import type { ErrorCuerpo } from './tipos';

/** Error de la API con su status HTTP. `status` 0 = no hubo respuesta (red). */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    /** El cuerpo JSON del error, tal cual (F2-103: los `campos` del portal). */
    readonly cuerpo?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

export interface OpcionesPedir {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Se manda como JSON. */
  body?: unknown;
  /**
   * Se manda TAL CUAL como `application/octet-stream` (F2-143: el binario del agente que publica el
   * admin_global). Excluye a `body`.
   */
  binario?: Blob;
  /** Query string; los `undefined` y `null` se omiten. */
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
}

function url(ruta: string, query: OpcionesPedir['query']): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query ?? {})) {
    if (valor !== undefined && valor !== null) parametros.set(clave, String(valor));
  }
  const texto = parametros.toString();
  return `${BASE_API}${ruta}${texto ? `?${texto}` : ''}`;
}

async function enviar(
  ruta: string,
  opciones: OpcionesPedir,
  token: string | null,
  acepta = 'application/json',
): Promise<Response> {
  const encabezados: Record<string, string> = { Accept: acepta };
  if (token) encabezados.Authorization = `Bearer ${token}`;
  if (opciones.binario !== undefined) encabezados['Content-Type'] = 'application/octet-stream';
  else if (opciones.body !== undefined) encabezados['Content-Type'] = 'application/json';
  try {
    return await fetch(url(ruta, opciones.query), {
      method: opciones.method ?? 'GET',
      headers: encabezados,
      body:
        opciones.binario ??
        (opciones.body === undefined ? undefined : JSON.stringify(opciones.body)),
      credentials: 'same-origin',
      signal: opciones.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ErrorApi(0, 'No se pudo conectar con el servidor.');
  }
}

async function errorDe(respuesta: Response): Promise<ErrorApi> {
  let mensaje = `Error ${respuesta.status}`;
  let cuerpo: Partial<ErrorCuerpo> | undefined;
  try {
    cuerpo = (await respuesta.json()) as Partial<ErrorCuerpo>;
    if (Array.isArray(cuerpo.message)) mensaje = cuerpo.message.join('. ');
    else if (typeof cuerpo.message === 'string') mensaje = cuerpo.message;
  } catch {
    // Cuerpo que no es JSON: se queda el mensaje genérico.
  }
  return new ErrorApi(respuesta.status, mensaje, cuerpo);
}

/**
 * Las rutas de auth NUNCA disparan el refresh ante un 401, y es a propósito:
 *
 * - `/auth/login`: un 401 son credenciales malas. Si se refrescara, en una máquina
 *   donde otro usuario cerró sesión sin que su logout llegara a la API (sin red: su
 *   cookie de refresh sigue viva, ver `marcaCierre.ts`) una contraseña mal escrita
 *   entraría COMO ESE OTRO USUARIO.
 *   Además cada reintento contaría contra el límite de 5 intentos por minuto.
 * - `/auth/refresh`: refrescar para reintentar el refresh es un bucle.
 * - `/auth/me`: el estado de sesión sale del `SesionDto` del login/refresh, no de
 *   `/me`. Si algún día se usa `/me` al arrancar, va DESPUÉS del refresh
 *   silencioso, nunca en su lugar.
 */
function disparaRefresh(ruta: string): boolean {
  return !ruta.startsWith('/auth/');
}

/**
 * Request a la API con el access token en memoria. Ante un 401 (fuera de `/auth/`)
 * refresca UNA vez —compartiendo el refresh en vuelo— y reintenta UNA vez. Si la
 * API dice que ya no hay sesión, la sesión expira y se lanza `ErrorApi(401)`.
 */
export async function pedir<T>(ruta: string, opciones: OpcionesPedir = {}): Promise<T> {
  const respuesta = await responder(ruta, opciones, 'application/json');
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

/**
 * Un archivo de la API (F2-106: el XML o el PDF de un CFDI) con la misma sesión y el mismo
 * refresh que `pedir`. Devuelve los bytes; el que llama decide cómo guardarlos.
 */
export async function pedirArchivo(ruta: string, opciones: OpcionesPedir = {}): Promise<Blob> {
  const respuesta = await responder(ruta, opciones, '*/*');
  return respuesta.blob();
}

/** El request con refresh ante 401 (ver `pedir`). Lanza `ErrorApi` si la respuesta no es ok. */
async function responder(ruta: string, opciones: OpcionesPedir, acepta: string): Promise<Response> {
  let respuesta = await enviar(ruta, opciones, tokenActual(), acepta);

  if (respuesta.status === 401 && disparaRefresh(ruta)) {
    let sesion;
    try {
      sesion = await refrescarSesion();
    } catch {
      throw new ErrorApi(0, 'No se pudo renovar la sesión.');
    }
    if (sesion === null) {
      if (tokenActual() !== null) terminarSesion('expirada');
      throw new ErrorApi(401, 'Tu sesión expiró.');
    }
    respuesta = await enviar(ruta, opciones, sesion.accessToken, acepta);
  }

  if (!respuesta.ok) throw await errorDe(respuesta);
  return respuesta;
}
