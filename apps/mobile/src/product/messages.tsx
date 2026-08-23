import { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Avatar,
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListRow,
  RowSkeleton,
  Text,
} from '../design/primitives';
import { space } from '../design/tokens';
import { formatWhen } from './locale';
import { useResource, useRevalidateOnForeground } from './resource';

/**
 * Every conversation somebody holds.
 *
 * A row carries who it is with, when it last moved, and whether anything in it
 * is unread — and nothing else. It does not carry the last message: a preview
 * on a list screen puts somebody's words on a phone that may be face-up on a
 * table, and this product has no read receipt to trade for it either.
 *
 * Unread is derived from the two sequences the server publishes rather than
 * from anything held here, so a conversation read on another device is read
 * here the next time this screen asks.
 */

const pageSize = 20;

export function MessagesScreen({
  onOpen,
}: {
  readonly onOpen: (conversationId: string) => void;
}) {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.conversations({ pageSize }, signal),
    [api],
  );
  const conversations = useResource(load);
  useRevalidateOnForeground(conversations.reload);

  const rows = conversations.value?.conversations ?? [];
  const answered = !conversations.loading || conversations.value !== undefined;

  return (
    <Screen
      onRefresh={conversations.reload}
      refreshing={conversations.loading && rows.length > 0}
      scroll={false}
      subtitle="Conversations you have opened."
      testID="messages-screen"
      title="Messages"
    >
      {!answered ? (
        <Card>
          <RowSkeleton rows={4} />
        </Card>
      ) : conversations.error !== undefined && rows.length === 0 ? (
        <ErrorState
          body={conversations.error}
          testID="conversations-failed"
          {...(conversations.retryable
            ? { onRetry: conversations.reload }
            : {})}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          body="A conversation starts from a mutual introduction. Open one under Introductions and it appears here."
          icon="message"
          testID="conversations-empty"
          title="No conversations yet"
        />
      ) : (
        <Card padded={false} testID="conversation-list">
          <View style={styles.rows}>
            <FlatList
              data={[...rows]}
              ItemSeparatorComponent={Divider}
              keyExtractor={(row) => row.id}
              renderItem={({ item }) => {
                const unread = item.lastMessageSequence > item.lastReadSequence;
                return (
                  <ListRow
                    leading={
                      <Avatar
                        displayName={item.counterpart.displayName}
                        seed={item.counterpart.id}
                      />
                    }
                    onPress={() => {
                      onOpen(item.id);
                    }}
                    testID={`conversation-${item.id}`}
                    trailing={
                      unread ? (
                        <Badge
                          testID={`conversation-${item.id}-unread`}
                          tone="accent"
                        >
                          Unread
                        </Badge>
                      ) : undefined
                    }
                  >
                    <Text
                      numberOfLines={1}
                      weight={unread ? 'semibold' : 'medium'}
                    >
                      {item.counterpart.displayName}
                    </Text>
                    <Text numberOfLines={1} tone="tertiary" variant="caption">
                      {item.state === 'closed'
                        ? 'Closed'
                        : `Last active ${formatWhen(item.lastActivityAt)}`}
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
  rows: { paddingHorizontal: space[4] },
});
