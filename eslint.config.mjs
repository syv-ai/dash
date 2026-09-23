import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import checkFile from 'eslint-plugin-check-file';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', '**/*.config.{js,cjs,mjs,ts}'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        // This repo has two sibling tsconfigs with non-standard names (renderer + main)
        // rather than project references, so list both explicitly — projectService would
        // only discover the root tsconfig.json and miss every src/main file.
        project: ['./tsconfig.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      // Type-aware rules — catch unhandled async in an async-heavy Electron app.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // React hooks correctness; deps are advisory (some effects intentionally manage deps).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Add-on boundary (docs/specs/2026-09-23-addons.md). An add-on imports only
  // the add-on API, its own files, Node built-ins and npm packages; core imports
  // add-ons only through the registry; the API imports nothing from main/renderer.
  {
    files: ['src/main/addons/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Add-ons reach Electron only through ctx.' }],
          patterns: [
            {
              group: ['@/*'],
              message: 'Add-ons may not import Dash core; use ctx from @shared/addon-api.',
            },
            {
              group: ['@shared/*', '!@shared/addon-api', '!@shared/addon-api/*'],
              message: 'Add-ons may import only @shared/addon-api from src/shared.',
            },
            {
              group: ['../../*', '../../**'],
              message: 'Add-ons may not import outside their own folder.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/addons/**', 'src/main/addonHost/registry.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/addons', '@/addons/*', '**/addons', '**/addons/*', '!@shared/addons'],
              message: 'Only src/main/addonHost/registry.ts imports add-ons.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/addon-api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '**/main/**', '**/renderer/**'],
              message: 'The add-on API must not depend on main or renderer code.',
            },
          ],
        },
      ],
    },
  },
  // File-naming convention (see CLAUDE.md > Code Style > File naming): PascalCase
  // for files whose primary export is a React component or class, camelCase for
  // function/value modules. Enforced where it maps cleanly to a directory;
  // src/main mixes class files (PascalCase) and function modules (camelCase) in
  // the same dirs, so it's documented but not globbed here.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        {
          // Components are PascalCase (MainContent.tsx, TaskModal.tsx)…
          'src/renderer/components/**/!(use*).tsx': 'PASCAL_CASE',
          // …but a co-located hook stays camelCase even when it needs JSX and
          // must therefore be .tsx (useWizardToasts.tsx).
          'src/renderer/components/**/use*.tsx': 'CAMEL_CASE',
          // Function/value modules are camelCase (hooks, stores, utils).
          'src/renderer/hooks/**/*.ts': 'CAMEL_CASE',
          'src/renderer/stores/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/renderer/utils/**/*.ts': 'CAMEL_CASE',
        },
        // Treat `format.test.ts` / `*.d.ts` as `format` / name — ignore the
        // middle extension when checking the base name's case.
        { ignoreMiddleExtensions: true },
      ],
    },
  },
);
