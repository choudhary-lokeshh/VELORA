import type {
  Call,
  CallMedium,
  Conversation,
  Message,
} from '@velora/consumer-client';
import { failureMessage, isOk, isRetryable } from '@velora/consumer-client';
import { maximumMessageBodyCharacters } from '@velora/validation/messaging-bounds';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi, useSession, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  ErrorState,
  IconButton,
  Inline,
  Notice,
  RowSkeleton,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { color, layout, radius, space } from '../design/tokens';
import { formatWhen } from './locale';
import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from './resource';
import { PersonSafetyMenu } from './safety-actions';
import { CurrentCall } from './introductions';
import { MobileAiAssist } from './ai-assist';

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
  const toast = useToast();
  const ownAccountId = useSession().account.account.value?.id;
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingMessage | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [call, setCall] = useState<Call | undefined>(undefined);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const callFlight = useSingleFlight();
  const sending = useSingleFlight();
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

  const applyCurrentCall = useCallback(
    (current: Awaited<ReturnType<typeof api.readCall>>) => {
      if (isOk(current)) setCall(current.value);
      else if (current.kind === 'not-found') setCall(undefined);
    },
    [],
  );

  useRevalidateOnForeground(
    useCallback(() => {
      void readPage(undefined, true);
      if (call !== undefined) void api.readCall(call.id).then(applyCurrentCall);
    }, [api, applyCurrentCall, call, readPage]),
  );

  // Opening a thread is a read. The server clamps this to what exists and the
  // write is monotonic, so a stale device can never move the position back.
  useEffect(() => {
    const newest = messages.reduce(
      (sequence, message) => Math.max(sequence, message.sequence),
      0,
    );
    if (newest <= conversation.lastReadSequence) return;
    void api
      .markConversationRead({ conversationId, sequence: newest })
      .then((result) => {
        if (isOk(result)) onChanged();
      });
  }, [api, conversation.lastReadSequence, conversationId, messages, onChanged]);

  const actOnCall = (work: () => ReturnType<typeof api.readCall>) => {
    callFlight.run(async () => {
      const result = await work();
      const failure = failureMessage(result);
      if (failure !== undefined) toast.show(failure, 'critical');
      if (isOk(result)) setCall(result.value);
      else if (call !== undefined)
        applyCurrentCall(await api.readCall(call.id));
    });
  };

  const placeCall = (medium: CallMedium) => {
    actOnCall(async () =>
      api.call({
        introductionId: conversation.relationship.introductionId,
        medium,
      }),
    );
  };

  const send = (attempt: PendingMessage) => {
    sending.run(async () => {
      setPending({ ...attempt, message: undefined, state: 'sending' });
      const result = await api.sendMessage({
        body: attempt.body,
        clientMessageId: attempt.clientMessageId,
        conversationId,
      });
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
      /*
       * The text now lives in the failure block, not the box. Leaving it in
       * both places armed a second Send with a *new* client message id — and
       * a request that committed before its response was lost then posts
       * twice. Try again reuses the one id; Edit puts the words back.
       */
      setDraft('');
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
  const tooLong = draft.length > maximumMessageBodyCharacters;

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
      <View style={styles.fill}>
        {call === undefined ? (
          <Card testID="conversation-call-entry" tone="surface2">
            <Stack gap={3}>
              <Text tone="secondary" variant="small">
                Connected through a mutual introduction. Calls carry lifecycle
                only here—no microphone, camera, or media stream.
              </Text>
              <Inline gap={2}>
                <View style={styles.half}>
                  <Button
                    disabled={closed || callFlight.busy}
                    icon="phone"
                    onPress={() => {
                      placeCall('voice');
                    }}
                    testID={`call-voice-${conversation.relationship.introductionId}`}
                    wide
                  >
                    Voice
                  </Button>
                </View>
                <View style={styles.half}>
                  <Button
                    disabled={closed || callFlight.busy}
                    icon="video"
                    onPress={() => {
                      placeCall('video');
                    }}
                    testID={`call-video-${conversation.relationship.introductionId}`}
                    wide
                  >
                    Video
                  </Button>
                </View>
              </Inline>
            </Stack>
          </Card>
        ) : (
          <CurrentCall
            call={call}
            onAccept={() => {
              actOnCall(async () => api.acceptCall(call.id));
            }}
            onCancel={() => {
              actOnCall(async () => api.cancelCall(call.id));
            }}
            onDismiss={() => {
              setCall(undefined);
            }}
            onEnd={() => {
              actOnCall(async () => api.endCall(call.id));
            }}
            onJoin={() => {
              callFlight.run(async () => {
                const failure = failureMessage(
                  await api.joinAuthorization(call.id),
                );
                if (failure !== undefined) toast.show(failure, 'critical');
                applyCurrentCall(await api.readCall(call.id));
              });
            }}
            onReject={() => {
              actOnCall(async () => api.rejectCall(call.id));
            }}
            pending={callFlight.busy}
          />
        )}

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
            // A log: messages arrive rather than being asked for, and a
            // reader should hear one land instead of re-reading to find it.
            accessibilityLiveRegion="polite"
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
                <Text
                  testID="message-send-body"
                  tone="secondary"
                  variant="small"
                >
                  {pending.body}
                </Text>
                <Inline gap={2}>
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
                  ) : null}
                  <Button
                    onPress={() => {
                      setDraft(pending.body);
                      setPending(undefined);
                    }}
                    size="small"
                    testID="message-edit"
                    tone="ghost"
                  >
                    Edit
                  </Button>
                  {pending.state === 'refused' ? (
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
                  ) : null}
                </Inline>
              </Stack>
            )}

            <MobileAiAssist
              capability="consumer_chat_reply"
              draft={draft}
              onReplace={setDraft}
              testID="message-ai"
            />

            <View style={styles.composerRow}>
              <TextField
                accessibilityLabel="Message"
                editable={pending?.state !== 'sending'}
                invalid={tooLong}
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
            <View style={styles.composerMeta}>
              <Text tone="tertiary" variant="micro">
                Text only · Attachments unavailable · Not end-to-end encrypted.
              </Text>
              {draft.length > maximumMessageBodyCharacters * 0.8 ? (
                <Text
                  testID="message-count"
                  tone={tooLong ? 'critical' : 'caution'}
                  variant="micro"
                >
                  {draft.length}/{maximumMessageBodyCharacters}
                </Text>
              ) : null}
            </View>
            {tooLong ? (
              <ErrorMessage testID="message-too-long">
                That is longer than a message can be. Trim it and send again.
              </ErrorMessage>
            ) : null}
          </View>
        )}
      </View>
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
        /*
          Whose message this is, in words. Side and colour are the only things
          that carried it, and neither reaches a reader: the thread was spoken
          as an undifferentiated run of sentences.
        */
        accessible
        accessibilityLabel={`${own ? 'You' : 'They'} said: ${message.body}`}
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
  composerMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
    justifyContent: 'space-between',
  },
  composerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: space[2],
    minHeight: layout.minimumTouchTarget,
  },
  fill: { flex: 1 },
  half: { flex: 1 },
  pending: { alignItems: 'flex-start' },
  stampOwn: { opacity: 0.72 },
  thread: { gap: space[2], paddingVertical: space[4] },
});
