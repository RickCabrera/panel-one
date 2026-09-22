import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { cargarEnvLocal, RUTA_ENV_API } from './cargar-env';

describe('cargarEnvLocal (api/.env en runtime)', () => {
  const VARS = ['F2_200_SOLO_ARCHIVO', 'F2_200_EN_AMBOS'];
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'f2-200-cargar-'));
    for (const v of VARS) delete process.env[v];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const v of VARS) delete process.env[v];
  });

  it('apunta a api/.env, sea desde src/ o desde dist/', () => {
    expect(RUTA_ENV_API).toBe(resolve(__dirname, '..', '..', '.env'));
  });

  it('carga las variables del archivo cuando existe', () => {
    const ruta = join(dir, '.env');
    writeFileSync(ruta, '# comentario\nF2_200_SOLO_ARCHIVO=del-archivo\n');

    expect(cargarEnvLocal(ruta)).toBe(true);
    expect(process.env.F2_200_SOLO_ARCHIVO).toBe('del-archivo');
  });

  it('lo que ya está en el entorno gana sobre el archivo', () => {
    const ruta = join(dir, '.env');
    writeFileSync(ruta, 'F2_200_EN_AMBOS=del-archivo\n');
    process.env.F2_200_EN_AMBOS = 'del-entorno';

    cargarEnvLocal(ruta);
    expect(process.env.F2_200_EN_AMBOS).toBe('del-entorno');
  });

  it('sin archivo no hace nada y no truena', () => {
    expect(cargarEnvLocal(join(dir, 'no-existe.env'))).toBe(false);
    expect(process.env.F2_200_SOLO_ARCHIVO).toBeUndefined();
  });
});
