'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import type { ActivityEntry, ActivityPage } from '../api/contract';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  PanelSkeleton,
  Select,
  Timeline,
  type TimelineEntry,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { formatDateTime, humanState, shortId } from './format';
import { useCollection, type Page } from './resource';

/**
 * What has been happening, read from the domains that own each record.
 *
 * There is no activity table behind this screen. Every row was written by the
 * domain the fact belongs to — a sign-in by AUTH, an encounter by LIVE, a
 * capture by WALLET — and composed at read time, which is why what an operator
 * sees here and what they see on the record itself can never disagree.
 *
 * What is deliberately absent from every row: a message, a report narrative, a
 * ticket's text, a push token, an amount, a name, a photograph. The contract
 * this renders has no field that could hold one, so a screen that showed one
 * could not be written against it. `detail` is a single enumerated word — a
 * state, a reason code, a failure class — and the platform bounds it.
 *
 * Freshness is stated rather than implied. The window is shown in words, and
 * nothing on this screen calls itself realtime, because it is not: it is a read
 * an operator refreshes.
 */

/** The domains an operator can narrow to, in the order they usually look. */
const domainOptions = [
  { label: 'Every domain', value: '' },
  { label: 'Authentication', value: 'auth' },
  { label: 'Accounts', value: 'users' },
  { label: 'Live', value: 'live' },
  { label: 'Connections', value: 'discovery' },
  { label: 'Messaging', value: 'messaging' },
  { label: 'Safety', value: 'safety' },
  { label: 'Support', value: 'support' },
  { label: 'Coins', value: 'wallet' },
  { label: 'Payments', value: 'billing' },
  { label: 'Notifications', value: 'notifications' },
  { label: 'Growth', value: 'growth' },
] as const;

const windowOptions = [
  { label: 'Last hour', value: '1' },
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
  { label: 'Last 30 days', value: '720' },
] as const;

/**
 * What one activity type is called on a screen.
 *
 * A lookup rather than a humanised string, because these are the platform's own
 * governed taxonomy and an operator should read what happened rather than a
 * dotted identifier. A type with no entry falls back to the humanised form, so
 * a taxonomy addition is legible on the day it ships rather than blank.
 */
const typeLabels: Readonly<Record<string, string>> = {
  'auth.security_event': 'Authentication event',
  'billing.payment_settled': 'Payment moved',
  'discovery.introduction_created': 'Connect requested',
  'discovery.introduction_settled': 'Connect settled',
  'growth.acquisition_event': 'Acquisition event',
  'live.encounter_ended': 'Encounter ended',
  'live.encounter_started': 'Encounter started',
  'live.search_ended': 'Live search ended',
  'live.search_entered': 'Live search entered',
  'messaging.conversation_created': 'Conversation created',
  'notifications.delivery_attempted': 'Notification attempted',
  'safety.appeal_submitted': 'Appeal submitted',
  'safety.block_created': 'Block created',
  'safety.enforcement_applied': 'Enforcement applied',
  'safety.report_submitted': 'Report submitted',
  'support.ticket_event': 'Ticket changed',
  'support.ticket_opened': 'Ticket opened',
  'users.account_created': 'Account created',
  'users.account_status_changed': 'Account status changed',
  'wallet.acquisition_settled': 'Coin purchase settled',
  'wallet.transaction_posted': 'Coins moved',
};

export function labelForActivity(entry: ActivityEntry): string {
  return typeLabels[entry.type] ?? humanState(entry.type);
}

/**
 * Where a row leads, when the console has a screen for that kind of record.
 *
 * A row that leads nowhere is left as text rather than dressed as a link. Not
 * every resource this stream names has an operator screen, and a link that
 * lands on a page saying nothing is worse than no link.
 */
function destinationFor(entry: ActivityEntry): string | undefined {
  if (entry.resourceType === 'encounter' && entry.resourceId !== undefined) {
    return `/platform/live/${entry.resourceId}`;
  }
  if (entry.resourceType === 'case' && entry.resourceId !== undefined) {
    return `/queues/${entry.resourceId}`;
  }
  if (entry.resourceType === 'ticket' && entry.resourceId !== undefined) {
    return '/queues/support';
  }
  if (entry.resourceType === 'payment' && entry.resourceId !== undefined) {
    return `/money/payments/${entry.resourceId}`;
  }
  if (entry.subjectId !== undefined) return `/accounts/${entry.subjectId}`;
  return undefined;
}

