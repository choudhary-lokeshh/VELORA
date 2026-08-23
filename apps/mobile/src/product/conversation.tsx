import type { Conversation, Message } from '@velora/consumer-client';
import { failureMessage, isRetryable } from '@velora/consumer-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import { useApi, useSession } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  ErrorState,
  IconButton,
  Notice,
  RowSkeleton,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { color, layout, radius, space } from '../design/tokens';
import { formatWhen } from './locale';
import { useResource, useRevalidateOnForeground } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * One conversation.
 *
 * The thread reads newest-last, the way a conversation is read, and pages
 * backwards as somebody scrolls up. Order comes from the sequence the server
 * assigned and never from a device clock, so two phones with different clocks
 * read the same conversation in the same order.
 *
 * The composer is the part a phone gets wrong most often. It lifts above the
 * keyboard rather than being covered by it; it stays on screen while a send is
 * in flight; and a send that failed keeps the words. Nothing is optimistically
 * appended to the thread — a message appears once the server has it, because a
 * bubble that later vanishes is worse than a moment of waiting.
 */

const pageSize = 20;

/** The body bound the contract publishes for a message. */
const maximumMessageLength = 4000;

interface PendingMessage {
  readonly body: string;
  /** Generated once, reused by every retry. This is what makes retry safe. */
  readonly clientMessageId: string;
  readonly message: string | undefined;
  readonly state: 'sending' | 'failed' | 'refused';
}

/**
 * A per-message identifier that makes a retry safe.
 *
 * The Expo runtime provides `crypto.randomUUID`; the fallback exists so that a
 * message can still be sent if it does not. The server scopes the value to the
 * sender, so it cannot collide with anybody else's.
 */
