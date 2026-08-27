import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminProviders, ToastProvider } from '../../src/app/providers';
import { Toaster } from '../../src/app/shell';
import { resetNavigation, setParams } from './navigation';
import type { AdminApiDouble } from './api-double';

/**
 * A screen, wired to the same providers the application wires.
 *
 * The console under test goes through the real session provider, the real
 * generated client, and a `fetch` that answers the real contract. Nothing is
 * stubbed inside a component, so a passing assertion is evidence about the
 * product rather than about the test's own mocks.
 *
 * This is the only place the screens behind the gate can be exercised at all:
 * no route in the contract issues a Platform Admin session, so no browser
 * reaches them. What a browser does reach — the door, the refusal, the layout,
 * and the keyboard — is proved in a browser.
 */
export const testApiBaseUrl = 'http://api.test';

export function renderConsole(
  ui: ReactNode,
  double: AdminApiDouble,
  options: {
    readonly appEnvironment?: string;
    readonly params?: Record<string, string>;
    readonly pathname?: string;
    readonly search?: string;
  } = {},
): RenderResult {
  resetNavigation(options.pathname ?? '/queues', options.search ?? '');
  setParams(options.params ?? {});
  return render(
    <ToastProvider>
      <AdminProviders
        apiBaseUrl={testApiBaseUrl}
        appEnvironment={options.appEnvironment ?? 'production'}
        fetchImplementation={double.fetch}
      >
        {ui}
        <Toaster />
      </AdminProviders>
    </ToastProvider>,
  );
}
