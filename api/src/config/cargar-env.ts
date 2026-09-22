import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Carga `api/.env` en `process.env` al arrancar la API y los seeds (F2-200).
 *
 * Hasta F2-200 nada lo leía fuera de la CLI de Prisma: la CLI sí carga ese archivo para
 * sus comandos, pero el cliente no lo vuelca a `process.env`, y no hay dotenv ni
 * ConfigModule. `npm run dev` con un `api/.env` recién copiado moría con
 * "JWT_ACCESS_SECRET es obligatorio" (reproducido en docs/verificacion-arranque.md).
 *
 * - Sólo si el archivo existe. Sin archivo (CI, producción con variables del
 *   sistema) no hace nada.
 * - Lo que ya está en el entorno GANA sobre el archivo (sólo se asignan las
 *   variables que no existen): así una corrida puede cambiar `PORT` o
 *   `DATABASE_URL` sin editar `.env`, y el CI sigue mandando. Es la misma regla de
 *   `node --env-file`; se hace a mano con `parseEnv` (el parser de Node) y no con
 *   `process.loadEnvFile` para que la precedencia quede escrita aquí y se pueda
 *   probar (jest aísla `process.env` y `loadEnvFile` escribe en el real).
 * - No afloja ninguna validación: `leerAuthConfig()` sigue exigiendo los JWT_*.
 *
 * La ruta sale de `__dirname`, no del cwd: desde `src/config/` (ts-node) y desde
 * `dist/config/` (nest build) llega igual a `api/.env`.
 */
export const RUTA_ENV_API = join(__dirname, '..', '..', '.env');

export function cargarEnvLocal(ruta: string = RUTA_ENV_API): boolean {
  if (!existsSync(ruta)) {
    return false;
  }
  const variables = parseEnv(readFileSync(ruta, 'utf8'));
  for (const [nombre, valor] of Object.entries(variables)) {
    if (process.env[nombre] === undefined && valor !== undefined) {
      process.env[nombre] = valor;
    }
  }
  return true;
}