function clientMessageId(): string {
  const source = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  return `message-${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Adds messages without ever showing one twice. Paging, revalidation, and a
 * send that succeeded can all deliver the same message; the identifier is what
 * makes the duplicate detectable.
 */
function merge(
  current: readonly Message[],
  incoming: readonly Message[],
): readonly Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()];
}

export function ConversationScreen({
  conversationId,
  onBack,
}: {
  readonly conversationId: string;
  readonly onBack: () => void;
}) {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.conversations({ pageSize }, signal),
    [api],
  );
  const conversations = useResource(load);
  const conversation = conversations.value?.conversations.find(
    (row) => row.id === conversationId,
  );

  useRevalidateOnForeground(conversations.reload);

  if (conversation === undefined) {
    return (
      <Screen onBack={onBack} testID="conversation-screen" title="Conversation">
        {conversations.loading ? (
          <Card>
            <RowSkeleton rows={4} />
          </Card>
        ) : conversations.error !== undefined ? (
          <ErrorState
            body={conversations.error}
            testID="conversation-failed"
            {...(conversations.retryable
              ? { onRetry: conversations.reload }
              : {})}
          />
        ) : (
          <EmptyState
            body="This conversation is not one you hold, or it is no longer here. Nothing was changed."
            icon="message"
            testID="conversation-missing"
            title="That conversation is not here"
          />
        )}
      </Screen>
    );
  }

  return (
    <Thread
      conversation={conversation}
      onBack={onBack}
      onChanged={conversations.reload}
    />
  );
}

function Thread({
  conversation,
  onBack,
  onChanged,
}: {
  readonly conversation: Conversation;
  readonly onBack: () => void;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const ownAccountId = useSession().account.account.value?.id;
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingMessage | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const inFlight = useRef<AbortController | undefined>(undefined);
  const conversationId = conversation.id;
  const closed = conversation.state === 'closed';

  const readPage = useCallback(
    async (from: string | undefined, replace: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      const result = await api.messages(
        {
          conversationId,
          ...(from === undefined ? {} : { cursor: from }),
          pageSize,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLoading(false);
      setAnswered(true);
      if (result.kind !== 'ok') {
        setError(failureMessage(result));
        return;
      }
      setError(undefined);
      setCursor(result.value.nextCursor);
      setMessages((current) =>
        merge(replace ? [] : current, result.value.messages),
      );
    },
    [api, conversationId],
  );

  useEffect(() => {
    setMessages([]);
    setCursor(undefined);
    setPending(undefined);
    void readPage(undefined, true);
    return () => {
      inFlight.current?.abort();
    };
  }, [readPage]);

  useRevalidateOnForeground(
    useCallback(() => {
      void readPage(undefined, true);
    }, [readPage]),
  );

  const send = (attempt: PendingMessage) => {
    setPending({ ...attempt, message: undefined, state: 'sending' });
    void api
      .sendMessage({
        body: attempt.body,
        clientMessageId: attempt.clientMessageId,
        conversationId,
      })
      .then((result) => {
        if (result.kind === 'ok') {
          setPending(undefined);
          setDraft('');
          setMessages((current) => merge(current, [result.value]));
          onChanged();
          return;
        }
        setPending({
          ...attempt,
          message: failureMessage(result),
          // A retryable failure is a condition; a refusal is a decision.
          state: isRetryable(result) ? 'failed' : 'refused',
        });
        if (!isRetryable(result)) onChanged();
      });
  };

  // Server-assigned position, never a device clock. Newest last, so the list is
  // inverted and the newest message sits above the composer.
  const ordered = [...messages].sort((left, right) =>
    left.sequence === right.sequence
      ? left.id.localeCompare(right.id)
      : right.sequence - left.sequence,
  );

  const body = draft.trim();
  const tooLong = body.length > maximumMessageLength;

  return (
    <Screen
      onBack={onBack}
      scroll={false}
      subtitle={closed ? 'Closed. You can still read it.' : undefined}
      testID="conversation-screen"
      title={conversation.counterpart.displayName}
      trailing={
        <PersonSafetyMenu
          onBlocked={onChanged}
          person={{
            displayName: conversation.counterpart.displayName,
            id: conversation.counterpart.id,
          }}
        />
      }
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={space[10]}
        style={styles.fill}
      >
        {!answered ? (
          <Card>
            <RowSkeleton rows={4} />
          </Card>
        ) : error !== undefined && messages.length === 0 ? (
          <ErrorState
            body={error}
            onRetry={() => {
              void readPage(undefined, true);
            }}
            testID="messages-failed"
          />
        ) : messages.length === 0 ? (
          <EmptyState
            body="Nothing has been said yet. Whatever you write is the first thing they see."
            icon="message"
            testID="messages-empty"
            title="No messages yet"
          />
        ) : (
          <FlatList
            contentContainerStyle={styles.thread}
            data={ordered}
            inverted
            keyExtractor={(message) => message.id}
            onEndReached={() => {
              if (cursor === undefined || loading) return;
              void readPage(cursor, false);
            }}
            onEndReachedThreshold={0.5}
            renderItem={({ index, item }) => (
              <Bubble
                message={item}
                ownAccountId={ownAccountId}
                /*
                  The list is inverted, so the entry before this one in the
                  array is the message *after* it in the conversation. A time is
                  shown on the last message of each run by one person, which is
                  where somebody actually looks for it — a stamp under every
                  bubble is noise in a thread of five and unreadable in a thread
                  of five hundred.
                */
                showTime={ordered[index - 1]?.senderId !== item.senderId}
              />
            )}
            showsVerticalScrollIndicator={false}
            testID="messages"
          />
        )}

        {closed ? (
          <Notice
            testID="conversation-closed"
            title="This conversation is closed"
          >
            Nothing more can be sent. Everything already here stays readable.
          </Notice>
        ) : (
          <View style={styles.composer}>
            {pending === undefined ? null : pending.state === 'sending' ? (
              <Text
                accessibilityLiveRegion="polite"
                testID="message-sending"
                tone="tertiary"
                variant="caption"
              >
                Sending…
              </Text>
            ) : (
              <Stack gap={2} style={styles.pending}>
                <ErrorMessage testID="message-send-failed">
                  {pending.message ?? 'That message was not sent.'}
                </ErrorMessage>
                {pending.state === 'failed' ? (
                  <Button
                    icon="refresh"
                    onPress={() => {
                      send(pending);
                    }}
                    size="small"
                    testID="message-retry"
                  >
                    Try again
                  </Button>
                ) : (
                  <Button
                    onPress={() => {
                      setPending(undefined);
                    }}
                    size="small"
                    testID="message-discard"
                    tone="ghost"
                  >
                    Dismiss
                  </Button>
                )}
              </Stack>
            )}

            <View style={styles.composerRow}>
              <TextField
                accessibilityLabel="Message"
                editable={pending?.state !== 'sending'}
                invalid={tooLong}
                maxLength={maximumMessageLength}
                multiline
                onChangeText={setDraft}
                placeholder="Write a message"
                style={styles.composerInput}
                testID="message-input"
                value={draft}
              />
              <IconButton
                disabled={
                  pending?.state === 'sending' || body.length === 0 || tooLong
                }
                label="Send"
                name="send"
                onPress={() => {
                  if (body.length === 0) return;
                  send({
                    body,
                    // Generated here, once. A retry reuses it, which is what
                    // makes a lost response safe to repeat.
                    clientMessageId: clientMessageId(),
                    message: undefined,
                    state: 'sending',
                  });
                }}
                testID="message-send"
                tone={body.length === 0 || tooLong ? 'tertiary' : 'accent'}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One message.
 *
 * Sided by author, which is the only thing that separates the two voices in a
 * thread — and colour alone does not carry it: the sender's own messages are
 * also aligned to the opposite edge, so the thread reads correctly with no
 * colour perception at all.
 */
function Bubble({
  message,
  ownAccountId,
  showTime,
}: {
  readonly message: Message;
  readonly ownAccountId: string | undefined;
  readonly showTime: boolean;
}) {
  /*
   * Whose message this is comes from comparing the sender the server published
   * against this account's own identifier. The contract carries no "outgoing"
   * flag, and inventing one from a local send would be wrong the moment the
   * same conversation is read on a second device.
   */
  const own = ownAccountId !== undefined && message.senderId === ownAccountId;
  return (
    <View
      style={[styles.bubbleRow, own ? styles.bubbleRowOwn : undefined]}
      testID={`message-${String(message.sequence)}`}
    >
      <View
        style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleTheirs]}
      >
        <Text tone={own ? 'onAccent' : 'primary'} variant="small">
          {message.body}
        </Text>
        {showTime ? (
          <Text
            align={own ? 'right' : 'left'}
            style={own ? styles.stampOwn : undefined}
            tone={own ? 'onAccent' : 'tertiary'}
            variant="micro"
          >
            {formatWhen(message.createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: radius.md,
    gap: space[1],
    maxWidth: '84%',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  bubbleOwn: {
    backgroundColor: color.ember,
    borderBottomRightRadius: radius.xs,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleTheirs: {
    backgroundColor: color.surface2,
    borderBottomLeftRadius: radius.xs,
  },
  composer: {
    borderTopColor: color.borderHairline,
    borderTopWidth: 1,
    gap: space[2],
    paddingTop: space[3],
  },
  /*
     The composer starts at one line and grows to about five. `TextField`'s
     multiline default is taller, which is right for a bio and wrong here: a
     message box that opens four lines high pushes the conversation off the
     screen before anybody has typed anything.
  */
  composerInput: { flex: 1, maxHeight: 120, minHeight: layout.controlHeight },
  composerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: space[2],
    minHeight: layout.minimumTouchTarget,
  },
  fill: { flex: 1 },
  pending: { alignItems: 'flex-start' },
  stampOwn: { opacity: 0.72 },
  thread: { gap: space[2], paddingVertical: space[4] },
});
