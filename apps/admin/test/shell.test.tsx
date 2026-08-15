import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlatformAdminShell from '../app/page';
import { FinancialOperations } from '../src/financial-state';

/**
 * The Platform Admin surface.
 *
 * Two properties are worth proving here and neither is about layout.
 *
 * The screen reads and cannot write. There is no control on it that changes a
 * financial row, because there is no operation in the API that does — and a
 * surface that offered one would be offering something the server would refuse.
 *
 * And it carries nothing that identifies anybody. Counts and per-currency
 * totals are what an operator needs; a consumer identifier, a provider
 * reference, a payout recipient, or a bank detail on this screen would be a
 * screen somebody eventually screenshots.
 */

// Vitest runs without global test APIs, so the automatic teardown React
// Testing Library installs when it can see them is registered here instead.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseUrl = 'http://api.test';

function respondWith(body: unknown, status = 200): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status,
      }),
    );
}

const deployedState = {
  capabilities: {
    commerceEligibility: 'unavailable',
    commercePolicy: 'unpublished',
    paymentProvider: 'unavailable',
    payoutPolicy: 'unpublished',
    payoutProvider: 'unavailable',
    taxAuthority: 'unavailable',
  },
  disputes: [],
  openDisputeTotals: [],
  payableTotals: [],
  payments: [],
  payouts: [],
  reconciliation: [],
  refunds: [],
  subscriptions: [],
};

describe('Platform Admin shell', () => {
  it('identifies its isolated privileged surface', () => {
    // The shell mounts the financial panel, which reads on mount. Stubbed so
    // the surface renders without a network — the panel's own behaviour is
    // asserted below against injected answers.
    vi.stubGlobal('fetch', respondWith({ code: 'ACTION_NOT_PERMITTED' }, 403));
    render(<PlatformAdminShell />);

    expect(
      screen.getByRole('heading', { name: 'Platform Admin' }),
    ).toBeDefined();
    expect(screen.queryByText('Creator Studio')).toBeNull();
  });
});

describe('Platform Admin financial operations', () => {
  it('says why nothing is reachable rather than showing an empty screen', async () => {
    render(
      <FinancialOperations
        apiBaseUrl={baseUrl}
        fetchImplementation={respondWith({ code: 'ACTION_NOT_PERMITTED' }, 403)}
      />,
    );

    // The state every deployed environment is in: no verifier can produce the
    // assurance ADR-0017 requires, so nothing here is reachable at all.
    const refusal = await screen.findByTestId('financial-unauthorised');
    expect(refusal.textContent).toContain('phishing-resistant');
  });

  it('reports each capability by the adapter that is configured', async () => {
    render(
      <FinancialOperations
        apiBaseUrl={baseUrl}
        fetchImplementation={respondWith(deployedState)}
      />,
    );
    await screen.findByTestId('financial-state');

    // Adapter names rather than a boolean, because "off" and "off because
    // nobody has approved one" are different situations.
    expect(screen.getByTestId('capability-paymentProvider').textContent).toBe(
      'unavailable',
    );
    expect(screen.getByTestId('capability-commercePolicy').textContent).toBe(
      'unpublished',
    );
    expect(screen.getByTestId('capability-taxAuthority').textContent).toBe(
      'unavailable',
    );
  });

  it('keeps currencies apart and offers no way to change anything', async () => {
    render(
      <FinancialOperations
        apiBaseUrl={baseUrl}
        fetchImplementation={respondWith({
          ...deployedState,
          openDisputeTotals: [{ amountMinor: '1500', currency: 'USD' }],
          payableTotals: [
            { amountMinor: '4000', currency: 'JPY' },
            { amountMinor: '1200', currency: 'USD' },
          ],
          payments: [{ count: 3, state: 'succeeded' }],
          reconciliation: [
            { count: 1, state: 'payment_reconciliation_pending' },
          ],
        })}
      />,
    );
    await screen.findByTestId('financial-state');

    // Each currency rendered against its own published exponent, and no total
    // that adds them: the sum of a yen and a dollar is not an amount.
    expect(screen.getByTestId('payable-total-JPY').textContent).toBe(
      '4000 JPY',
    );
    expect(screen.getByTestId('payable-total-USD').textContent).toBe(
      '12.00 USD',
    );
    expect(screen.getByTestId('disputed-total-USD').textContent).toBe(
      '15.00 USD',
    );
    expect(
      screen.getByTestId('reconciliation-payment_reconciliation_pending')
        .textContent,
    ).toBe('1');

    // No field, no editable amount, and no control that writes. The only
    // financial action an operator has goes through BILLING's own service.
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('carries nothing that identifies anybody', async () => {
    render(
      <FinancialOperations
        apiBaseUrl={baseUrl}
        fetchImplementation={respondWith({
          ...deployedState,
          payments: [{ count: 2, state: 'succeeded' }],
        })}
      />,
    );
    await screen.findByTestId('financial-state');

    await waitFor(() => {
      const markup = document.body.textContent;
      for (const forbidden of [
        'consumer',
        'lt_',
        'lp_',
        'IBAN',
        'account number',
        'secret',
      ]) {
        expect(markup.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });
});
