import { constants, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `npm run setup:env` (F2-200): copia `api/.env.example` a `api/.env` si todavía
 * no existe. La API no arranca sin los JWT_* que trae ese archivo, y ninguna guía
 * decía "cópialo".
 *
 * NUNCA sobreescribe un `.env` que ya existe: puede traer secretos propios o una
 * `DATABASE_URL` distinta. Si existe, avisa y lo deja como está.
 */
export type ResultadoEnv = 'creado' | 'existia';

export function prepararEnv(dir: string): ResultadoEnv {
  const ejemplo = join(dir, '.env.example');
  const destino = join(dir, '.env');
  if (!existsSync(ejemplo)) {
    throw new Error(`No existe ${ejemplo}: no hay de dónde copiar.`);
  }
  if (existsSync(destino)) {
    return 'existia';
  }
  // COPYFILE_EXCL: si otro proceso lo crea entre el existsSync y aquí, truena en
  // vez de pisarlo.
  copyFileSync(ejemplo, destino, constants.COPYFILE_EXCL);
  return 'creado';
}

if (require.main === module) {
  const dir = join(__dirname, '..');
  try {
    const resultado = prepararEnv(dir);
    if (resultado === 'creado') {
      console.log('api/.env creado a partir de api/.env.example (valores de relleno para local).');
    } else {
      console.warn('api/.env ya existía: no se tocó. Compáralo con api/.env.example si falta algo.');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
