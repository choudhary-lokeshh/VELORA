import type { NotificationEntry } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListRow,
  RowSkeleton,
  Text,
} from '../design/primitives';
import { Icon, type IconName } from '../design/icons';
import { color, space } from '../design/tokens';
import { formatWhen } from './locale';
import { useResource, useRevalidateOnForeground } from './resource';

/**
 * What happened while somebody was away.
 *
 * Past tense, and offering nothing to press. A notice on a phone is read
 * minutes or hours after it arrived, and one that offered to answer would be
 * offering a call that stopped ringing long before anybody saw it. Tapping
 * through to a stale call is exactly the behaviour this avoids.
 *
 * Nothing here is a push notification. No device token is registered and no
 * permission is asked for, because delivering a push needs an approved provider
 * and a native build, and neither exists. This screen is what the product
 * actually has: a list somebody opens.
 */

const pageSize = 20;

const notices: Readonly<
  Record<string, { readonly icon: IconName; readonly label: string }>
> = {
  call_incoming: { icon: 'phone', label: 'Somebody called you.' },
  call_missed: { icon: 'phoneOff', label: 'You missed a call.' },
  introduction_mutual: {
    icon: 'link',
    label: 'You have a new mutual introduction.',
  },
  message_received: { icon: 'message', label: 'You have a new message.' },
};

export function NoticesScreen() {
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

  useRevalidateOnForeground(notifications.reload);

  const entries = notifications.value?.notifications ?? [];
  const unread = entries.filter((entry) => entry.readAt === undefined);
  const answered = !notifications.loading || notifications.value !== undefined;

  const acknowledge = (ids: readonly string[]) => {
    const fresh = ids.filter((id) => !acknowledged.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) acknowledged.current.add(id);
    setMarking(true);
    void api.markNotificationsRead(fresh).then((result) => {
      setMarking(false);
      const failure = failureMessage(result);
      if (failure !== undefined) toast.show(failure, 'critical');
      notifications.reload();
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
              renderItem={({ item }) => {
                const look = notices[item.kind];
                const fresh = item.readAt === undefined;
                return (
                  <ListRow
                    leading={
                      <View
                        style={[
                          styles.mark,
                          fresh ? styles.markFresh : undefined,
                        ]}
                      >
                        <Icon
                          color={fresh ? color.ember : color.textTertiary}
                          name={look?.icon ?? 'info'}
                          size="md"
                        />
                      </View>
                    }
                    testID={`notification-${item.id}`}
                  >
                    <Text weight={fresh ? 'medium' : 'regular'}>
                      {look?.label ?? 'Something happened.'}
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
