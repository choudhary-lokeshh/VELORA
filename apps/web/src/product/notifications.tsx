'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { NotificationEntry } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import { useApi, useFeeds, useToast } from '../app/providers';
import { Icon, type IconName } from '../design/icons';
import {
  Button,
  EmptyState,
  ErrorMessage,
  Notice,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { formatRelative } from './locale';

/**
 * What the platform has told this person.
 *
 * This is the in-app surface and nothing else. External delivery — push, email,
 * SMS — is a separate obligation with its own record, and no part of it is
 * visible here: there is no attempt count, no provider state, and no reason a
 * notice was suppressed. `safety_block` in particular would disclose another
 * person's decision, so the API does not publish it and this screen has no field
 * to put it in.
 *
 * No provider is approved for any external channel, so in every deployed
 * environment this list is the only place a notice is actually seen. That is
 * said plainly at the top rather than papered over.
 *
 * A notice carries no name and no preview. The contract deliberately withholds
 * both — a client already has an authorized route to fetch them — so a line here
 * says what kind of thing happened and offers to open it.
 */

const notificationPageSize = 20;

interface Presentation {
  readonly icon: IconName;
  readonly text: string;
}

const presentation: Readonly<Record<string, Presentation>> = {
  // Deliberately past tense and non-actionable. A ring is a live event and this
  // list is a record of what happened; a notice offering to answer would be
  // offering a call that stopped ringing long before anybody read it.
  call_incoming: { icon: 'phone', text: 'Somebody called you.' },
  call_missed: { icon: 'phoneOff', text: 'You missed a call.' },
  introduction_mutual: {
    icon: 'link',
    text: 'You have a new mutual introduction.',
  },
  message_received: { icon: 'message', text: 'You have a new message.' },
};

function destinationOf(entry: NotificationEntry): string | undefined {
  if (entry.conversationId !== undefined) {
    return `/messages/${entry.conversationId}`;
  }
  if (entry.introductionId !== undefined) return '/introductions';
  return undefined;
}

export function Notifications() {
  const api = useApi();
  const feeds = useFeeds();
  const toast = useToast();
  const first = feeds.notifications;
  const [older, setOlder] = useState<readonly NotificationEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const acknowledged = useRef(new Set<string>());

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
    setBusy(true);
    void api
      .markNotificationsRead(fresh)
      .then((result) => {
        const failure = failureMessage(result);
        if (failure !== undefined) {
          // Not acknowledged after all, so a retry is still possible.
          for (const id of fresh) acknowledged.current.delete(id);
          toast.show(failure, 'critical');
        }
        first.reload();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <PageHeader
        actions={
          unread.length === 0 ? undefined : (
            <Button
              busy={busy}
              data-testid="notifications-mark-read"
              onClick={() => {
                acknowledge(unread.map((entry) => entry.id));
              }}
              size="sm"
            >
              Mark all as read
            </Button>
          )
        }
        lede={
          unread.length === 0
            ? 'Everything here has been read.'
            : `${String(unread.length)} unread.`
        }
        title="Notices"
      />

      <div className="v-lede-gap">
        <Notice
          icon="info"
          testId="notifications-delivery"
          title="This page is the only place notices arrive"
          tone="quiet"
        >
          VELORA has no approved email or push provider, so nothing is sent to
          your inbox or your phone. Everything the platform tells you is here,
          and nothing is lost while you are away.
        </Notice>
      </div>

      {first.loading && first.value === undefined ? (
        <RowSkeleton rows={4} />
      ) : null}

      {first.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="notifications-failed">
            {first.error}
          </ErrorMessage>
          {first.retryable ? (
            <div>
              <Button onClick={first.reload}>Try again</Button>
            </div>
          ) : null}
        </div>
      )}

      {!first.loading && first.error === undefined && entries.length === 0 ? (
        <EmptyState
          body="New messages, mutual introductions, and calls you missed appear here."
          icon="bell"
          testId="notifications-empty"
          title="Nothing yet"
        />
      ) : null}

      {entries.length === 0 ? null : (
        <ul className="v-list" data-testid="notification-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <NotificationRow
                entry={entry}
                onRead={() => {
                  acknowledge([entry.id]);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {cursor === undefined ? null : (
        <div className="v-continue">
          <Button
            busy={loadingMore}
            data-testid="notifications-more"
            onClick={() => {
              const from = cursor;
              setLoadingMore(true);
              void api
                .notifications({ cursor: from, pageSize: notificationPageSize })
                .then((result) => {
                  if (result.kind !== 'ok') {
                    toast.show(
                      failureMessage(result) ?? 'That did not work.',
                      'critical',
                    );
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
          >
            Load older
          </Button>
        </div>
      )}
    </>
  );
}

function NotificationRow({
  entry,
  onRead,
}: {
  readonly entry: NotificationEntry;
  readonly onRead: () => void;
}) {
  const shown = presentation[entry.kind] ?? {
    icon: 'info' as const,
    text: 'Something happened.',
  };
  const destination = destinationOf(entry);
  const unread = entry.readAt === undefined;

  const body = (
    <>
      <span className="v-notification__mark">
        <Icon name={shown.icon} size="md" />
      </span>
      <span className="v-notification__body">
        <span>{shown.text}</span>
        <span className="v-caption v-quiet">
          <time dateTime={entry.createdAt}>
            {formatRelative(entry.createdAt)}
          </time>
          {unread ? <span className="v-visually-hidden"> · unread</span> : null}
        </span>
      </span>
      {destination === undefined ? null : (
        <Icon name="chevronRight" size="sm" />
      )}
    </>
  );

  const className = `v-notification${unread ? ' v-notification--unread' : ''}`;

  if (destination === undefined) {
    return (
      <div
        className={className}
        data-read={unread ? 'false' : 'true'}
        data-testid={`notification-${entry.id}`}
      >
        {body}
        {unread ? (
          <Button
            data-testid={`notification-read-${entry.id}`}
            onClick={onRead}
            size="sm"
            tone="ghost"
          >
            Mark read
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      className={className}
      data-read={unread ? 'false' : 'true'}
      data-testid={`notification-${entry.id}`}
      href={destination}
      onClick={onRead}
    >
      {body}
    </Link>
  );
}

function dedupe(
  entries: readonly NotificationEntry[],
): readonly NotificationEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return [...byId.values()];
}
