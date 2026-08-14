import type {
  ApiResult,
  ConsumerApi,
  Conversation,
  DiscoveryCandidate,
  Message,
  NotificationEntry,
} from '@velora/consumer-client';
import {
  availabilityLabels,
  availabilityView,
  failureMessage,
  isRetryable,
  profileMediaLabels,
  profileMediaState,
} from '@velora/consumer-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';

import type { AccountState } from './account';
import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from './resource';
import {
  Action,
  ErrorMessage,
  ResourceState,
  Section,
  StatusMessage,
} from './ui';

/**
 * The product areas, on a phone.
 *
 * Every list is paged and virtualised. A phone is the device most likely to
 * meet a long history and least able to render one, so nothing here loads a
 * whole conversation, a whole feed, or a whole notification history: each list
 * asks for a bounded page and asks again only when somebody reaches the end of
 * what they have.
 *
 * Nothing polls. The app asks again when it comes back to the foreground and
 * when somebody acts; a background timer would spend a battery keeping a screen
 * nobody is looking at fresh.
 */

const pageSize = 20;

/** How many candidates one screenful tries to hold. */
const candidateTarget = 10;

/**
 * How many requests one discovery fill may make.
 *
 * A short page carrying a cursor does not mean there is nothing left, so the
 * client keeps asking — but a bounded number of times, so one pull cannot walk
 * somebody's entire suppression history over a mobile connection.
 */
const maximumFillRequests = 4;

export function DiscoveryArea({ api }: { readonly api: ConsumerApi }) {
  const [candidates, setCandidates] = useState<readonly DiscoveryCandidate[]>(
    [],
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const decision = useSingleFlight();
  const inFlight = useRef<AbortController | undefined>(undefined);

  const fill = useCallback(
    async (from: {
      readonly cursor: string | undefined;
      readonly held: readonly DiscoveryCandidate[];
    }) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError(undefined);

      const collected = [...from.held];
      const seen = new Set(collected.map((candidate) => candidate.id));
      let next = from.cursor;
      let done = false;
      let failure: ApiResult<unknown> | undefined;

      for (
        let request = 0;
        request < maximumFillRequests && collected.length < candidateTarget;
        request += 1
      ) {
        const result = await api.candidates(
          { cursor: next, pageSize: candidateTarget },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.kind !== 'ok') {
          failure = result;
          break;
        }
        for (const candidate of result.value.candidates) {
          // Defensive: the server does not promise a candidate cannot appear on
          // two pages, and two rows for one person would invite two conflicting
          // decisions about them.
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          collected.push(candidate);
        }
        next = result.value.nextCursor;
        if (next === undefined) {
          done = true;
          break;
        }
      }

      if (controller.signal.aborted) return;
      setLoading(false);
      setCandidates(collected);
      setCursor(next);
      setExhausted(done);
      if (failure !== undefined) {
        setError(failureMessage(failure));
        setRetryable(isRetryable(failure));
      }
    },
    // Depends on nothing that changes as the list grows: what is already held
    // is passed in, so a page arriving cannot restart the feed that fetched it.
    [api],
  );

  useEffect(() => {
    void fill({ cursor: undefined, held: [] });
    return () => {
      inFlight.current?.abort();
    };
  }, [fill]);

  const decide = (
    candidateId: string,
    work: () => Promise<ApiResult<unknown>>,
    success: string,
  ) => {
    // A duplicate tap cannot produce a second request. The guard is a ref
    // inside `useSingleFlight`, not component state: three presses in one frame
    // would all read a state flag as it was before any of them committed.
    decision.run(async () => {
      setPending(candidateId);
      setNotice(undefined);
      try {
        const result = await work();
        if (result.kind === 'ok') {
          setNotice(success);
          setCandidates((current) =>
            current.filter((candidate) => candidate.id !== candidateId),
          );
          return;
        }
        setNotice(failureMessage(result));
        await fill({ cursor: undefined, held: [] });
      } finally {
        setPending(undefined);
      }
    });
  };

  return (
    <Section title="Discovery">
      {notice === undefined ? null : (
        <StatusMessage testID="discovery-notice">{notice}</StatusMessage>
      )}
      {error === undefined ? null : (
        <View testID="discovery-failed">
          <ErrorMessage>{error}</ErrorMessage>
          {retryable ? (
            <Action
              label="Try again"
              onPress={() => {
                void fill({ cursor: undefined, held: [] });
              }}
              testID="discovery-retry"
            />
          ) : null}
        </View>
      )}
      {loading && candidates.length === 0 ? (
        <StatusMessage testID="discovery-loading">
          Looking for people…
        </StatusMessage>
      ) : null}
      {!loading && error === undefined && candidates.length === 0 ? (
        <StatusMessage testID="discovery-empty">
          Nobody is available for you right now.
        </StatusMessage>
      ) : null}

      <FlatList
        data={[...candidates]}
        keyExtractor={(candidate) => candidate.id}
        onEndReached={() => {
          if (exhausted || cursor === undefined || loading) return;
          void fill({ cursor, held: candidates });
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <View testID={`candidate-${item.id}`}>
            <Text accessibilityRole="header">{item.displayName}</Text>
            {item.bio === undefined ? null : <Text>{item.bio}</Text>}
            <Action
              disabled={decision.busy || pending !== undefined}
              label="Say you are interested"
              onPress={() => {
                decide(
                  item.id,
                  async () => api.signalIntroduction(item.id),
                  'Interest sent. They only hear about it if they say yes too.',
                );
              }}
              testID={`signal-${item.id}`}
            />
            <Action
              disabled={decision.busy || pending !== undefined}
              label="Pass"
              onPress={() => {
                decide(
                  item.id,
                  async () => api.pass(item.id),
                  'Passed. They are not told.',
                );
              }}
              testID={`pass-${item.id}`}
            />
          </View>
        )}
        testID="discovery-list"
      />
    </Section>
  );
}

