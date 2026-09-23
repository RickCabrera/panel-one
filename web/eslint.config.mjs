// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import tema from './eslint/sin-colores.mjs';

// Igual que en /api: lint sin información de tipos. El gate de tipos de este
// carril es `npm run build`, que corre `tsc -b` antes de `vite build`.
export default tseslint.config(
  { ignores: ['dist/**', 'dist-landing/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  {
    // F2-211: ningún color escrito a mano fuera de los tokens. Todo color vive en
    // src/tema/paleta.ts; los componentes usan `bg-fondo`, `text-tinta`... Los tests
    // quedan fuera porque tienen que poder escribir un color para probar el contraste.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/tema/paleta.ts', 'src/**/*.test.{ts,tsx}'],
    plugins: { tema },
    rules: { 'tema/sin-colores': 'error' },
  },
  {
    files: [
      'vite.config.ts',
      'vite.landing.config.ts',
      'scripts/**/*.mjs',
      'eslint/**/*.mjs',
      'src/test-setup.ts',
      'src/**/*.test.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  prettierConfig,
);
