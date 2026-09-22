import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepararEnv } from './setup-env';

describe('prepararEnv (npm run setup:env)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'f2-200-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('crea .env como copia exacta de .env.example cuando no existe', () => {
    writeFileSync(join(dir, '.env.example'), 'JWT_ACCESS_SECRET=relleno\n');

    expect(prepararEnv(dir)).toBe('creado');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('JWT_ACCESS_SECRET=relleno\n');
  });

  it('no toca un .env que ya existe', () => {
    writeFileSync(join(dir, '.env.example'), 'JWT_ACCESS_SECRET=relleno\n');
    writeFileSync(join(dir, '.env'), 'JWT_ACCESS_SECRET=el-mio\n');

    expect(prepararEnv(dir)).toBe('existia');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('JWT_ACCESS_SECRET=el-mio\n');
  });

  it('falla con un mensaje claro si no hay .env.example, sin crear nada', () => {
    expect(() => prepararEnv(dir)).toThrow(/\.env\.example/);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });
});
