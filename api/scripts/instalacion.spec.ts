import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrato del arranque (F2-200). No necesita base: lee `api/package.json`.
 *
 * El `postinstall` es lo que hace que `npm ci` en la RAÍZ del monorepo deje el
 * cliente de Prisma generado. Sin él, el `postinstall` propio de `@prisma/client`
 * corre con el cwd en la raíz, no encuentra `prisma/schema.prisma` (vive en
 * `api/prisma/`) y deja un cliente vacío: 167 errores de tipos en `npm run dev`.
 * El CI no lo nota porque genera el cliente en un paso explícito.
 */
const API = join(__dirname, '..');
const paquete = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const scripts = paquete.scripts;

describe('contrato de instalación de /api', () => {
  it('npm ci genera el cliente de Prisma: postinstall = prisma generate', () => {
    expect(scripts.postinstall).toBeDefined();
    expect(scripts.postinstall).toMatch(/(^|&&\s*)prisma generate(\s|$)/);
  });

  it('`npm run seed` corre los tres seeds en orden: base, ventas, mesas', () => {
    const pasos = (scripts.seed ?? '').split('&&').map((paso) => paso.trim());
    expect(pasos).toEqual(['prisma db seed', 'npm run seed:ventas', 'npm run seed:mesas']);
    expect(scripts['seed:ventas']).toBe('ts-node prisma/seed-ventas.ts');
    expect(scripts['seed:mesas']).toBe('ts-node prisma/seed-mesas.ts');
    expect(existsSync(join(API, 'prisma', 'seed-ventas.ts'))).toBe(true);
    expect(existsSync(join(API, 'prisma', 'seed-mesas.ts'))).toBe(true);
  });

  it('`npm run setup:env` existe y apunta al script que copia .env.example', () => {
    expect(scripts['setup:env']).toBe('ts-node scripts/setup-env.ts');
    expect(existsSync(join(API, 'scripts', 'setup-env.ts'))).toBe(true);
    expect(existsSync(join(API, '.env.example'))).toBe(true);
  });
});
