import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// La regla `no-restricted-imports` de eslint.config.mjs es lo que hace
// OBLIGATORIO el helper de scope. Si está mal escrita (un glob que no casa, una
// allowlist de más), el lint pasa en verde y nadie se entera. Esto la ejercita
// con código de ejemplo, corriendo el ESLint real del carril con su config real.
//
// Va por proceso aparte (`eslint --stdin`) porque la config es ESM (.mjs) y el
// runtime CommonJS de jest no la puede cargar en proceso.

const RAIZ_API = join(__dirname, '..', '..');
// `eslint/bin/eslint.js` no está en los `exports` del paquete: se llega desde su package.json.
const ESLINT_BIN = join(
  dirname(require.resolve('eslint/package.json', { paths: [RAIZ_API] })),
  'bin',
  'eslint.js',
);

interface Mensaje {
  ruleId: string | null;
}

function lint(archivo: string, codigo: string): string[] {
  const r = spawnSync(
    process.execPath,
    [ESLINT_BIN, '--stdin', '--stdin-filename', archivo, '--format', 'json'],
    { cwd: RAIZ_API, input: codigo, encoding: 'utf8' },
  );
  if (!r.stdout) {
    throw new Error(`ESLint no devolvió resultados: ${r.stderr}`);
  }
  const [resultado] = JSON.parse(r.stdout) as Array<{ messages: Mensaje[] }>;
  return resultado.messages.map((m) => m.ruleId ?? 'error-de-parseo');
}

const IMPORTA_SERVICIO = `import { PrismaService } from '../prisma/prisma.service';\nexport const x = PrismaService;\n`;
const IMPORTA_CLIENTE = `import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n`;
const IMPORTA_TODO = `import * as p from '@prisma/client';\nexport const x = p;\n`;
const IMPORTA_TIPOS = `import { RolUsuario } from '@prisma/client';\nexport const x = RolUsuario.visor;\n`;

describe('Regla de lint: el cliente crudo de Prisma no se importa fuera de la allowlist', () => {
  const fuera = 'src/ventas/ventas.service.ts';

  it.each([
    ['PrismaService', IMPORTA_SERVICIO],
    ['PrismaClient', IMPORTA_CLIENTE],
    ['import * de @prisma/client', IMPORTA_TODO],
  ])('prohíbe %s en un servicio de datos', (_nombre, codigo) => {
    expect(lint(fuera, codigo)).toContain('no-restricted-imports');
  });

  it('deja importar tipos y enums de @prisma/client', () => {
    expect(lint(fuera, IMPORTA_TIPOS)).toEqual([]);
  });

  it.each([
    'src/auth/auth.service.ts',
    'src/scope/scoped-prisma.service.ts',
    'src/prisma/prisma.module.ts',
  ])('permite el cliente crudo en %s (allowlist)', (archivo) => {
    expect(lint(archivo, IMPORTA_SERVICIO)).toEqual([]);
  });

  it('NO permite el cliente crudo en el resto de auth', () => {
    expect(lint('src/auth/auth.controller.ts', IMPORTA_SERVICIO)).toContain(
      'no-restricted-imports',
    );
  });
});
