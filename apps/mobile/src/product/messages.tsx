import type { Conversation, ConversationList } from '@velora/consumer-client';
import { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi } from '../frame/providers';
import { pullToRefresh, Screen } from '../frame/shell';
import {
  Button,
  Avatar,
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorMessage,
  ErrorState,
  ListRow,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { ivoryPreview, space } from '../design/theme';
import { portraitReferences, useMediaAddresses } from './imagery';
import { formatWhen } from './locale';
import {
  useMorePages,
  useResource,
  useRevalidateOnForeground,
} from './resource';

/**
 * Every conversation somebody holds.
 *
 * A row carries who it is with, a bounded server projection of the newest
 * durable message, when it last moved, and whether anything in it is unread.
 * It never promotes a local draft or an unconfirmed send into the preview.
 *
 * Unread is derived from the two sequences the server publishes rather than
 * from anything held here, so a conversation read on another device is read
 * here the next time this screen asks.
 */

const pageSize = 20;

const conversationsOf = (page: ConversationList) => page.conversations;
const conversationKey = (row: Conversation) => row.id;

export function MessagesScreen({
  onOpenIntroductions,
  onOpen,
}: {
  readonly onOpen: (conversationId: string) => void;
  /** Where a first conversation comes from; the empty state offers the walk. */
  readonly onOpenIntroductions: () => void;
}) {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.conversations({ pageSize }, signal),
    [api],
  );
  const conversations = useResource(load);
  useRevalidateOnForeground(conversations.reload);
  const pages = useMorePages(
    conversations.value,
    conversationsOf,
    conversationKey,
    async (cursor) => api.conversations({ cursor, pageSize }),
  );

  const rows = pages.items;
  const portraits = useMediaAddresses(
    portraitReferences(rows.map((row) => row.counterpart)),
    'avatar_small',
  );
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
          action={
            <Button
              onPress={onOpenIntroductions}
              testID="conversations-empty-introductions"
              tone="secondary"
            >
              See your introductions
            </Button>
          }
          body="A conversation starts from a mutual introduction. Open one under Introductions and it appears here."
          icon="message"
          testID="conversations-empty"
          title="No conversations yet"
        />
      ) : (
        <Card
          padded={false}
          style={styles.listFrame}
          testID="conversation-list"
        >
          <View style={styles.rows}>
            <FlatList
              testID="conversation-rows"
              data={[...rows]}
              onRefresh={conversations.reload}
              refreshControl={pullToRefresh(
                conversations.reload,
                conversations.loading,
              )}
              refreshing={conversations.loading}
              ItemSeparatorComponent={Divider}
              keyExtractor={(row) => row.id}
              ListFooterComponent={
                pages.more === undefined ? null : (
                  <Stack gap={2} style={styles.more}>
                    <Button
                      busy={pages.busy}
                      onPress={pages.more}
                      size="small"
                      testID="conversations-more"
                      tone="ghost"
                    >
                      Show more conversations
                    </Button>
                    {pages.error === undefined ? null : (
                      <ErrorMessage testID="conversations-more-failed">
                        {pages.error}
                      </ErrorMessage>
                    )}
                  </Stack>
                )
              }
              renderItem={({ item }) => {
                const unread = item.lastMessageSequence > item.lastReadSequence;
                return (
                  <ListRow
                    leading={
                      <Avatar
                        displayName={item.counterpart.displayName}
                        seed={item.counterpart.id}
                        source={portraits.get(
                          item.counterpart.media[0]?.id ?? '',
                        )}
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
                    <Text numberOfLines={1} tone="secondary" variant="small">
                      {item.lastMessage === undefined
                        ? 'No messages yet — say hello.'
                        : `${
                            item.lastMessage.sender === 'caller' ? 'You: ' : ''
                          }${item.lastMessage.bodyPreview}`}
                    </Text>
                    <Text numberOfLines={1} tone="tertiary" variant="caption">
                      {item.state === 'closed' ? 'Closed · ' : ''}Mutual
                      introduction · {formatWhen(item.lastActivityAt)}
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
  listFrame: { flex: 1, minHeight: 0 },
  more: { paddingVertical: space[3] },
  rows: { flex: 1, paddingHorizontal: ivoryPreview ? 0 : space[4] },
});
