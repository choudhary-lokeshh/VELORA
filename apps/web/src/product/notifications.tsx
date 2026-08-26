'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ConsumerApi,
  DiscoveryPerson,
  NotificationEntry,
} from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import type { ApiResult } from '@velora/api-client';

import { useApi, useFeeds, useToast } from '../app/providers';
import { Icon, type IconName } from '../design/icons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorMessage,
  Notice,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { formatRelative } from './locale';
import { portraitReferences, useMediaAddresses } from './imagery';
import { useResource } from './resource';

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
 * A notice carries no raw identifiers and no message preview. The contract
 * supplies the subject person and the object reference, and the screen resolves
 * the authorized counterpart identity from DISCOVERY. If the counterpart or
 * target activity has been deleted or revoked, the item remains readable in
 * place as unavailable rather than navigating to a broken route.
 */

const notificationPageSize = 20;

interface Presentation {
  readonly icon: IconName;
  readonly text: (name: string) => string;
}

const presentation: Readonly<Record<string, Presentation>> = {
  call_incoming: {
    icon: 'phone',
    text: (name) =>
      name.length > 0 ? `${name} called you.` : 'Somebody called you.',
  },
  call_missed: {
    icon: 'phoneOff',
    text: (name) =>
      name.length > 0
        ? `You missed a call from ${name}.`
        : 'You missed a call.',
  },
  introduction_mutual: {
    icon: 'link',
    text: (name) =>
      name.length > 0
        ? `You and ${name} have a mutual introduction.`
        : 'You have a new mutual introduction.',
  },
  message_received: {
    icon: 'message',
    text: (name) =>
      name.length > 0
        ? `${name} sent you a message.`
        : 'You have a new message.',
  },
};

function destinationOf(entry: NotificationEntry): string | undefined {
  switch (entry.kind) {
    case 'message_received':
      return entry.conversationId === undefined
        ? undefined
        : `/messages/${entry.conversationId}`;
    case 'introduction_mutual':
      return entry.introductionId === undefined ? undefined : '/introductions';
    case 'call_incoming':
    case 'call_missed':
      // A feed line is history, never a live ringing surface. Re-open the
      // server-authorized relationship rather than a call that already ended.
      return '/introductions';
  }
}

type NotificationPeople = ReadonlyMap<string, DiscoveryPerson | null>;

/**
 * Resolves only the identities a rendered page names, through DISCOVERY's
 * authorized projection. A missing answer is retained as `null` so the screen
 * can render a durable deleted/unavailable state; a transport or server failure
 * remains a real resource failure with retry rather than being disguised as a
 * missing person.
 */
async function resolvePeople(
  api: ConsumerApi,
  subjectKey: string,
  signal: AbortSignal,
): Promise<ApiResult<NotificationPeople>> {
  const subjectIds = subjectKey.length === 0 ? [] : subjectKey.split(',');
  const answers = await Promise.all(
    subjectIds.map(
      async (subjectId) =>
        [subjectId, await api.person(subjectId, signal)] as const,
    ),
  );
  const people = new Map<string, DiscoveryPerson | null>();
  for (const [subjectId, answer] of answers) {
    if (answer.kind === 'ok') {
      people.set(subjectId, answer.value);
      continue;
    }
    if (answer.kind === 'not-found' || answer.kind === 'refused') {
      people.set(subjectId, null);
      continue;
    }
    return answer;
  }
  return { kind: 'ok', value: people };
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

  const subjectKey = [...new Set(entries.map((entry) => entry.subjectId))]
    .sort()
    .join(',');

  const loadPeople = useCallback(
    async (signal: AbortSignal) => resolvePeople(api, subjectKey, signal),
    [api, subjectKey],
  );

  const people = useResource<NotificationPeople>(loadPeople, {
    enabled: entries.length > 0,
  });

  const peopleReady =
    entries.length === 0 ||
    (people.value !== undefined &&
      entries.every((entry) => people.value?.has(entry.subjectId) === true));

  const resolvedPeople =
    people.value === undefined
      ? []
      : [...people.value.values()].filter(
          (person): person is DiscoveryPerson => person !== null,
        );

  const portraits = useMediaAddresses(
    portraitReferences(resolvedPeople),
    'avatar_small',
  );

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

      {entries.length > 0 && !peopleReady && people.error === undefined ? (
        <RowSkeleton rows={Math.min(entries.length, 4)} />
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

      {people.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="notification-people-failed">
            {people.error}
          </ErrorMessage>
          {people.retryable ? (
            <div>
              <Button onClick={people.reload}>Try again</Button>
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

      {entries.length === 0 || !peopleReady ? null : (
        <ul className="v-list" data-testid="notification-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <NotificationRow
                entry={entry}
                onRead={() => {
                  acknowledge([entry.id]);
                }}
                person={people.value?.get(entry.subjectId) ?? null}
                portrait={portraits.get(
                  people.value?.get(entry.subjectId)?.media[0]?.id ?? '',
                )}
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
  person,
  portrait,
}: {
  readonly entry: NotificationEntry;
  readonly onRead: () => void;
  readonly person: DiscoveryPerson | null;
  readonly portrait: string | undefined;
}) {
  const destination = person === null ? undefined : destinationOf(entry);
  const available = person !== null && destination !== undefined;
  const shown = available
    ? (presentation[entry.kind] ?? {
        icon: 'info' as const,
        text: () => 'Something happened.',
      })
    : {
        icon: 'info' as const,
        text: () => 'This activity is no longer available.',
      };
  const unread = entry.readAt === undefined;

  const body = (
    <>
      <span className="v-notification__mark">
        {available ? (
          <>
            <Avatar
              displayName={person.displayName}
              seed={person.id}
              size="sm"
              src={portrait}
            />
            <span className="v-notification__kind">
              <Icon name={shown.icon} size="sm" />
            </span>
          </>
        ) : (
          <Icon name={shown.icon} size="md" />
        )}
      </span>
      <span className="v-notification__body">
        <span>{shown.text(person?.displayName ?? '')}</span>
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
