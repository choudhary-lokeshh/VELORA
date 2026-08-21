'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConsumerApi, NotificationEntry } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus } from './resource';
import {
  EmptyState,
  ErrorMessage,
  MoreButton,
  ResourceState,
  Section,
  StatusMessage,
} from './ui';

/**
 * What the platform has told this person.
 *
 * This is the in-app surface and nothing else. External delivery — push, email,
 * SMS — is a separate obligation with its own record, and no part of it is
 * visible here: there is no attempt count, no provider state, and no reason a
 * notice was suppressed. `safety_block` in particular would disclose another
 * person's decision, so the API does not publish it and this screen has no
 * field to put it in.
 *
 * No provider is approved for any external channel, so in every deployed
 * environment this list is the only place a notice is actually seen. That is
 * stated plainly rather than papered over with a "push notifications" setting
 * that would do nothing.
 */
const notificationPageSize = 20;

const notificationLabels: Readonly<Record<string, string>> = {
  // Deliberately past-tense and non-actionable. A ring is a live event and this
  // list is a record of what happened; a notice that said "answer now" would be
  // offering a call that has almost certainly already stopped ringing by the
  // time anybody reads it here.
  call_incoming: 'Somebody called you.',
  call_missed: 'You missed a call.',
  introduction_mutual: 'You have a new mutual introduction.',
  message_received: 'You have a new message.',
};

export function NotificationsPanel({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) =>
      api.notifications({ pageSize: notificationPageSize }, signal),
    [api],
  );
  const first = useResource(load);
  const [older, setOlder] = useState<readonly NotificationEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const acknowledged = useRef(new Set<string>());

  useRevalidateOnFocus(first.reload);

  useEffect(() => {
    // A fresh first page supersedes whatever continuation was being held; the
    // cursor it carries is the only one still valid.
    setOlder([]);
    setCursor(first.value?.nextCursor);
  }, [first.value]);

  const entries = dedupe([...(first.value?.notifications ?? []), ...older]);
  const unread = entries.filter((entry) => entry.readAt === undefined);

  const acknowledge = (ids: readonly string[]) => {
    const fresh = ids.filter((id) => !acknowledged.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) acknowledged.current.add(id);
    setMessage(undefined);
    void api.markNotificationsRead(fresh).then((result) => {
      setMessage(failureMessage(result));
      first.reload();
    });
  };

  return (
    <Section headingId="notifications-heading" title="Notifications">
      <ResourceState resource={first} testId="notifications" />
      {message === undefined ? null : (
        <ErrorMessage testId="notifications-error">{message}</ErrorMessage>
      )}
      <StatusMessage testId="notifications-unread">
        {unread.length === 0
          ? 'Nothing unread.'
          : `${String(unread.length)} unread`}
      </StatusMessage>
      {!first.loading && first.error === undefined && entries.length === 0 ? (
        <EmptyState testId="notifications-empty">
          Nothing yet. New messages and mutual introductions appear here.
        </EmptyState>
      ) : null}

      {unread.length === 0 ? null : (
        <button
          data-testid="notifications-mark-read"
          onClick={() => {
            acknowledge(unread.map((entry) => entry.id));
          }}
          type="button"
        >
          Mark all as read
        </button>
      )}

      <ul data-testid="notification-list">
        {entries.map((entry) => (
          <li
            data-read={entry.readAt === undefined ? 'false' : 'true'}
            data-testid={`notification-${entry.id}`}
            key={entry.id}
          >
            <p>{notificationLabels[entry.kind] ?? 'Something happened.'}</p>
            <p className="hint">
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </p>
            {entry.readAt === undefined ? (
              <button
                data-testid={`notification-read-${entry.id}`}
                onClick={() => {
                  acknowledge([entry.id]);
                }}
                type="button"
              >
                Mark as read
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {cursor === undefined ? null : (
        <MoreButton
          busy={loadingMore}
          label="Load older"
          onClick={() => {
            const from = cursor;
            setLoadingMore(true);
            void api
              .notifications({ cursor: from, pageSize: notificationPageSize })
              .then((result) => {
                if (result.kind !== 'ok') {
                  setMessage(failureMessage(result));
                  return;
                }
                setOlder((current) => [
                  ...current,
                  ...result.value.notifications,
                ]);
                setCursor(result.value.nextCursor);
              })
              .finally(() => {
                setLoadingMore(false);
              });
          }}
          testId="notifications-more"
        />
      )}
    </Section>
  );
}

function dedupe(
  entries: readonly NotificationEntry[],
): readonly NotificationEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return [...byId.values()];
}
