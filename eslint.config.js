import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'release',
    'release-smoke',
    'public/vendor/**',
    '.venv-qwen3tts/**',
    '.hf-home/**',
  ]),
  {
    files: ['electron/**/*.js', 'scripts/**/*.{js,mjs,cjs}'],
    extends: [
      js.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-empty': 'off',
      'no-extra-boolean-cast': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Source must log through the structured logger. Scripts and tests are
    // excluded on purpose: CLI output and test diagnostics use console directly.
    files: ['src/**/*.{ts,tsx,js,mjs,cjs}', 'electron/**/*.{js,mjs,cjs}'],
    rules: {
      'no-console': 'warn',
    },
  },
  {
    files: ['src/lib/logger.ts', 'electron/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
])
