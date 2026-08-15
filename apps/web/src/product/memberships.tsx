'use client';

import { useCallback } from 'react';

import type {
  ConsumerApi,
  ConsumerSubscriptionList,
} from '@velora/consumer-client';
import { formatMinorUnits } from '@velora/validation';

import { useResource } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

/**
 * What this person is paying for, and nothing suggesting they could pay for
 * more.
 *
 * There is deliberately no purchase control anywhere on this surface. No
 * payment provider is approved for Velora's business model and no commercial
 * terms are published, so a Subscribe button would describe a product that does
 * not exist — and a control that cannot succeed is worse than an explanation of
 * why there is none, because somebody presses it, waits, and concludes the
 * platform is broken rather than unfinished.
 *
 * When commerce is enabled the control appears here, and it appears because the
 * server said so rather than because a build flag did.
 *
 * `past_due` is shown and grants nothing. Whether a lapsed payment keeps access,
 * and for how long, is grace policy nobody has approved, and the fail-closed
 * reading of an unresolved policy is no access — said plainly rather than
 * implied by a period that quietly kept working.
 */

const stateLabels: Readonly<Record<string, string>> = {
  active: 'Active',
  cancel_at_period_end: 'Ends at the end of the paid period',
  cancelled: 'Cancelled',
  past_due: 'Payment lapsed — access is not active',
  pending: 'Starting',
  terminated: 'Ended',
};

export function Memberships({
  api,
  onSessionEnded,
}: {
  readonly api: ConsumerApi;
  readonly onSessionEnded: () => void;
}) {
  const load = useCallback(async () => api.subscriptions(), [api]);
  const subscriptions = useResource<ConsumerSubscriptionList>(load, {
    onUnauthenticated: onSessionEnded,
  });
  const rows = subscriptions.value?.subscriptions ?? [];

  return (
    <Section headingId="memberships-heading" title="Memberships">
      <ResourceState resource={subscriptions} testId="memberships" />

      {/*
        Said once, plainly, instead of a control that refuses. Nothing on this
        surface offers to take money, because nothing can.
      */}
      <StatusMessage testId="memberships-commerce">
        Paid memberships are not available yet. Nothing on Velora can be
        purchased.
      </StatusMessage>

      {subscriptions.value === undefined ? null : rows.length === 0 ? (
        <EmptyState testId="memberships-empty">
          You are not paying for anything.
        </EmptyState>
      ) : (
        <ul>
          {rows.map((row) => (
            <li data-testid={`membership-${row.id}`} key={row.id}>
              {formatMinorUnits(row.amount.amountMinor, row.amount.currency)}{' '}
              {row.amount.currency} · {stateLabels[row.state] ?? row.state}
              {row.currentPeriodEnd === undefined ? null : (
                <>
                  {' '}
                  · paid through{' '}
                  <time dateTime={row.currentPeriodEnd}>
                    {row.currentPeriodEnd}
                  </time>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
