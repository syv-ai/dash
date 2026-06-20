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
          // Components are PascalCase (MainContent.tsx, TaskModal.tsx).
          'src/renderer/components/**/*.tsx': 'PASCAL_CASE',
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
