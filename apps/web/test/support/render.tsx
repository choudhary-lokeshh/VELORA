import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ToastProvider, VeloraProviders } from '../../src/app/providers';
import { Toaster } from '../../src/app/shell';
import { resetNavigation } from './navigation';
import type { ApiDouble } from './api-double';

/**
 * A screen, wired to the same providers the application wires.
 *
 * The surface under test goes through the real session, account, and feed
 * providers, the real generated client, and a `fetch` that answers the real
 * contract. Nothing is stubbed inside a component, so a passing assertion is
 * evidence about the product rather than about the test's own mocks.
 */
export const testApiBaseUrl = 'http://api.test';

export function renderProduct(
  ui: ReactNode,
  double: ApiDouble,
  options: { readonly pathname?: string; readonly search?: string } = {},
): RenderResult {
  resetNavigation(options.pathname ?? '/', options.search ?? '');
  return render(
    <ToastProvider>
      <VeloraProviders
        apiBaseUrl={testApiBaseUrl}
        fetchImplementation={double.fetch}
      >
        {ui}
        <Toaster />
      </VeloraProviders>
    </ToastProvider>,
  );
}