export function IntroductionsArea({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({ pageSize }, signal),
    [api],
  );
  const introductions = useResource(load);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy: pending, run } = useSingleFlight();

  useRevalidateOnForeground(introductions.reload);

  const act = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setNotice(undefined);
      setNotice(failureMessage(await work()));
      introductions.reload();
    });
  };

  const rows = introductions.value?.introductions ?? [];

  return (
    <Section title="Introductions">
      <ResourceState resource={introductions} testID="introductions" />
      {notice === undefined ? null : (
        <StatusMessage testID="introductions-notice">{notice}</StatusMessage>
      )}
      {!introductions.loading &&
      introductions.error === undefined &&
      rows.length === 0 ? (
        <StatusMessage testID="introductions-empty">
          No introductions yet.
        </StatusMessage>
      ) : null}
      <FlatList
        data={[...rows]}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <View testID={`introduction-${item.id}`}>
            <Text accessibilityRole="header">
              {item.counterpart.displayName}
            </Text>
            <Text>
              {item.state === 'mutual'
                ? 'You both said yes.'
                : item.role === 'initiator'
                  ? 'Waiting for them.'
                  : 'They are interested in meeting you.'}
            </Text>
            {item.state === 'mutual' ? (
              <Action
                disabled={pending}
                label="Open conversation"
                onPress={() => {
                  act(async () => api.openConversation(item.id));
                }}
                testID={`open-${item.id}`}
              />
            ) : item.role === 'recipient' ? (
              <Action
                disabled={pending}
                label="Say you are interested too"
                onPress={() => {
                  act(async () => api.signalIntroduction(item.counterpart.id));
                }}
                testID={`accept-${item.id}`}
              />
            ) : (
              <Action
                disabled={pending}
                label="Withdraw"
                onPress={() => {
                  act(async () => api.withdrawIntroduction(item.id));
                }}
                testID={`withdraw-${item.id}`}
              />
            )}
          </View>
        )}
        testID="introductions-list"
      />
    </Section>
  );
}

