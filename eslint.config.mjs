import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = [
  'apps/**/*.{ts,tsx}',
  'e2e/**/*.ts',
  'packages/**/*.{ts,tsx}',
];
const clientFiles = [
  'apps/web/**/*.{ts,tsx}',
  'apps/mobile/**/*.{ts,tsx}',
  'apps/creator-studio/**/*.{ts,tsx}',
  'apps/admin/**/*.{ts,tsx}',
];
// Every workspace the backend runtime can import. Kept in step with the
// structurally derived scope reported by `pnpm boundaries`.
const serverFiles = [
  'apps/api/**/*.{ts,tsx}',
  'packages/config/**/*.{ts,tsx}',
  'packages/domain/**/*.{ts,tsx}',
  'packages/observability/**/*.{ts,tsx}',
  'packages/types/**/*.{ts,tsx}',
  'packages/validation/**/*.{ts,tsx}',
];
const applicationPackages = [
  '@velora/admin',
  '@velora/api',
  '@velora/creator-studio',
  '@velora/mobile',
  '@velora/web',
];
const forbiddenNetworkGlobals = [
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
  'fetch',
];
const forbiddenNetworkModules = [
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:tls',
  'node:dgram',
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'undici',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: sourceFiles,
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: clientFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@velora/domain',
            '@velora/domain/*',
            '@velora/config/server',
            '@velora/observability/server',
            '@nestjs/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'pg-boss',
            'ioredis',
            'apps/*',
            ...applicationPackages,
            ...applicationPackages.map((name) => `${name}/*`),
          ],
        },
      ],
    },
  },
  {
    files: serverFiles,
    rules: {
      'no-restricted-globals': [
        'error',
        ...forbiddenNetworkGlobals.map((name) => ({
          name,
          message: 'Use registered OutboundHttp or retrieval ports.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: forbiddenNetworkModules.map((name) => ({
            name,
            message: 'Use registered OutboundHttp or retrieval ports.',
          })),
          patterns: [
            'node:http/*',
            'node:https/*',
            'undici/*',
            ...applicationPackages,
            ...applicationPackages.map((name) => `${name}/*`),
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.config.{js,mjs,ts}',
      'scripts/**/*.mjs',
      'apps/**/scripts/**/*.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
);
