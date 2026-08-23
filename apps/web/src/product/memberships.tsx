'use client';

import { useCallback } from 'react';

import type { ConsumerSubscriptionList } from '@velora/consumer-client';
import { formatMinorUnits } from '@velora/validation';

import { useApi } from '../app/providers';
import {
  Badge,
  BlockedState,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  PageHeader,
  RowSkeleton,
  type Tone,
} from '../design/primitives';
import { useResource } from './resource';

/**
 * What this person is paying for, and nothing suggesting they could pay for
 * more.
 *
 * There is deliberately no purchase control anywhere on this surface. No payment
 * provider is approved for Velora's business model and no commercial terms are
 * published, so a Subscribe button would describe a product that does not exist
 * — and a control that cannot succeed is worse than an explanation of why there
 * is none, because somebody presses it, waits, and concludes the platform is
 * broken rather than unfinished.
 *
 * When commerce is enabled the control appears here, and it appears because the
 * server said so rather than because a build flag did.
 *
 * `past_due` is shown and grants nothing. Whether a lapsed payment keeps access,
 * and for how long, is grace policy nobody has approved, and the fail-closed
 * reading of an unresolved policy is no access — said plainly rather than
 * implied by a period that quietly kept working.
 */

const stateLabels: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  active: { label: 'Active', tone: 'positive' },
  cancel_at_period_end: {
    label: 'Ends at the end of the paid period',
    tone: 'caution',
  },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  past_due: {
    label: 'Payment lapsed — access is not active',
    tone: 'critical',
  },
  pending: { label: 'Starting', tone: 'info' },
  terminated: { label: 'Ended', tone: 'neutral' },
};

export function Memberships() {
  const api = useApi();
  const load = useCallback(async () => api.subscriptions(), [api]);
  const subscriptions = useResource<ConsumerSubscriptionList>(load);
  const rows = subscriptions.value?.subscriptions ?? [];

  return (
    <>
      <PageHeader
        lede="Private clubs a creator has let you into, and anything you are paying for."
        title="Memberships"
      />

      <div className="v-stack v-stack--6">
        <BlockedState
          testId="memberships-commerce"
          title="Nothing on VELORA can be bought yet"
        >
          <p>
            No payment provider is approved for what VELORA does, so there is no
            checkout anywhere on this site and no price to show you. Access to a
            private club comes from an invitation its creator sends, which is
            not something a page can offer you.
          </p>
        </BlockedState>

        {subscriptions.loading && subscriptions.value === undefined ? (
          <Card>
            <RowSkeleton rows={2} />
          </Card>
        ) : null}

        {subscriptions.error === undefined ? null : (
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="memberships-failed">
              {subscriptions.error}
            </ErrorMessage>
            {subscriptions.retryable ? (
              <div>
                <Button onClick={subscriptions.reload}>Try again</Button>
              </div>
            ) : null}
          </div>
        )}

        {subscriptions.value === undefined ? null : rows.length === 0 ? (
          <Card>
            <EmptyState
              body="Nothing is being charged to you, because nothing on VELORA can be charged for yet."
              icon="membership"
              testId="memberships-empty"
              title="You are not paying for anything"
            />
          </Card>
        ) : (
          <Card flush>
            <ul className="v-list v-list--divided">
              {rows.map((row) => {
                const state = stateLabels[row.state] ?? {
                  label: row.state.replaceAll('_', ' '),
                  tone: 'neutral' as Tone,
                };
                return (
                  <li data-testid={`membership-${row.id}`} key={row.id}>
                    <div className="v-row">
                      <span className="v-row__body">
                        <span className="v-subheading">
                          {formatMinorUnits(
                            row.amount.amountMinor,
                            row.amount.currency,
                          )}{' '}
                          {row.amount.currency}
                        </span>
                        {row.currentPeriodEnd === undefined ? null : (
                          <span className="v-caption v-quiet">
                            Paid through{' '}
                            <time dateTime={row.currentPeriodEnd}>
                              {new Date(
                                row.currentPeriodEnd,
                              ).toLocaleDateString()}
                            </time>
                          </span>
                        )}
                      </span>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