export function ConversationsArea({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.conversations({ pageSize }, signal),
    [api],
  );
  const conversations = useResource(load);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  useRevalidateOnForeground(conversations.reload);

  const rows = conversations.value?.conversations ?? [];
  const open = rows.find((row) => row.id === openId);

  return (
    <Section title="Conversations">
      <ResourceState resource={conversations} testID="conversations" />
      {!conversations.loading &&
      conversations.error === undefined &&
      rows.length === 0 ? (
        <StatusMessage testID="conversations-empty">
          No conversations yet.
        </StatusMessage>
      ) : null}
      <FlatList
        data={[...rows]}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <Action
            label={`${item.counterpart.displayName}${
              item.lastMessageSequence > item.lastReadSequence
                ? ' (unread)'
                : ''
            }${item.state === 'closed' ? ' (closed)' : ''}`}
            onPress={() => {
              setOpenId(item.id);
            }}
            testID={`conversation-${item.id}`}
          />
        )}
        testID="conversation-list"
      />
      {open === undefined ? null : (
        <ConversationView
          api={api}
          conversation={open}
          onChanged={conversations.reload}
        />
      )}
    </Section>
  );
}

interface PendingMessage {
  readonly body: string;
  /** Generated once, reused by every retry. This is what makes retry safe. */
  readonly clientMessageId: string;
  readonly message: string | undefined;
  readonly state: 'sending' | 'failed' | 'refused';
}

