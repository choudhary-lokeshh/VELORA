'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { CheckoutResponse } from '@velora/consumer-client';

import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Notice,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  formatPrice,
  paymentFailureLabels,
  paymentStateLook,
  paymentStateMeaning,
} from './commerce';
import { useResource } from './resource';

/**
 * Where a payment provider sends somebody back to.
 *
 * A read of server state and nothing else. There is no transition on this path
 * and there cannot be one: a browser navigation is not evidence that money
 * moved, and a page that treated arriving here as success would be a page
 * anybody could reach by typing an address. What settles a payment is the
 * provider's signed event, verified and applied elsewhere.
 *
 * That is why this screen polls rather than concludes. A provider's event and a
 * browser redirect are two independent things racing, and the redirect usually
 * wins — so for a few seconds the honest answer is "waiting", and saying so is
 * better than showing a failure that is about to become a success.
 */

/** How long to keep asking before saying it is taking longer than expected. */
const settlementWindowMilliseconds = 15_000;
const pollIntervalMilliseconds = 1_000;

export function CheckoutReturn() {
  const api = useApi();
  const paymentId = useSearchParams().get('payment');
  const load = useCallback(
    async (signal: AbortSignal) =>
      paymentId === null
        ? ({ kind: 'unavailable' } as const)
        : api.readCheckout(paymentId, signal),
    [api, paymentId],
  );
  const payment = useResource<CheckoutResponse>(load, {
    enabled: paymentId !== null,
  });
  const [waitedOut, setWaitedOut] = useState(false);

  const state = payment.value?.payment.state;
  const settling =
    state === 'provider_pending' ||
    state === 'created' ||
    state === 'requires_action';
  const { reload } = payment;

  useEffect(() => {
    if (!settling || waitedOut) return undefined;
    const started = Date.now();
    const timer = globalThis.setInterval(() => {
      if (Date.now() - started > settlementWindowMilliseconds) {
        setWaitedOut(true);
        return;
      }
      reload();
    }, pollIntervalMilliseconds);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [reload, settling, waitedOut]);

  if (paymentId === null) {
    return (
      <>
        <PageHeader title="Payment" />
        <Card>
          <ErrorMessage testId="checkout-missing">
            This address does not name a payment.
          </ErrorMessage>
        </Card>
      </>
    );
  }

  if (payment.value === undefined) {
    return (
      <>
        <PageHeader title="Payment" />
        <Card>
          {payment.error === undefined ? (
            <RowSkeleton rows={2} />
          ) : (
            <div className="v-stack v-stack--3">
              <ErrorMessage testId="checkout-failed">
                {payment.error}
              </ErrorMessage>
              {payment.retryable ? (
                <div>
                  <Button onClick={payment.reload}>Try again</Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </>
    );
  }

  const row = payment.value.payment;
  const look = paymentStateLook(row.state);
  const settled = row.state === 'succeeded';
  // What was bought, from the server's own answer rather than from where the
  // browser happened to come from. Coins and a club membership settle through
  // one checkout and land somewhere different, and a page that sent everybody
  // to Memberships would send half of them to a screen with nothing on it.
  const coins = row.resource?.type === 'coins';

  return (
    <>
      <PageHeader
        lede={settled ? 'Your payment went through.' : undefined}
        title={settled ? (coins ? 'Coins added' : 'You are in') : 'Payment'}
      />
      <Card testId="checkout-state">
        <div className="v-stack v-stack--4">
          <div className="v-inline v-inline--between">
            <span className="v-subheading v-numeric">
              {formatPrice(row.amount)}
            </span>
            <Badge tone={look.tone}>{look.label}</Badge>
          </div>
          <p className="v-small v-muted">{paymentStateMeaning[row.state]}</p>
          {row.failureReason === undefined ? null : (
            <p className="v-small v-muted" data-testid="checkout-failure">
              {paymentFailureLabels[row.failureReason] ??
                'The payment did not complete.'}
            </p>
          )}

          {settling && !waitedOut ? (
            <p
              aria-live="polite"
              className="v-caption v-quiet"
              data-testid="checkout-waiting"
              role="status"
            >
              Waiting for the payment provider to confirm. This page updates on
              its own.
            </p>
          ) : null}

          {settling && waitedOut ? (
            <Notice icon="info" testId="checkout-slow" tone="quiet">
              This is taking longer than usual. Nothing is lost and nothing is
              charged twice — VELORA resolves an unconfirmed payment against the
              provider&apos;s own record.{' '}
              {coins ? 'Your coin balance' : 'Your Memberships page'} will show
              it when it settles.
            </Notice>
          ) : null}

          <div className="v-inline v-inline--tight">
            <Link
              className="v-btn v-btn--primary"
              href={coins ? '/you/wallet' : '/you/memberships'}
            >
              {coins ? 'Go to Coins' : 'Go to Memberships'}
            </Link>
            {settling ? (
              <Button onClick={payment.reload}>Check again</Button>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}

/**
 * Where a provider sends somebody who stopped.
 *
 * It asserts nothing about what happened. A consumer who abandoned a payment
 * and one whose provider page timed out arrive here identically, and the state
 * on the record is what says which — so this reads the same server truth the
 * return page does rather than announcing a cancellation of its own.
 */
export function CheckoutCancelled() {
  const api = useApi();
  const paymentId = useSearchParams().get('payment');
  const load = useCallback(
    async (signal: AbortSignal) =>
      paymentId === null
        ? ({ kind: 'unavailable' } as const)
        : api.readCheckout(paymentId, signal),
    [api, paymentId],
  );
  const payment = useResource<CheckoutResponse>(load, {
    enabled: paymentId !== null,
  });
  const row = payment.value?.payment;
  // The same server truth the return page reads, for the same reason: coins
  // and a membership settle through one checkout, and a coin buyer who stopped
  // was being told nothing about "the membership" had changed and offered two
  // doors that both led away from their wallet.
  const coins = row?.resource?.type === 'coins';

  return (
    <>
      <PageHeader
        lede="Nothing was charged."
        title="You did not finish paying"
      />
      <Card testId="checkout-cancelled">
        <div className="v-stack v-stack--4">
          <p className="v-small v-muted">
            {coins
              ? 'You can start again whenever you like. No coins were added and nothing has been taken.'
              : 'You can start again whenever you like. Nothing about the membership has changed and nothing has been taken.'}
          </p>
          {row === undefined ? null : (
            <p
              className="v-caption v-quiet"
              data-testid="checkout-cancelled-state"
            >
              {paymentStateMeaning[row.state]}
            </p>
          )}
          <div className="v-inline v-inline--tight">
            <Link
              className="v-btn v-btn--secondary"
              href={coins ? '/you/wallet' : '/you/memberships'}
            >
              {coins ? 'Back to Coins' : 'Memberships'}
            </Link>
            <Link className="v-btn v-btn--secondary" href="/discover">
              Keep looking
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
