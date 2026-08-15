'use client';

import { useCallback, useState } from 'react';

import type {
  CreatorApi,
  CreatorPayoutBalance,
  CreatorPayoutHistory,
  CreatorPayoutReadiness,
} from '@velora/creator-client';
import { formatAmount, formatMoney, isOk } from '@velora/creator-client';

import { useResource } from './resource';
import {
  EmptyState,
  ErrorMessage,
  ResourceState,
  Section,
  StatusMessage,
} from './ui';

/**
 * Getting paid, and being told plainly when that is not possible.
 *
 * Two things can stop a payout and they are shown as two things, because a
 * creator whose provider record is fine but whose platform has published no
 * settlement terms should not be sent off to finish onboarding they have
 * already finished. In every deployed environment both are true at once: no
 * payout provider is eligible for Velora's business model, and no settlement
 * window, reserve, or minimum payout is published.
 *
 * The balances are shown anyway. The money is real whatever the platform can
 * currently do with it, and hiding a figure does not change what is owed.
 *
 * Onboarding is a link into somebody else's flow. This surface has no bank
 * field, no document upload, and no identity form — not disabled, absent —
 * because the provider collects, verifies, and keeps all of it, and Velora
 * holds a reference to the record and nothing more.
 */

/** Why a payout is not currently possible, said in the creator's terms. */
function blockedReason(readiness: CreatorPayoutReadiness): string | undefined {
  if (readiness.providerSource === 'unavailable') {
    return 'Payouts are not available yet: no payout provider is approved for this platform.';
  }
  if (readiness.policySource === 'unpublished') {
    return 'Payouts are not available yet: the settlement terms that decide when earnings can be withdrawn are not published.';
  }
  if (readiness.recipientStatus === 'absent') {
    return 'You have not set up payouts yet. Setting up opens your payout provider’s own onboarding.';
  }
  if (readiness.recipientStatus === 'onboarding') {
    return 'Your payout provider has not finished checking your details yet.';
  }
  if (readiness.recipientStatus === 'restricted') {
    return 'Your payout provider cannot pay you at the moment.';
  }
  return undefined;
}

export function Payouts({
  api,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
}) {
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const loadReadiness = useCallback(async () => api.payoutReadiness(), [api]);
  const loadPayouts = useCallback(async () => api.payouts(), [api]);
  const readiness = useResource<CreatorPayoutReadiness>(loadReadiness, {
    onUnauthenticated: onSessionEnded,
  });
  const history = useResource<CreatorPayoutHistory>(loadPayouts, {
    onUnauthenticated: onSessionEnded,
  });

  const state = readiness.value;
  const blocked = state === undefined ? undefined : blockedReason(state);
  const balances = state?.balances ?? [];

  const onboard = async () => {
    setBusy(true);
    setFailure(undefined);
    const result = await api.startPayoutOnboarding();
    setBusy(false);
    if (!isOk(result)) {
      setFailure('Payout onboarding could not be started.');
      return;
    }
    // The provider's own page. Velora does not render it and does not proxy it.
    window.location.assign(result.value.onboardingUrl);
  };

  const withdraw = async (
    currency: CreatorPayoutBalance['currency'],
    amountMinor: string,
  ) => {
    setBusy(true);
    setFailure(undefined);
    const result = await api.requestPayout({
      body: { amountMinor, currency },
      // One key per request, so a double-press resolves to one instruction.
      idempotencyKey: `payout-${currency}-${amountMinor}-${String(Date.now())}`,
    });
    setBusy(false);
    if (!isOk(result)) {
      setFailure('That payout could not be requested. Nothing was sent.');
      return;
    }
    readiness.reload();
    history.reload();
  };

  return (
    <Section headingId="payouts-heading" title="Payouts">
      <ResourceState resource={readiness} testId="payouts-readiness" />
      {failure === undefined ? null : (
        <ErrorMessage testId="payouts-failed">{failure}</ErrorMessage>
      )}

      {blocked === undefined ? null : (
        <StatusMessage testId="payouts-blocked">{blocked}</StatusMessage>
      )}

      {state?.recipientStatus === 'absent' &&
      state.providerSource !== 'unavailable' ? (
        <button
          data-testid="payouts-onboard"
          disabled={busy}
          onClick={() => {
            void onboard();
          }}
          type="button"
        >
          Set up payouts
        </button>
      ) : null}

      {state === undefined ? null : balances.length === 0 ? (
        <EmptyState testId="payouts-empty">
          Nothing has been paid to you yet, so there is nothing to withdraw.
        </EmptyState>
      ) : (
        balances.map((balance) => (
          <div
            data-testid={`payouts-balance-${balance.currency}`}
            key={balance.currency}
          >
            <h3>{balance.currency}</h3>
            <dl>
              <div>
                <dt>Available</dt>
                <dd data-testid={`payouts-${balance.currency}-available`}>
                  {formatAmount(balance.available, balance.currency)}
                </dd>
              </div>
              <div>
                <dt>Being paid out</dt>
                <dd data-testid={`payouts-${balance.currency}-reserved`}>
                  {formatAmount(balance.reserved, balance.currency)}
                </dd>
              </div>
              <div>
                <dt>On hold</dt>
                <dd data-testid={`payouts-${balance.currency}-held`}>
                  {formatAmount(balance.held, balance.currency)}
                </dd>
              </div>
            </dl>
            {/*
              Offered only when the server says something is actually
              releasable. A control that cannot succeed is worse than an
              explanation of why there is none.
            */}
            {state.enabled && balance.releasable !== '0' ? (
              <button
                data-testid={`payouts-withdraw-${balance.currency}`}
                disabled={busy}
                onClick={() => {
                  void withdraw(balance.currency, balance.releasable);
                }}
                type="button"
              >
                Withdraw {formatAmount(balance.releasable, balance.currency)}
              </button>
            ) : null}
          </div>
        ))
      )}

      <h3>Payout history</h3>
      <ResourceState resource={history} testId="payouts-history" />
      {history.value === undefined ? null : history.value.payouts.length ===
        0 ? (
        <EmptyState testId="payouts-history-empty">
          No payouts have been requested.
        </EmptyState>
      ) : (
        <ul>
          {history.value.payouts.map((payout) => (
            <li data-testid={`payouts-entry-${payout.id}`} key={payout.id}>
              {formatMoney(payout.amount)} · {payout.state}
              {payout.failureReason === undefined
                ? null
                : ` · ${payout.failureReason}`}{' '}
              · <time dateTime={payout.createdAt}>{payout.createdAt}</time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
