// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Igual que en /api: lint sin información de tipos. El gate de tipos de este
// carril es `npm run build`, que corre `tsc -b` antes de `vite build`.
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
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
    files: ['vite.config.ts', 'src/test-setup.ts', 'src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettierConfig,
);
