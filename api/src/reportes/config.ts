import { createHmac } from 'node:crypto';

/**
 * Configuración de los reportes programados (F2-141), leída al crear la app.
 *
 * - `REPORTES_INTERVALO_S`: cada cuántos segundos revisa el programador. 60 por defecto,
 *   0 lo apaga; en `NODE_ENV=test` va apagado (los tests corren la vuelta a mano).
 * - `PANEL_URL`: la base de los enlaces del correo (al panel y a la baja). Obligatoria con
 *   `NODE_ENV=production`: un correo con enlaces a `localhost` es un correo roto. Fuera de
 *   producción, `http://localhost:5173` (Vite).
 * - La llave que firma los enlaces de baja se DERIVA del secreto del access token con
 *   separación de dominio (HMAC con una etiqueta propia). Rotar ese secreto invalida los
 *   enlaces de baja de correos viejos; los correos nuevos traen el enlace bueno.
 */
export interface ReportesConfig {
  intervaloS: number;
  panelUrl: string;
  claveBaja: Buffer;
}

export const REPORTES_CONFIG = Symbol('REPORTES_CONFIG');
export const PANEL_URL_DESARROLLO = 'http://localhost:5173';
const ETIQUETA_BAJA = 'reportes-baja:v1';

export function intervaloReportesS(entorno: NodeJS.ProcessEnv): number {
  const crudo = entorno.REPORTES_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return entorno.NODE_ENV === 'test' ? 0 : 60;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`REPORTES_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`);
  }
  return n;
}

function leerPanelUrl(entorno: NodeJS.ProcessEnv): string {
  const valor = entorno.PANEL_URL?.trim();
  if (!valor) {
    if (entorno.NODE_ENV === 'production') {
      throw new Error(
        'PANEL_URL es obligatoria con NODE_ENV=production: es la base de los enlaces de los ' +
          'reportes por correo (p. ej. https://panel.midominio.mx).',
      );
    }
    return PANEL_URL_DESARROLLO;
  }
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`PANEL_URL="${valor}" no es una URL válida.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`PANEL_URL="${valor}" tiene que ser http o https.`);
  }
  if (entorno.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('PANEL_URL tiene que ser https con NODE_ENV=production.');
  }
  return valor.replace(/\/+$/, '');
}

export function leerReportesConfig(
  entorno: NodeJS.ProcessEnv,
  secretoAccess: string,
): ReportesConfig {
  return {
    intervaloS: intervaloReportesS(entorno),
    panelUrl: leerPanelUrl(entorno),
    claveBaja: createHmac('sha256', secretoAccess).update(ETIQUETA_BAJA).digest(),
  };
}
