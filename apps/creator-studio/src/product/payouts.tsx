'use client';

import { useCallback, useState } from 'react';

import type {
  CreatorPayoutBalance,
  CreatorPayoutHistory,
  CreatorPayoutReadiness,
} from '@velora/creator-client';
import { formatAmount, formatMoney, isOk } from '@velora/creator-client';

import { ConfirmDialog } from '../design/dialog';
import {
  Badge,
  BlockedState,
  Button,
  Card,
  CardHead,
  CardSkeleton,
  EmptyState,
  ErrorMessage,
  ErrorState,
  InfoRow,
  ListRow,
  Metric,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { useApi, useToast } from '../app/providers';
import { formatDateTime, payoutFailureLabels, payoutStateLook } from './format';
import { MoneyNav } from './money-nav';
import { useResource, useSingleFlight } from './resource';

/**
 * Getting paid, and being told plainly when that is not possible.
 *
 * Two things can stop a payout and they are shown as two things, because a
 * creator whose provider record is fine but whose platform has published no
 * settlement terms should not be sent off to finish onboarding they have
 * already finished. In every deployed environment both are true at once: no
 * payout provider is eligible for VELORA's business model, and no settlement
 * window, reserve, or minimum payout is published.
 *
 * The balances are shown anyway. The money is real whatever the platform can
 * currently do with it, and hiding a figure does not change what is owed.
 *
 * Onboarding is a link into somebody else's flow. This surface has no bank
 * field, no document upload, and no identity form — not disabled, absent —
 * because the provider collects, verifies, and keeps all of it, and VELORA
 * holds a reference to the record and nothing more.
 */

interface Withdrawal {
  readonly amountMinor: string;
  readonly currency: CreatorPayoutBalance['currency'];
  /**
   * Made once, when the creator opens the confirmation, and reused on every
   * attempt for this intent. That is what makes a retry after a dropped
   * connection one payout instead of two — a key regenerated per press would
   * make the header decoration rather than protection.
   */
  readonly idempotencyKey: string;
}

/**
 * A fresh key for one payout intent.
 *
 * `crypto.randomUUID` where the browser offers it, which is everywhere this
 * surface is served from a trustworthy origin. The fallback exists because a
 * missing key would mean sending no idempotency header at all, and a payout
 * request without one is the request this whole mechanism exists to prevent.
 */
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

/** Why a payout is not currently possible, said in the creator's terms. */
function blockedReason(
  readiness: CreatorPayoutReadiness,
): { readonly body: string; readonly title: string } | undefined {
  if (readiness.providerSource === 'unavailable') {
    return {
      body: 'No payout provider is approved for VELORA, so there is nothing for a payout to travel through. This is a platform decision rather than something waiting on you.',
      title: 'Payouts are not available yet',
    };
  }
  if (readiness.policySource === 'unpublished') {
    return {
      body: 'The settlement terms that decide when earnings can be withdrawn are not published, so VELORA cannot say what is releasable.',
      title: 'Payouts are not available yet',
    };
  }
  if (readiness.recipientStatus === 'absent') {
    return {
      body: 'Setting up opens your payout provider’s own onboarding. VELORA never sees your bank details — it holds a reference to the record and nothing more.',
      title: 'You have not set up payouts yet',
    };
  }
  if (readiness.recipientStatus === 'onboarding') {
    return {
      body: 'Your payout provider has not finished checking your details. Nothing further is needed from VELORA.',
      title: 'Your provider is still checking',
    };
  }
  if (readiness.recipientStatus === 'restricted') {
    return {
      body: 'Your payout provider cannot pay you at the moment. They will have told you what they need.',
      title: 'Your provider cannot pay you',
    };
  }
  return undefined;
}

export function Payouts() {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [withdrawing, setWithdrawing] = useState<Withdrawal | undefined>(
    undefined,
  );

  const loadReadiness = useCallback(async () => api.payoutReadiness(), [api]);
  const loadHistory = useCallback(async () => api.payouts(), [api]);
  const readiness = useResource<CreatorPayoutReadiness>(loadReadiness);
  const history = useResource<CreatorPayoutHistory>(loadHistory);

  const state = readiness.value;
  const blocked = state === undefined ? undefined : blockedReason(state);
  const balances = state?.balances ?? [];
  const canOnboard =
    state?.recipientStatus === 'absent' &&
    state.providerSource !== 'unavailable';

  return (
    <>
      <PageHeader
        lede="What VELORA can send you, and what stands in the way when it cannot."
        title="Money"
      />
      <MoneyNav />

      {failure === undefined ? null : (
        <ErrorMessage testId="payouts-failed">{failure}</ErrorMessage>
      )}

      {readiness.error !== undefined ? (
        <Card>
          <ErrorState
            body={readiness.error}
            onRetry={readiness.retryable ? readiness.reload : undefined}
            testId="payouts-readiness-failed"
          />
        </Card>
      ) : readiness.loading && state === undefined ? (
        <Card testId="payouts-loading">
          <CardSkeleton rows={3} />
        </Card>
      ) : blocked === undefined ? null : (
        <BlockedState
          label="Not available"
          testId="payouts-blocked"
          title={blocked.title}
        >
          <p>{blocked.body}</p>
          {canOnboard ? null : (
            <p>
              Anything owed to you stays owed. It is shown below whatever the
              platform can currently do with it.
            </p>
          )}
        </BlockedState>
      )}

      {canOnboard ? (
        <Button
          busy={busy}
          data-testid="payouts-onboard"
          onClick={() => {
            run(async () => {
              setFailure(undefined);
              const result = await api.startPayoutOnboarding();
              if (!isOk(result)) {
                setFailure('Payout onboarding could not be started.');
                return;
              }
              // The provider's own page. VELORA does not render it and does
              // not proxy it.
              window.location.assign(result.value.onboardingUrl);
            });
          }}
          tone="primary"
        >
          Set up payouts
        </Button>
      ) : null}

      {state === undefined ? null : balances.length === 0 ? (
        <Card>
          <EmptyState
            body="Nothing has been paid to you yet, so there is nothing to withdraw."
            icon="wallet"
            testId="payouts-empty"
            title="No balance"
          />
        </Card>
      ) : (
        <div className="s-grid s-grid--wide">
          {balances.map((balance) => (
            <Card
              key={balance.currency}
              testId={`payouts-balance-${balance.currency}`}
            >
              <CardHead
                actions={<Badge tone="neutral">{balance.currency}</Badge>}
                title="Your balance"
              />
              <Metric
                caption={`${balance.currency} available to withdraw`}
                testId={`payouts-${balance.currency}-available`}
                value={formatAmount(balance.available, balance.currency)}
              />
              <dl className="s-stack">
                <InfoRow
                  term="Being paid out"
                  testId={`payouts-${balance.currency}-reserved`}
                  value={
                    <span className="s-numeric">
                      {formatAmount(balance.reserved, balance.currency)}
                    </span>
                  }
                />
                <InfoRow
                  term="On hold"
                  testId={`payouts-${balance.currency}-held`}
                  value={
                    <span className="s-numeric">
                      {formatAmount(balance.held, balance.currency)}
                    </span>
                  }
                />
              </dl>
              {/*
                Offered only when the server says something is actually
                releasable. A control that cannot succeed is worse than an
                explanation of why there is none.
              */}
              {state.enabled && balance.releasable !== '0' ? (
                <Button
                  data-testid={`payouts-withdraw-${balance.currency}`}
                  disabled={busy}
                  onClick={() => {
                    setWithdrawing({
                      amountMinor: balance.releasable,
                      currency: balance.currency,
                      idempotencyKey: newIdempotencyKey(),
                    });
                  }}
                  tone="primary"
                >
                  Withdraw {formatAmount(balance.releasable, balance.currency)}
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Card flush testId="payouts-history">
        <CardHead title="Payout history" />
        {history.error !== undefined ? (
          <ErrorState
            body={history.error}
            onRetry={history.retryable ? history.reload : undefined}
            testId="payouts-history-failed"
          />
        ) : history.loading && history.value === undefined ? (
          <RowSkeleton rows={2} />
        ) : (history.value?.payouts ?? []).length === 0 ? (
          <EmptyState
            body="Every payout you request appears here with what happened to it."
            icon="wallet"
            testId="payouts-history-empty"
            title="No payouts requested"
          />
        ) : (
          <ul className="s-list">
            {(history.value?.payouts ?? []).map((payout) => {
              const look = payoutStateLook(payout.state);
              return (
                <li key={payout.id}>
                  <ListRow
                    aside={
                      <span className="s-numeric s-subheading">
                        {formatMoney(payout.amount)}
                      </span>
                    }
                    testId={`payouts-entry-${payout.id}`}
                  >
                    <span className="s-inline s-inline--tight">
                      <Badge icon={look.icon} tone={look.tone}>
                        {look.label}
                      </Badge>
                      <span className="s-caption s-quiet">
                        {formatDateTime(payout.createdAt)}
                      </span>
                    </span>
                    {payout.failureReason === undefined ? null : (
                      <span className="s-caption s-quiet">
                        {payoutFailureLabels[payout.failureReason] ??
                          'Your payout provider could not complete it.'}
                      </span>
                    )}
                  </ListRow>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {withdrawing === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Request this payout"
          confirmTone="primary"
          onCancel={() => {
            setWithdrawing(undefined);
          }}
          onConfirm={() => {
            const intent = withdrawing;
            run(async () => {
              setFailure(undefined);
              const result = await api.requestPayout({
                body: {
                  amountMinor: intent.amountMinor,
                  currency: intent.currency,
                },
                idempotencyKey: intent.idempotencyKey,
              });
              if (!isOk(result)) {
                // The intent is kept, so pressing again reuses the same key
                // and cannot produce a second payout.
                setFailure(
                  'That payout could not be requested. Nothing was sent.',
                );
                return;
              }
              setWithdrawing(undefined);
              toast.show('Payout requested.', 'positive');
              readiness.reload();
              history.reload();
            });
          }}
          testId="payouts-withdraw-confirm"
          title="Request a payout?"
        >
          <p>
            VELORA will ask your payout provider to send{' '}
            {formatAmount(withdrawing.amountMinor, withdrawing.currency)}. How
            long it takes is your provider’s decision, not VELORA’s.
          </p>
          <p>
            Requesting twice does not send twice: this request carries a key
            that VELORA recognises.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
