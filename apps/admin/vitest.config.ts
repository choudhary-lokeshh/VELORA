import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * The App Router's navigation hooks need a router context that only exists
 * inside a running Next.js application, so the unit suite resolves them to a
 * recorder instead. Nothing in `src/` knows: the surface imports `next/link` and
 * `next/navigation` exactly as it does in production, and a test asserts where
 * it navigated rather than watching a page change.
 *
 * Real navigation, real focus, and real activation semantics are proved in
 * Playwright, where all three are real.
 */
export default defineConfig({
  oxc: { jsx: { importSource: 'react', runtime: 'automatic' } },
  resolve: {
    alias: {
      'next/link': fileURLToPath(
        new URL('./test/support/navigation.tsx', import.meta.url),
      ),
      'next/navigation': fileURLToPath(
        new URL('./test/support/navigation.tsx', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
