import { leerAdaptadoresConfig } from '../adaptadores/config';
import { leerDocsConfig } from '../openapi/docs';
import { leerOnboardingConfig } from '../onboarding/onboarding.config';
import { leerAdminInicial } from '../prisma/admin-inicial';
import { leerReportesConfig } from '../reportes/config';
import { leerAuthConfig } from './auth.config';
import { revisarEntornoProduccion } from './produccion.config';
import { leerTrustProxy } from './proxy.config';

/**
 * Paso 0 del arranque del contenedor (`api/docker-entrypoint.sh`), ANTES de `prisma migrate
 * deploy`: corre TODAS las lecturas de configuración que la API haría al crear sus módulos
 * (adaptadores, JWT, `PANEL_URL` y su formato, trust proxy, /docs, onboarding, admin inicial)
 * más la revisión de producción, y junta los errores en un solo mensaje. Así una variable mal
 * puesta no llega a migrar la base ni deja un deploy a medias, y el log dice TODO lo que falta de
 * una vez (sólo nombres y reglas, nunca valores: cada lector ya lo cumple).
 *
 * Fuera de producción también sirve (`node dist/config/validar-arranque.js`), con las reglas de
 * desarrollo de cada lector.
 */
export function erroresDeArranque(entorno: NodeJS.ProcessEnv = process.env): string[] {
  const errores = [...revisarEntornoProduccion(entorno).errores];
  const intentar = (leer: () => unknown): void => {
    try {
      leer();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      // La revisión de producción y un lector pueden decir lo mismo (p. ej. un JWT faltante).
      const variable = /^[A-Z][A-Z0-9_]+/.exec(mensaje)?.[0];
      const repetido =
        variable !== undefined && errores.some((x) => x.startsWith(`${variable} es obligatoria`));
      if (!repetido) errores.push(mensaje);
    }
  };

  intentar(() => leerAdaptadoresConfig(entorno));
  let secretoAccess: string | null = null;
  intentar(() => {
    secretoAccess = leerAuthConfig(entorno).accessSecret;
  });
  // El formato de PANEL_URL (URL válida; https en producción). La llave de baja sale del secreto
  // de access: si ése falló, se valida igual con uno de relleno que no se usa para nada.
  intentar(() => leerReportesConfig(entorno, secretoAccess ?? 'x'.repeat(32)));
  intentar(() => leerTrustProxy(entorno));
  intentar(() => leerDocsConfig(entorno));
  intentar(() => leerOnboardingConfig(entorno));
  intentar(() => leerAdminInicial(entorno));
  return errores;
}

export function validarArranque(entorno: NodeJS.ProcessEnv = process.env): void {
  const errores = erroresDeArranque(entorno);
  if (errores.length > 0) {
    throw new Error(
      `La API no arranca: el entorno tiene ${errores.length} problema(s):\n` +
        errores.map((e) => `  - ${e}`).join('\n'),
    );
  }
}

if (require.main === module) {
  try {
    validarArranque();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
