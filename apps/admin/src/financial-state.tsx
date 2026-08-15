'use client';

import { useCallback, useEffect, useState } from 'react';

import { createVeloraApiClient } from '@velora/api-client';
import { formatMinorUnits } from '@velora/validation';

/**
 * The platform's money, as an operator sees it.
 *
 * A read and only a read. There is no control on this screen that changes a
 * financial row, because there is no operation in the API that does: the one
 * financial action an operator has is issuing a refund, and that goes through
 * BILLING's own service with an operator's authority, a reason, and a record.
 * A screen with an editable amount on it is a screen somebody eventually edits.
 *
 * Nothing here identifies anybody. No consumer, no creator, no provider object,
 * no payout recipient, no bank detail, no identity document, and no secret —
 * counts and per-currency totals, which is what an operator actually needs and
 * the most a screen should ever hold.
 *
 * There is no cross-currency total. Adding a euro to a yen produces a number
 * with no meaning, and an operator would act on it.
 *
 * The capability row reports adapter names rather than a boolean, because "off"
 * and "off because nobody has approved one" are different situations and an
 * operator seeing `unavailable` across the row is seeing the second.
 */

interface StateRow {
  readonly count: number;
  readonly state: string;
}

interface CurrencyTotal {
  readonly amountMinor: string;
  readonly currency: string;
}

interface FinancialState {
  readonly capabilities: Readonly<Record<string, string>>;
  readonly disputes: readonly StateRow[];
  readonly openDisputeTotals: readonly CurrencyTotal[];
  readonly payableTotals: readonly CurrencyTotal[];
  readonly payments: readonly StateRow[];
  readonly payouts: readonly StateRow[];
  readonly reconciliation: readonly StateRow[];
  readonly refunds: readonly StateRow[];
  readonly subscriptions: readonly StateRow[];
}

type Phase =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: FinancialState }
  | { readonly kind: 'unauthorised' };

function StateList({
  rows,
  testId,
  title,
}: {
  readonly rows: readonly StateRow[];
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={`${testId}-heading`}>
      <h3 id={`${testId}-heading`}>{title}</h3>
      {rows.length === 0 ? (
        <p data-testid={`${testId}-empty`}>None.</p>
      ) : (
        <dl>
          {rows.map((row) => (
            <div key={row.state}>
              <dt>{row.state}</dt>
              <dd data-testid={`${testId}-${row.state}`}>{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function TotalList({
  rows,
  testId,
  title,
}: {
  readonly rows: readonly CurrencyTotal[];
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={`${testId}-heading`}>
      <h3 id={`${testId}-heading`}>{title}</h3>
      {rows.length === 0 ? (
        <p data-testid={`${testId}-empty`}>Nothing.</p>
      ) : (
        <dl>
          {rows.map((row) => (
            <div key={row.currency}>
              <dt>{row.currency}</dt>
              <dd data-testid={`${testId}-${row.currency}`}>
                {formatMinorUnits(row.amountMinor, row.currency)} {row.currency}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function FinancialOperations({
  apiBaseUrl,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the screen renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(async () => {
    const api = createVeloraApiClient(apiBaseUrl, {
      ...(fetchImplementation === undefined
        ? {}
        : { fetch: fetchImplementation }),
    });
    const result = await api.GET('/v1/admin/billing/state', {
      credentials: 'include',
    });
    if (result.data === undefined) {
      // An operator who is not signed in, or whose step-up has gone stale, is
      // told which of those it is only to the extent the server tells anybody:
      // one answer for both, because which condition failed is not a caller's
      // business.
      setPhase(
        result.response.status === 401 || result.response.status === 403
          ? { kind: 'unauthorised' }
          : {
              kind: 'failed',
              message: 'The platform state could not be read.',
            },
      );
      return;
    }
    setPhase({ kind: 'ready', value: result.data });
  }, [apiBaseUrl, fetchImplementation]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === 'loading') {
    return (
      <p aria-live="polite" data-testid="financial-loading" role="status">
        Loading platform state…
      </p>
    );
  }
  if (phase.kind === 'unauthorised') {
    return (
      <p data-testid="financial-unauthorised" role="alert">
        This surface requires a Platform Admin session with a recent
        phishing-resistant authenticator. No such verifier is approved, so
        nothing here is reachable in a deployed environment.
      </p>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <div>
        <p data-testid="financial-failed" role="alert">
          {phase.message}
        </p>
        <button
          onClick={() => {
            void load();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  const capabilities = Object.entries(phase.value.capabilities).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  return (
    <div data-testid="financial-state">
      <section aria-labelledby="capabilities-heading">
        <h3 id="capabilities-heading">Capability state</h3>
        <dl>
          {capabilities.map(([name, adapter]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd data-testid={`capability-${name}`}>{adapter}</dd>
            </div>
          ))}
        </dl>
      </section>

      <StateList
        rows={phase.value.reconciliation}
        testId="reconciliation"
        title="Needs attention"
      />
      <StateList
        rows={phase.value.payments}
        testId="payments"
        title="Payments"
      />
      <StateList rows={phase.value.refunds} testId="refunds" title="Refunds" />
      <StateList
        rows={phase.value.disputes}
        testId="disputes"
        title="Disputes"
      />
      <StateList
        rows={phase.value.subscriptions}
        testId="subscriptions"
        title="Subscriptions"
      />
      <StateList rows={phase.value.payouts} testId="payouts" title="Payouts" />
      <TotalList
        rows={phase.value.openDisputeTotals}
        testId="disputed-total"
        title="Being claimed back"
      />
      <TotalList
        rows={phase.value.payableTotals}
        testId="payable-total"
        title="Owed to creators"
      />
    </div>
  );
}