function ConversationView({
  api,
  conversation,
  onChanged,
}: {
  readonly api: ConsumerApi;
  readonly conversation: Conversation;
  readonly onChanged: () => void;
}) {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingMessage | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const inFlight = useRef<AbortController | undefined>(undefined);
  const conversationId = conversation.id;

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

  // Server-assigned position, never a device clock. Two phones with different
  // clocks still read the same conversation in the same order.
  const ordered = [...messages].sort((left, right) =>
    left.sequence === right.sequence
      ? left.id.localeCompare(right.id)
      : left.sequence - right.sequence,
  );

  return (
    <View testID="conversation-view">
      <Text accessibilityRole="header">
        {conversation.counterpart.displayName}
      </Text>
      {conversation.state === 'closed' ? (
        <StatusMessage testID="conversation-closed">
          This conversation is closed. You can still read it.
        </StatusMessage>
      ) : null}
      {loading && messages.length === 0 ? (
        <StatusMessage testID="messages-loading">
          Loading messages…
        </StatusMessage>
      ) : null}
      {error === undefined ? null : (
        <ErrorMessage testID="messages-failed">{error}</ErrorMessage>
      )}

      <FlatList
        data={ordered}
        inverted={false}
        keyExtractor={(message) => message.id}
        onEndReached={() => {
          if (cursor === undefined || loading) return;
          void readPage(cursor, false);
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <Text testID={`message-${String(item.sequence)}`}>{item.body}</Text>
        )}
        testID="messages"
      />

      <TextInput
        accessibilityLabel="Message"
        editable={
          pending?.state !== 'sending' && conversation.state !== 'closed'
        }
        maxLength={4000}
        multiline
        onChangeText={setDraft}
        testID="message-input"
        value={draft}
      />
      <Action
        disabled={
          pending?.state === 'sending' ||
          draft.trim().length === 0 ||
          conversation.state === 'closed'
        }
        label="Send"
        onPress={() => {
          const body = draft.trim();
          if (body.length === 0) return;
          send({
            body,
            // Generated here, once. A retry reuses it, which is what makes a
            // lost response safe to repeat.
            clientMessageId: crypto.randomUUID(),
            message: undefined,
            state: 'sending',
          });
        }}
        testID="message-send"
      />

      {pending === undefined ? null : pending.state === 'sending' ? (
        <StatusMessage testID="message-sending">Sending…</StatusMessage>
      ) : (
        <View testID="message-pending">
          <ErrorMessage testID="message-send-failed">
            {pending.message}
          </ErrorMessage>
          {pending.state === 'failed' ? (
            <Action
              label="Try again"
              onPress={() => {
                send(pending);
              }}
              testID="message-retry"
            />
          ) : (
            <Action
              label="Dismiss"
              onPress={() => {
                setPending(undefined);
              }}
              testID="message-discard"
            />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Adds messages without ever showing one twice. Paging, revalidation, and a send
 * that succeeded can all deliver the same message; the identifier is what makes
 * the duplicate detectable.
 */
function merge(
  current: readonly Message[],
  incoming: readonly Message[],
): readonly Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()];
}

const notificationLabels: Readonly<Record<string, string>> = {
  introduction_mutual: 'You have a new mutual introduction.',
  message_received: 'You have a new message.',
};

export function NotificationsArea({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.notifications({ pageSize }, signal),
    [api],
  );
  const notifications = useResource(load);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const acknowledged = useRef(new Set<string>());

  useRevalidateOnForeground(notifications.reload);

  const entries = notifications.value?.notifications ?? [];
  const unread = entries.filter((entry) => entry.readAt === undefined);

  const acknowledge = (ids: readonly string[]) => {
    const fresh = ids.filter((id) => !acknowledged.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) acknowledged.current.add(id);
    void api.markNotificationsRead(fresh).then((result) => {
      setMessage(failureMessage(result));
      notifications.reload();
    });
  };

  return (
    <Section title="Notifications">
      <ResourceState resource={notifications} testID="notifications" />
      {message === undefined ? null : (
        <ErrorMessage testID="notifications-error">{message}</ErrorMessage>
      )}
      <StatusMessage testID="notifications-unread">
        {unread.length === 0
          ? 'Nothing unread.'
          : `${String(unread.length)} unread`}
      </StatusMessage>
      {!notifications.loading &&
      notifications.error === undefined &&
      entries.length === 0 ? (
        <StatusMessage testID="notifications-empty">Nothing yet.</StatusMessage>
      ) : null}
      {unread.length === 0 ? null : (
        <Action
          label="Mark all as read"
          onPress={() => {
            acknowledge(unread.map((entry) => entry.id));
          }}
          testID="notifications-mark-read"
        />
      )}
      <FlatList
        data={[...entries]}
        keyExtractor={(entry: NotificationEntry) => entry.id}
        renderItem={({ item }) => (
          <Text testID={`notification-${item.id}`}>
            {notificationLabels[item.kind] ?? 'Something happened.'}
          </Text>
        )}
        testID="notification-list"
      />
    </Section>
  );
}

const reportReasons = [
  { label: 'They may be under 18', value: 'underage_concern' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Sexual content violation', value: 'sexual_content_violation' },
  { label: 'Impersonation', value: 'impersonation' },
  { label: 'Spam or a scam', value: 'spam_or_scam' },
  { label: 'Something else', value: 'other' },
] as const;

export function SafetyArea({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.blocks({ pageSize }, signal),
    [api],
  );
  const blocks = useResource(load);
  const [targetId, setTargetId] = useState('');
  const [detail, setDetail] = useState('');
  const [reasonCode, setReasonCode] =
    useState<(typeof reportReasons)[number]['value']>('harassment');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  const act = (work: () => Promise<ApiResult<unknown>>, success: string) => {
    run(async () => {
      setNotice(undefined);
      const result = await work();
      setNotice(result.kind === 'ok' ? success : failureMessage(result));
      blocks.reload();
    });
  };

  return (
    <Section title="Safety">
      <ResourceState resource={blocks} testID="blocks" />
      {notice === undefined ? null : (
        <StatusMessage testID="safety-notice">{notice}</StatusMessage>
      )}
      <FlatList
        data={[...(blocks.value?.blocks ?? [])]}
        keyExtractor={(block) => block.blockedId}
        renderItem={({ item }) => (
          <Action
            disabled={busy}
            label={`Remove block on ${item.blockedId}`}
            onPress={() => {
              act(
                async () => api.unblock(item.blockedId),
                'Block removed. They are not told either way.',
              );
            }}
            testID={`unblock-${item.blockedId}`}
          />
        )}
        testID="block-list"
      />

      <TextInput
        accessibilityLabel="Person identifier"
        onChangeText={setTargetId}
        testID="safety-target"
        value={targetId}
      />
      <Action
        disabled={busy || targetId.length === 0}
        label="Block"
        onPress={() => {
          act(
            async () => api.block(targetId),
            'Blocked. They are not told, and they cannot reach you.',
          );
        }}
        testID="block-submit"
      />

      <Text accessibilityRole="header">Report someone</Text>
      <FlatList
        data={[...reportReasons]}
        keyExtractor={(reason) => reason.value}
        renderItem={({ item }) => (
          <Action
            label={`${item.value === reasonCode ? '• ' : ''}${item.label}`}
            onPress={() => {
              setReasonCode(item.value);
            }}
            testID={`reason-${item.value}`}
          />
        )}
        testID="report-reasons"
      />
      <TextInput
        accessibilityLabel="Anything you want to add"
        maxLength={2000}
        multiline
        onChangeText={setDetail}
        testID="report-detail"
        value={detail}
      />
      <Action
        disabled={busy || targetId.length === 0}
        label="Send report"
        onPress={() => {
          act(
            async () =>
              api.report({
                // Makes submission retry-safe. The server scopes it to the
                // reporter, so it cannot collide with anybody else's.
                clientReportId: crypto.randomUUID(),
                ...(detail.trim().length === 0 ? {} : { detail }),
                reasonCode,
                subjectId: targetId,
              }),
            'Report received. The other person is not told you reported them.',
          );
          // Cleared immediately: the narrative is evidence, not something this
          // screen keeps a copy of.
          setDetail('');
        }}
        testID="report-submit"
      />
    </Section>
  );
}

export function ProfileArea({
  account,
  api,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(load);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  useRevalidateOnForeground(availability.reload);

  const profile = account.profile.value;
  const view = availabilityView(availability.value);

  const save = (state: 'available' | 'unavailable') => {
    run(async () => {
      setNotice(undefined);
      const result = await api.saveAvailability(
        state === 'available'
          ? {
              // A window always has an end. The device clock chooses when to
              // ask; the server decides whether the window is still open.
              availableUntil: new Date(
                Date.now() + 4 * 60 * 60 * 1000,
              ).toISOString(),
              state,
            }
          : { state },
      );
      setNotice(failureMessage(result));
      availability.reload();
    });
  };

  return (
    <Section title="Profile">
      <StatusMessage testID="profile-name">
        {profile?.displayName ?? 'No display name yet'}
      </StatusMessage>
      <StatusMessage testID="profile-media-state">
        {profileMediaLabels[profileMediaState(profile)]}
      </StatusMessage>
      <StatusMessage testID="profile-requirements">
        {profile === undefined || profile.outstandingRequirements.length === 0
          ? 'Your profile meets the minimum to be seen.'
          : `Still needed: ${profile.outstandingRequirements
              .map((requirement) => requirement.replaceAll('_', ' '))
              .join(', ')}`}
      </StatusMessage>

      <ResourceState resource={availability} testID="availability" />
      <StatusMessage testID="availability-state">
        {availabilityLabels[view]}
      </StatusMessage>
      {notice === undefined ? null : (
        <ErrorMessage testID="availability-error">{notice}</ErrorMessage>
      )}
      <Action
        disabled={busy}
        label={
          view === 'available' ? 'Extend availability' : 'Become available'
        }
        onPress={() => {
          save('available');
        }}
        testID="availability-start"
      />
      <Action
        disabled={busy || view === 'unavailable'}
        label="Stop being available"
        onPress={() => {
          save('unavailable');
        }}
        testID="availability-stop"
      />
    </Section>
  );
}
