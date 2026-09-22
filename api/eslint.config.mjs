// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lint sin información de tipos a propósito: el gate de tipos de este carril es
// `npm run typecheck` (tsc --noEmit), que corre en el CI junto al lint. Las reglas
// type-aware son útiles y se pueden encender en F1-092 (hardening), pero atarlas
// al lint desde la primera tarea es lo que suele dejar el carril rojo por razones
// que no son el código.

// Los módulos que traen el cliente crudo, como regex de esquery (F2-203): la raíz
// y las subrutas de `@prisma/client`, el `.prisma/client` generado y `prisma.service`.
const MODULOS_PRISMA =
  '/^@prisma\\u002Fclient($|\\u002F)|(^|\\u002F)\\.prisma\\u002Fclient|(^|\\u002F)prisma\\.service$/';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  // EL SCOPE MULTIEMPRESA NO ES OPCIONAL (F1-011). Todo acceso a datos de negocio
  // pasa por `ScopedPrismaService.para(scope)`, que mete el filtro de empresa en
  // el WHERE. Importar el cliente crudo (PrismaService / PrismaClient) queda
  // prohibido en `src/` salvo esta allowlist, y cada entrada nueva es una
  // decisión que se justifica en el PR, no un atajo:
  //   - src/prisma/**: donde vive el cliente crudo.
  //   - src/scope/scoped-prisma.service.ts: el helper de scope en sí.
  //   - src/auth/auth.service.ts: el login busca por email antes de saber quién
  //     es el usuario; no hay scope que aplicar. El refresh y el cambio de
  //     contraseña propio (F1-060) leen y ESCRIBEN sólo la fila del usuario del
  //     token, por su id: sin datos de negocio ni de otra empresa. Las sesiones
  //     (F1-093, `sesiones_usuario`) igual: por `sid` + `usuario_id` de un JWT
  //     firmado o del usuario recién autenticado.
  //   - src/agentes/agentes-auth.service.ts: igual que el login, busca la
  //     sucursal por el hash de la API key ANTES de saber de qué empresa es el
  //     request (F1-012). Sólo tiene esa lectura.
  //   - src/adaptadores/correo/correo-falso.ts (F2-202): el correo FALSO sólo hace
  //     INSERT en su propia bandeja (`correos_enviados`), sin lecturas ni datos de
  //     negocio de ninguna empresa. Exporta el cliente reducido a esa tabla para que
  //     el módulo de adaptadores no tenga que importarlo. Sólo ese archivo: el resto
  //     de `src/adaptadores/` sigue bajo la regla.
  //   - *.spec.ts: los tests arman y limpian fixtures directamente.
  // `src/lint/restriccion-prisma.spec.ts` comprueba que la regla sí muerde.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/prisma/**',
      'src/scope/scoped-prisma.service.ts',
      'src/auth/auth.service.ts',
      'src/agentes/agentes-auth.service.ts',
      'src/adaptadores/correo/correo-falso.ts',
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message: 'Lee datos con ScopedPrismaService.para(scope), no con el cliente crudo.',
            },
          ],
          patterns: [
            {
              regex: '(^|/)prisma\\.service$',
              message: 'Lee datos con ScopedPrismaService.para(scope), no con PrismaService.',
            },
            // F2-203: las subrutas traen el mismo cliente crudo por otra puerta.
            {
              regex: '^@prisma/client/|(^|/)\\.prisma/client',
              message: 'Lee datos con ScopedPrismaService.para(scope), no con el cliente crudo.',
            },
          ],
        },
      ],
      // F2-203: `no-restricted-imports` sólo ve `import ... from`. Estas tres formas
      // (`require()`, `import x = require()` e `import()` dinámico) cargaban el
      // cliente crudo sin que la regla de arriba lo notara. En ellas no se pueden
      // separar tipos de valores: se prohíben enteras para esos módulos.
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=${MODULOS_PRISMA}]`,
          message: 'Lee datos con ScopedPrismaService.para(scope), no con el cliente crudo.',
        },
        {
          selector: `TSExternalModuleReference[expression.value=${MODULOS_PRISMA}]`,
          message: 'Lee datos con ScopedPrismaService.para(scope), no con el cliente crudo.',
        },
        {
          selector: `ImportExpression[source.value=${MODULOS_PRISMA}]`,
          message: 'Lee datos con ScopedPrismaService.para(scope), no con el cliente crudo.',
        },
      ],
    },
  },
  // Siempre al final: apaga las reglas que pelean con prettier.
  prettierConfig,
);
