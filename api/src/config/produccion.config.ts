/**
 * Revisión del entorno al arrancar con `NODE_ENV=production` (deploy en Railway).
 *
 * Cada módulo ya valida lo suyo cuando lo lee (los JWT_* en `auth.config.ts`, los
 * adaptadores en `adaptadores/config.ts`, `PANEL_URL` en `reportes/config.ts`), pero lo
 * hace uno por uno y a mitad del arranque de Nest: el primer error tapa a los demás, y
 * ninguno se da cuenta de que un secreto es el RELLENO de `api/.env.example` (tiene 32+
 * caracteres y pasa). Esto corre ANTES de crear la app, junta TODOS los problemas en un
 * solo mensaje y no imprime nunca un valor, sólo nombres de variables.
 *
 * Fuera de producción no hace nada: el desarrollo local vive del relleno a propósito.
 */

/** Sin estas la API no tiene sentido en producción (o no arranca a medio camino). */
export const OBLIGATORIAS_PRODUCCION = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'PANEL_URL',
  'TRUST_PROXY_SALTOS',
] as const;

/**
 * Secretos que, SI están puestos, no pueden ser de relleno. Los obligatorios de arriba
 * también pasan por aquí.
 */
export const SECRETOS_PRODUCCION = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DOCS_PASSWORD',
  'ADMIN_INICIAL_PASSWORD',
  'ARCHIVOS_SECRETO',
  'FACTURAMA_PASSWORD',
  'BREVO_API_KEY',
  'VAPID_PRIVATE_KEY',
] as const;

/**
 * Las marcas de un valor de relleno: las de `api/.env.example` ("relleno-local-…-cambia-esto",
 * "cambiar-en-local"), las de `infra/railway.env.example` ("<GENERAR…>", "<PEGAR…>"), las
 * sintéticas de los tests y del CI ("sintetico", "no-usar"), y las genéricas.
 */
const MARCAS_RELLENO =
  /relleno|cambia-?esto|cambiar[-_ ]en|sintetico|no-usar|<\s*(generar|pegar)|pega[-_]aqui|changeme|placeholder/i;

export function esRelleno(valor: string): boolean {
  return MARCAS_RELLENO.test(valor);
}

export interface RevisionProduccion {
  /** Lo que impide arrancar. Vacío = se puede arrancar. */
  errores: string[];
  /** Lo que arranca pero conviene que se vea en el log del deploy. */
  avisos: string[];
}

function vacia(valor: string | undefined): boolean {
  return valor === undefined || valor.trim() === '';
}

export function revisarEntornoProduccion(entorno: NodeJS.ProcessEnv): RevisionProduccion {
  const errores: string[] = [];
  const avisos: string[] = [];
  if (entorno.NODE_ENV !== 'production') return { errores, avisos };

  for (const nombre of OBLIGATORIAS_PRODUCCION) {
    if (vacia(entorno[nombre])) errores.push(`${nombre} es obligatoria con NODE_ENV=production.`);
  }

  for (const nombre of SECRETOS_PRODUCCION) {
    const valor = entorno[nombre];
    if (!vacia(valor) && esRelleno(valor!)) {
      errores.push(
        `${nombre} trae un valor de relleno de los .env.example. Genera uno propio ` +
          '(`openssl rand -base64 48`) y ponlo directo en las variables del servicio.',
      );
    }
  }

  const baseUrl = entorno.DATABASE_URL ?? '';
  // La cadena de `api/.env.example` (usuario y contraseña `monitor`), o una de relleno.
  if (/\/\/monitor:monitor@/.test(baseUrl) || esRelleno(baseUrl)) {
    errores.push(
      'DATABASE_URL es la de desarrollo de api/.env.example. En Railway, referencia la del ' +
        'Postgres del proyecto: DATABASE_URL=${{Postgres.DATABASE_URL}}.',
    );
  }

  const panel = entorno.PANEL_URL ?? '';
  if (/localhost|127\.0\.0\.1|ejemplo|example/i.test(panel)) {
    errores.push(
      'PANEL_URL apunta a localhost o a un dominio de ejemplo: es la base de los enlaces de los ' +
        'correos. Pon el dominio público del servicio web (https://…).',
    );
  }

  // Producción SIEMPRE va detrás de al menos un proxy (el Caddy del servicio web). Con 0,
  // todos los usuarios comparten la IP del proxy y el rate limit del login es global.
  const saltos = entorno.TRUST_PROXY_SALTOS?.trim();
  if (saltos !== undefined && saltos !== '' && /^\d+$/.test(saltos) && Number(saltos) < 1) {
    errores.push(
      'TRUST_PROXY_SALTOS=0 con NODE_ENV=production: la API va detrás del Caddy del servicio ' +
        'web, así que es 1 (docs/deploy-railway.md). Con 0 todos los usuarios comparten una IP ' +
        'y el límite de intentos de login es para el sistema entero.',
    );
  }

  if (vacia(entorno.DOCS_USUARIO) && vacia(entorno.DOCS_PASSWORD)) {
    avisos.push('/docs (Swagger) no se monta: sin DOCS_USUARIO/DOCS_PASSWORD.');
  }
  if (entorno.MODO_DEMO === '1') {
    avisos.push('MODO_DEMO=1: la interfaz marca TODO como "Datos de ejemplo".');
  }
  if (!vacia(entorno.ADMIN_INICIAL_PASSWORD)) {
    avisos.push(
      'ADMIN_INICIAL_PASSWORD sigue puesta. Si el admin inicial ya existe, bórrala de las ' +
        'variables del servicio: no se vuelve a usar.',
    );
  }

  return { errores, avisos };
}

/**
 * Lo que llama `main.ts`: truena con TODOS los errores juntos o devuelve los avisos para
 * el log.
 */
export function validarEntornoProduccion(entorno: NodeJS.ProcessEnv = process.env): string[] {
  const { errores, avisos } = revisarEntornoProduccion(entorno);
  if (errores.length > 0) {
    throw new Error(
      `La API no arranca: el entorno de producción tiene ${errores.length} problema(s):\n` +
        errores.map((e) => `  - ${e}`).join('\n'),
    );
  }
  return avisos;
}
