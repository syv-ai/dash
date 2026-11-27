import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import checkFile from 'eslint-plugin-check-file';
import globals from 'globals';
import { plugin as shadcn } from '@shadcn/lint';

// Motion is calm (U6): every transition and animation takes a motion token
// (`duration-quick|calm|slow`, `ease-settle|calm`, or `MOTION_MS`/`EASE` from
// lib/motion), never an ad-hoc length or curve. Flags a Tailwind
// `duration-N`/`duration-[…]` or stock `ease-*` class, and an inline
// `'<prop> Nms <curve>'` transition, in strings and templates alike.
const AD_HOC_MOTION =
  '/(^|[\\s:])(duration-(\\d|\\[)|ease-(in|out|in-out|linear|\\[))|\\d+m?s (ease|linear|cubic-bezier)/';
const adHocMotion = [
  `Literal[value=${AD_HOC_MOTION}]`,
  `TemplateElement[value.raw=${AD_HOC_MOTION}]`,
].map((selector) => ({
  selector,
  message:
    'Motion is calm: use a motion token (duration-quick|calm|slow, ease-settle|calm, lib/motion), never an ad-hoc duration or curve.',
}));

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
        // This repo has sibling tsconfigs with non-standard names (renderer and main)
        // rather than project references, so list them explicitly — projectService
        // would only discover the root tsconfig.json and miss src/main.
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
  // Design-system lint (renderer only). Warnings, not errors, while the UI
  // overhaul migrates call sites; components/ui/ owns raw styling and is exempt.
  // The theme is discovered from src/renderer/index.css (the one stylesheet
  // importing Tailwind); components are whatever is imported from a ui/ folder.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { shadcn },
    settings: {
      shadcn: {
        componentImports: ['(^|/)ui/[A-Z][A-Za-z]*$'],
        note: 'Tokens and type scale live in src/renderer/index.css; primitives in src/renderer/components/ui/.',
      },
    },
    rules: {
      'shadcn/no-arbitrary-values': 'warn',
      'shadcn/no-raw-colors': 'warn',
      'shadcn/no-inline-styles': 'warn',
      'shadcn/no-unknown-classes': 'warn',
      'shadcn/no-restyle': ['warn', { allow: ['layout'] }],
      'shadcn/require-static-classes': 'warn',
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'JSXOpeningElement[name.name=/^(button|input|select|textarea)$/]',
          message: 'Use the components/ui/ primitive instead of a raw form element.',
        },
        ...adHocMotion,
      ],
    },
  },
  {
    files: ['src/renderer/components/ui/**'],
    rules: {
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/no-raw-colors': 'off',
      'shadcn/no-inline-styles': 'off',
      'shadcn/no-unknown-classes': 'off',
      'shadcn/no-restyle': 'off',
      'shadcn/require-static-classes': 'off',
      // ui/ may use raw elements, but its motion takes the tokens too.
      'no-restricted-syntax': ['warn', ...adHocMotion],
    },
  },
  // One way to raise a toast: components/ui/toast (on sonner, headless).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/renderer/components/ui/toast.ts', 'src/renderer/components/ui/Toaster.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'sonner', message: 'Use components/ui/toast.' }] },
      ],
    },
  },
);
