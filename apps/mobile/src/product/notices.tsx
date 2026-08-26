import type {
  ApiResult,
  ConsumerApi,
  DiscoveryPerson,
  NotificationEntry,
} from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { maximumNotificationReadBatch } from '@velora/validation/notifications-bounds';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Avatar,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorMessage,
  ErrorState,
  ListRow,
  RowSkeleton,
  Text,
} from '../design/primitives';
import { Icon, type IconName } from '../design/icons';
import { color, space } from '../design/tokens';
import { portraitReferences, useMediaAddresses } from './imagery';
import { formatWhen } from './locale';
import { useResource, useRevalidateOnForeground } from './resource';

/**
 * What happened while somebody was away.
 *
 * Past tense, with a link to current domain truth. A call notice never offers
 * to answer: it opens the relationship, because the call that produced the
 * line may have stopped ringing long before anybody reads it.
 *
 * Nothing here is a push notification. No device token is registered and no
 * permission is asked for without an approved provider behind it. This screen
 * remains durable product truth whether external delivery exists or not.
 */

const pageSize = 20;

const notices: Readonly<
  Record<
    NotificationEntry['kind'],
    { readonly icon: IconName; readonly label: (displayName: string) => string }
  >
> = {
  call_incoming: {
    icon: 'phone',
    label: (displayName) => `${displayName} called you.`,
  },
  call_missed: {
    icon: 'phoneOff',
    label: (displayName) => `You missed a call from ${displayName}.`,
  },
  introduction_mutual: {
    icon: 'link',
    label: (displayName) =>
      `You and ${displayName} have a mutual introduction.`,
  },
  message_received: {
    icon: 'message',
    label: (displayName) => `${displayName} sent you a message.`,
  },
};

type NotificationPeople = ReadonlyMap<string, DiscoveryPerson | null>;

async function markRead(
  api: ConsumerApi,
  notificationIds: readonly string[],
): Promise<string | undefined> {
  for (
    let start = 0;
    start < notificationIds.length;
    start += maximumNotificationReadBatch
  ) {
    const failure = failureMessage(
      await api.markNotificationsRead(
        notificationIds.slice(start, start + maximumNotificationReadBatch),
      ),
    );
    if (failure !== undefined) return failure;
  }
  return undefined;
}

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

function openerFor(
  entry: NotificationEntry,
  onOpenConversation: (conversationId: string) => void,
  onOpenIntroductions: () => void,
): (() => void) | undefined {
  switch (entry.kind) {
    case 'message_received': {
      const conversationId = entry.conversationId;
      return conversationId === undefined
        ? undefined
        : () => {
            onOpenConversation(conversationId);
          };
    }
    case 'introduction_mutual':
      return entry.introductionId === undefined
        ? undefined
        : onOpenIntroductions;
    case 'call_incoming':
    case 'call_missed':
      return onOpenIntroductions;
  }
}

