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
      // Existing main-process JS predates this gate. Keep the first pass
      // focused on real undefined/runtime hazards, then tighten unused symbols
      // after the Electron files move toward typed modules.
      'no-unused-vars': 'off',
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
])
