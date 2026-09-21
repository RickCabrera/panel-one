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
  // Siempre al final: apaga las reglas que pelean con prettier.
  prettierConfig,
);