export function NoticesScreen({
  onOpenConversation,
  onOpenIntroductions,
}: {
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenIntroductions: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.notifications({ pageSize }, signal),
    [api],
  );
  const notifications = useResource(load);
  // Held outside state so a re-render cannot re-acknowledge what has already
  // been acknowledged once.
  const acknowledged = useRef(new Set<string>());
  const [marking, setMarking] = useState(false);
  const [older, setOlder] = useState<readonly NotificationEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  useRevalidateOnForeground(notifications.reload);

  useEffect(() => {
    setOlder([]);
    setCursor(notifications.value?.nextCursor);
  }, [notifications.value]);

  const entries = dedupe([
    ...(notifications.value?.notifications ?? []),
    ...older,
  ]);
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
  const answered =
    (!notifications.loading || notifications.value !== undefined) &&
    (peopleReady || people.error !== undefined);

  const acknowledge = (ids: readonly string[]) => {
    const fresh = ids.filter((id) => !acknowledged.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) acknowledged.current.add(id);
    setMarking(true);
    void markRead(api, fresh)
      .then((failure) => {
        if (failure !== undefined) {
          for (const id of fresh) acknowledged.current.delete(id);
          toast.show(failure, 'critical');
        }
        notifications.reload();
      })
      .finally(() => {
        setMarking(false);
      });
  };

  return (
    <Screen
      onRefresh={notifications.reload}
      refreshing={notifications.loading && entries.length > 0}
      scroll={false}
      subtitle={
        unread.length === 0
          ? 'Nothing unread.'
          : `${String(unread.length)} unread`
      }
      testID="notices-screen"
      title="Notices"
      trailing={
        unread.length === 0 ? undefined : (
          <Button
            busy={marking}
            onPress={() => {
              acknowledge(unread.map((entry) => entry.id));
            }}
            size="small"
            testID="notifications-mark-read"
          >
            Mark read
          </Button>
        )
      }
    >
      {notifications.error !== undefined && entries.length > 0 ? (
        <View style={styles.inlineError}>
          <ErrorMessage testID="notifications-refresh-failed">
            {notifications.error}
          </ErrorMessage>
          {notifications.retryable ? (
            <Button
              onPress={notifications.reload}
              size="small"
              testID="notifications-refresh-retry"
            >
              Try again
            </Button>
          ) : null}
        </View>
      ) : null}

      {people.error !== undefined && peopleReady ? (
        <View style={styles.inlineError}>
          <ErrorMessage testID="notification-people-refresh-failed">
            {people.error}
          </ErrorMessage>
          {people.retryable ? (
            <Button
              onPress={people.reload}
              size="small"
              testID="notification-people-refresh-retry"
            >
              Try again
            </Button>
          ) : null}
        </View>
      ) : null}

      {!answered ? (
        <Card>
          <RowSkeleton rows={4} />
        </Card>
      ) : notifications.error !== undefined && entries.length === 0 ? (
        <ErrorState
          body={notifications.error}
          testID="notifications-failed"
          {...(notifications.retryable
            ? { onRetry: notifications.reload }
            : {})}
        />
      ) : people.error !== undefined && !peopleReady ? (
        <ErrorState
          body={people.error}
          testID="notification-people-failed"
          {...(people.retryable ? { onRetry: people.reload } : {})}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          body="When somebody says yes to an introduction, sends you a message, or calls, it appears here."
          icon="bell"
          testID="notifications-empty"
          title="Nothing yet"
        />
      ) : (
        <Card padded={false} testID="notification-list">
          <View style={styles.rows}>
            <FlatList
              data={[...entries]}
              ItemSeparatorComponent={Divider}
              keyExtractor={(entry: NotificationEntry) => entry.id}
              ListFooterComponent={
                cursor === undefined ? null : (
                  <View style={styles.more}>
                    <Button
                      busy={loadingMore}
                      onPress={() => {
                        const from = cursor;
                        setLoadingMore(true);
                        void api
                          .notifications({ cursor: from, pageSize })
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
                      size="small"
                      testID="notifications-more"
                    >
                      Load older
                    </Button>
                  </View>
                )
              }
              renderItem={({ item }) => {
                const look = notices[item.kind];
                const fresh = item.readAt === undefined;
                const person = people.value?.get(item.subjectId) ?? null;
                const open =
                  person === null
                    ? undefined
                    : openerFor(item, onOpenConversation, onOpenIntroductions);
                const available = person !== null && open !== undefined;
                const mediaId = person?.media[0]?.id;
                return (
                  <ListRow
                    leading={
                      available ? (
                        <View style={styles.identity}>
                          <Avatar
                            displayName={person.displayName}
                            seed={person.id}
                            size="medium"
                            source={
                              mediaId === undefined
                                ? undefined
                                : portraits.get(mediaId)
                            }
                            testID={`notification-portrait-${item.id}`}
                          />
                          <View style={styles.kindMark}>
                            <Icon
                              color={fresh ? color.ember : color.textSecondary}
                              name={look.icon}
                              size="sm"
                            />
                          </View>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.mark,
                            fresh ? styles.markFresh : undefined,
                          ]}
                        >
                          <Icon
                            color={fresh ? color.ember : color.textTertiary}
                            name="info"
                            size="md"
                          />
                        </View>
                      )
                    }
                    testID={`notification-${item.id}`}
                    {...(open === undefined
                      ? {}
                      : {
                          onPress: () => {
                            acknowledge([item.id]);
                            open();
                          },
                        })}
                    {...(!available && fresh
                      ? {
                          trailing: (
                            <Button
                              onPress={() => {
                                acknowledge([item.id]);
                              }}
                              size="small"
                              testID={`notification-read-${item.id}`}
                              tone="ghost"
                            >
                              Mark read
                            </Button>
                          ),
                        }
                      : {})}
                  >
                    <Text weight={fresh ? 'medium' : 'regular'}>
                      {available
                        ? look.label(person.displayName)
                        : 'This activity is no longer available.'}
                    </Text>
                    <Text tone="tertiary" variant="caption">
                      {formatWhen(item.createdAt)}
                    </Text>
                  </ListRow>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { height: 44, position: 'relative', width: 44 },
  inlineError: {
    alignItems: 'flex-start',
    gap: space[2],
    marginBottom: space[3],
  },
  kindMark: {
    alignItems: 'center',
    backgroundColor: color.surface1,
    borderColor: color.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    bottom: -3,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    width: 22,
  },
  more: { alignItems: 'center', paddingVertical: space[4] },
  mark: {
    alignItems: 'center',
    backgroundColor: color.surface3,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  markFresh: { backgroundColor: color.emberWash },
  rows: { paddingHorizontal: space[4] },
});

function dedupe(
  entries: readonly NotificationEntry[],
): readonly NotificationEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return [...byId.values()];
}
