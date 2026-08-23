import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { StudioProviders, ToastProvider } from '../../src/app/providers';
import { Toaster } from '../../src/app/shell';
import { resetNavigation, setParams } from './navigation';
import type { CreatorApiDouble } from './api-double';

/**
 * A screen, wired to the same providers the application wires.
 *
 * The surface under test goes through the real session and creator providers,
 * the real generated client, and a `fetch` that answers the real contract.
 * Nothing is stubbed inside a component, so a passing assertion is evidence
 * about the product rather than about the test's own mocks.
 */
export const testApiBaseUrl = 'http://api.test';

export function renderStudio(
  ui: ReactNode,
  double: CreatorApiDouble,
  options: {
    readonly params?: Record<string, string>;
    readonly pathname?: string;
    readonly search?: string;
  } = {},
): RenderResult {
  resetNavigation(options.pathname ?? '/home', options.search ?? '');
  setParams(options.params ?? {});
  return render(
    <ToastProvider>
      <StudioProviders
        apiBaseUrl={testApiBaseUrl}
        fetchImplementation={double.fetch}
      >
        {ui}
        <Toaster />
      </StudioProviders>
    </ToastProvider>,
  );
}
