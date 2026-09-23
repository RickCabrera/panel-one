import type { UsuarioToken } from '../auth/request-autenticado';
import type { EmpresaScope } from '../scope/empresa-scope';

/**
 * Lo que el handshake del socket (F2-142) deja en `socket.data` tras verificar el access token.
 * Como el `req.usuario`/`req.empresaScope` de HTTP: sale del token firmado por nosotros, nunca
 * de algo que mande el cliente después.
 */
export interface SesionSocket {
  usuario: UsuarioToken;
  scope: EmpresaScope;
  /** `exp` del access token, en ms epoch. */
  venceEnMs: number;
}

/** La forma de `socket.data` que usa el tiempo real. */
export interface DatosSocket {
  sesion?: SesionSocket;
  /** El timer que corta el socket cuando vence el token; se limpia al desconectar. */
  corte?: ReturnType<typeof setTimeout>;
  /** Sube con cada `suscribir`: una suscripción vieja que resuelve tarde no pisa a la nueva. */
  pedido?: number;
}

/**
 * La sesión del socket, VIGENTE en `ahora`, o null. Sin sesión (el middleware del handshake no
 * corrió o no la dejó) o con el token ya vencido, no hay sesión: el guard lo rechaza.
 */
export function sesionVigente(datos: unknown, ahora: number): SesionSocket | null {
  if (datos === null || typeof datos !== 'object') return null;
  const sesion = (datos as DatosSocket).sesion;
  if (!sesion || typeof sesion.venceEnMs !== 'number' || !(sesion.venceEnMs > ahora)) return null;
  if (!sesion.usuario || !sesion.scope) return null;
  return sesion;
}