export function activityTimelineEntries(
  entries: readonly ActivityEntry[],
): readonly TimelineEntry[] {
  return entries.map((entry) => {
    const destination = destinationFor(entry);
    const label = labelForActivity(entry);
    return {
      ...(entry.detail === undefined
        ? {}
        : { detail: humanState(entry.detail) }),
      id: entry.id,
      meta: (
        <>
          {humanState(entry.domain)}
          {entry.subjectId === undefined ? null : (
            <> · {shortId(entry.subjectId)}</>
          )}
        </>
      ),
      title:
        destination === undefined ? (
          label
        ) : (
          <Link href={destination}>{label}</Link>
        ),
      when: formatDateTime(entry.occurredAt),
    };
  });
}

/**
 * One page of activity, filtered.
 *
 * The filters are part of the request rather than applied to what came back: a
 * narrowed query asks fewer domains for fewer rows, which is what keeps this
 * cheap as the platform grows. Filtering a page in the browser would have made
 * "last 30 days, safety only" return whatever happened to be in the first
 * fifty rows of everything.
 */
export function ActivityStream({
  subject,
  testId = 'activity',
}: {
  /** One account's history, or every account's when absent. */
  readonly subject?: string | undefined;
  readonly testId?: string;
}) {
  const api = useApi();
  const [domain, setDomain] = useState('');
  const [hours, setHours] = useState('24');

  const paged = useCallback(
    async (cursor: string | undefined) => {
      const result =
        subject === undefined
          ? await api.activity({
              cursor,
              ...(domain === ''
                ? {}
                : { domain: domain as ActivityEntry['domain'] }),
              hours,
            })
          : await api.accountTimeline({ accountId: subject, cursor, hours });
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: toPage(result.value) }
        : result;
    },
    [api, domain, hours, subject],
  );

  const collection = useCollection<ActivityEntry, ActivityPage>(paged);
  const entries = useMemo(
    () => activityTimelineEntries(collection.items),
    [collection.items],
  );
  const window = collection.meta;

  return (
    <Panel testId={testId}>
      <PanelHead
        actions={
          <span className="a-caption a-quiet">
            {window === undefined ? null : `to ${formatDateTime(window.until)}`}
          </span>
        }
        title="Activity"
      />
      <PanelBody>
        <div className="a-toolbar">
          {subject === undefined ? (
            <Field label="Domain">
              {(control) => (
                <Select
                  {...control}
                  data-testid={`${testId}-domain`}
                  onChange={(event) => {
                    setDomain(event.target.value);
                  }}
                  value={domain}
                >
                  {domainOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Window">
            {(control) => (
              <Select
                {...control}
                data-testid={`${testId}-window`}
                onChange={(event) => {
                  setHours(event.target.value);
                }}
                value={hours}
              >
                {windowOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {collection.error !== undefined && collection.items.length === 0 ? (
          <ErrorState
            body={collection.error}
            onRetry={collection.retryable ? collection.reload : undefined}
            testId={`${testId}-failed`}
          />
        ) : collection.loading ? (
          <PanelSkeleton />
        ) : collection.items.length === 0 ? (
          <EmptyState
            body="Nothing the platform records happened in this window. That is an answer, not a gap."
            testId={`${testId}-empty`}
            title="Nothing in this window"
          />
        ) : (
          <Timeline entries={entries} testId={`${testId}-timeline`} />
        )}
      </PanelBody>
      {collection.hasMore ? (
        <PanelFoot>
          <Button
            busy={collection.loadingMore}
            data-testid={`${testId}-more`}
            onClick={collection.loadMore}
          >
            Load more
          </Button>
        </PanelFoot>
      ) : null}
    </Panel>
  );
}

function toPage(value: ActivityPage): Page<ActivityEntry, ActivityPage> {
  return {
    items: value.entries,
    meta: value,
    nextCursor: value.nextCursor,
  };
}

/** The Activity destination: the platform-wide stream, on its own screen. */
export function ActivityScreen() {
  return (
    <>
      <PageHeader
        lede="What the platform recorded, newest first, composed from the domain that owns each fact. No message, narrative, token, or amount appears here."
        title="Activity"
      />
      <ActivityStream />
    </>
  );
}
