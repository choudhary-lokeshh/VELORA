'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { maximumMessageBodyCharacters } from '@velora/validation';
import type { ApiResult, Conversation, Message } from '@velora/consumer-client';
import { failureMessage, isRetryable } from '@velora/consumer-client';

import { useAccount, useApi, useFeeds } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorMessage,
  ListRow,
  Notice,
  PageHeader,
  RowSkeleton,
  StatusMessage,
} from '../design/primitives';
import { formatDay, formatRelative, formatTime } from './locale';
import { PersonSafetyMenu } from './safety-actions';
import { useSingleFlight } from './resource';

/**
 * Conversations, and the messages in them.
 *
 * **Messages are not end-to-end encrypted, and nothing here says they are.** The
 * server can read message bodies, because moderation, reporting, and lawful
 * safety review require it; `packages/validation` states this in the contract
 * itself.
 *
 * Three rules govern what happens here. Order is the server's: messages are
 * placed by the sequence it assigned, never by a clock this browser owns, so two
 * devices with different clocks read the same conversation the same way. Retry
 * is safe: every send carries a client message identifier generated once and
 * reused for every attempt, so a response lost after the server committed
 * produces no second message. And nothing is optimistic about permission: a
 * message appears in the transcript when the server says it exists.
 *
 * The list shows no message preview, because the contract publishes none. A
 * conversation list needs a name and a time; a preview would mean the server
 * putting message content into a list response, and it deliberately does not.
 */

/** How many messages one page asks for. */
const messagePageSize = 30;

/** How close in time two messages must be to be drawn as one group. */
const groupingWindowMilliseconds = 5 * 60 * 1000;

type PendingState = 'sending' | 'failed' | 'refused';

interface PendingMessage {
  readonly body: string;
  /** Generated once, reused by every retry. This is what makes retry safe. */
  readonly clientMessageId: string;
  readonly message: string | undefined;
  readonly state: PendingState;
}

/* ---------------------------------------------------------------- the list */

export function ConversationsList({
  selectedId,
}: {
  readonly selectedId?: string;
}) {
  const feeds = useFeeds();
  const conversations = feeds.conversations;
  const rows = [...(conversations.value?.conversations ?? [])].sort(
    (left, right) =>
      Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt),
  );

  if (conversations.loading && conversations.value === undefined) {
    return <RowSkeleton rows={4} />;
  }

  if (conversations.error !== undefined) {
    return (
      <div className="v-stack v-stack--3">
        <ErrorMessage testId="conversations-failed">
          {conversations.error}
        </ErrorMessage>
        {conversations.retryable ? (
          <div>
            <Button onClick={conversations.reload}>Try again</Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        actions={
          <Link className="v-btn v-btn--secondary" href="/introductions">
            See your introductions
          </Link>
        }
        body="A conversation opens from a mutual introduction — once you and somebody else have both said yes."
        icon="message"
        testId="conversations-empty"
        title="No conversations yet"
      />
    );
  }

  return (
    <ul className="v-list v-list--divided" data-testid="conversation-list">
      {rows.map((row) => {
        const unread = row.lastMessageSequence > row.lastReadSequence;
        return (
          <li key={row.id}>
            <ListRow
              aside={
                unread ? (
                  <>
                    {/*
                      A mark, not a number. The contract publishes sequence
                      positions rather than an unread count, and a badge reading
                      "1" would be this surface inventing one.
                    */}
                    <span
                      aria-hidden="true"
                      className="v-dot v-dot--unread"
                      data-testid={`conversation-unread-${row.id}`}
                    />
                    <span className="v-visually-hidden">
                      Has messages you have not read
                    </span>
                  </>
                ) : undefined
              }
              current={row.id === selectedId}
              href={`/messages/${row.id}`}
              testId={`conversation-${row.id}`}
              unread={unread}
            >
              <Avatar
                displayName={row.counterpart.displayName}
                seed={row.counterpart.id}
                size="sm"
              />
              <span className="v-row__body">
                <span className="v-row__title">
                  <span className="v-truncate">
                    {row.counterpart.displayName}
                  </span>
                  <span className="v-row__meta">
                    {formatRelative(row.lastActivityAt)}
                  </span>
                </span>
                <span className="v-row__preview v-truncate">
                  {row.state === 'closed'
                    ? 'This conversation is closed.'
                    : row.lastMessageSequence === 0
                      ? 'No messages yet — say hello.'
                      : unread
                        ? 'New message'
                        : 'Opened from a mutual introduction'}
                </span>
              </span>
            </ListRow>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- the layout */

/**
 * List beside thread on a desktop, one at a time on a phone.
 *
 * Which one a phone shows is decided by the address rather than by a pane
 * toggle, so the browser's own Back leaves the conversation instead of doing
 * nothing — which is what Back does everywhere else and what somebody expects.
 */
export function MessagesLayout({
  children,
  selectedId,
}: {
  readonly children: React.ReactNode;
  readonly selectedId?: string;
}) {
  return (
    <>
      {/*
        The screen title is redundant once a conversation is open on a narrow
        viewport: the shell's header already says Messages and the thread header
        says who it is with. It stays in the document and the stylesheet takes it
        out of the layout, so the wide arrangement — where the list is beside the
        thread and the title labels both — is unaffected.
      */}
      <div
        className={
          selectedId === undefined ? undefined : 'v-messages__title--detail'
        }
      >
        <PageHeader title="Messages" />
      </div>
      <div
        className={`v-split${selectedId === undefined ? '' : ' v-split--detail'}`}
      >
        <section aria-label="Conversations" className="v-split__list">
          <ConversationsList
            {...(selectedId === undefined ? {} : { selectedId })}
          />
        </section>
        <section aria-label="Conversation" className="v-split__detail">
          {children}
        </section>
      </div>
    </>
  );
}

export function NoConversationSelected() {
  return (
    <div className="v-card" data-testid="conversation-none">
      <EmptyState
        body="Choose a conversation to read it."
        icon="message"
        testId="conversation-none-empty"
        title="Nothing open"
      />
    </div>
  );
}

/* -------------------------------------------------------------- the thread */

export function ConversationThread({
  conversationId,
}: {
  readonly conversationId: string;
}) {
  const api = useApi();
  const account = useAccount();
  const feeds = useFeeds();
  const conversations = feeds.conversations.value?.conversations ?? [];
  const conversation = conversations.find((row) => row.id === conversationId);
  const asked = useRef<string | undefined>(undefined);
  const reloadConversations = feeds.conversations.reload;
  const listSettled = feeds.conversations.settled;

  // A conversation opened a moment ago is not in a list fetched before it
  // existed, and neither is one this tab has never seen — a notice followed
  // from another device, say. One re-read decides which it is; without it a
  // real conversation would be reported as unavailable.
  useEffect(() => {
    if (conversation !== undefined) return;
    if (!listSettled) return;
    if (asked.current === conversationId) return;
    asked.current = conversationId;
    reloadConversations();
  }, [conversation, conversationId, listSettled, reloadConversations]);

  const loadingList =
    !listSettled ||
    (conversation === undefined && asked.current !== conversationId) ||
    (feeds.conversations.loading && conversation === undefined);

  if (loadingList) {
    return (
      <div className="v-card" data-testid="thread-loading">
        <RowSkeleton rows={4} />
      </div>
    );
  }

  if (conversation === undefined) {
    return (
      <div className="v-card" data-testid="conversation-missing">
        <EmptyState
          actions={
            <Link className="v-btn v-btn--secondary" href="/messages">
              Back to messages
            </Link>
          }
          body="It may have been closed, or it may never have been yours. Either way there is nothing to show here."
          icon="alert"
          testId="conversation-missing-empty"
          title="That conversation is not available"
        />
      </div>
    );
  }

  return (
    <Thread
      conversation={conversation}
      onChanged={feeds.conversations.reload}
      selfId={account.account.value?.id}
      api={api}
    />
  );
}

function Thread({
  api,
  conversation,
  onChanged,
  selfId,
}: {
  readonly api: ReturnType<typeof useApi>;
  readonly conversation: Conversation;
  readonly onChanged: () => void;
  readonly selfId: string | undefined;
}) {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingMessage | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const inFlight = useRef<AbortController | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
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
          pageSize: messagePageSize,
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
    setDraft('');
    atBottom.current = true;
    void readPage(undefined, true);
    return () => {
      inFlight.current?.abort();
    };
  }, [readPage]);

  // Acknowledging what has been read is monotonic on the server, so repeating it
  // is harmless and an out-of-order client cannot un-read anything.
  useEffect(() => {
    const newest = messages.at(-1);
    if (newest === undefined) return;
    if (newest.sequence <= conversation.lastReadSequence) return;
    void api
      .markConversationRead({ conversationId, sequence: newest.sequence })
      .then(onChanged);
  }, [api, conversation.lastReadSequence, conversationId, messages, onChanged]);

  // Kept at the newest message unless the reader has deliberately scrolled up,
  // in which case loading older messages must not yank them back down.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node === null || !atBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  const ordered = [...messages].sort((left, right) =>
    // Server-assigned position, never a local timestamp. Two clients with
    // different clocks still read the same conversation in the same order.
    left.sequence === right.sequence
      ? left.id.localeCompare(right.id)
      : left.sequence - right.sequence,
  );

  const send = (attempt: PendingMessage) => {
    // A double press must not become two messages. Each attempt carries one
    // client identifier, so a *retry* is safe — but two presses would generate
    // two identifiers, and the server would rightly treat them as two sends.
    sending.run(async () => {
      setPending({ ...attempt, message: undefined, state: 'sending' });
      atBottom.current = true;
      const result: ApiResult<Message> = await api.sendMessage({
        body: attempt.body,
        clientMessageId: attempt.clientMessageId,
        conversationId,
      });
      if (result.kind === 'ok') {
        setPending(undefined);
        setDraft('');
        setMessages((current) => merge(current, [result.value]));
        onChanged();
        composer.current?.focus();
        return;
      }
      setPending({
        ...attempt,
        message: failureMessage(result),
        // A retryable failure is a condition; a refusal is a decision. The
        // difference decides whether "try again" is offered at all, because a
        // safety change that closed this conversation will refuse forever.
        state: isRetryable(result) ? 'failed' : 'refused',
      });
      if (!isRetryable(result)) onChanged();
    });
  };

  const trimmed = draft.trim();
  const overLimit = draft.length > maximumMessageBodyCharacters;
  const canSend =
    trimmed.length > 0 && !overLimit && !closed && pending?.state !== 'sending';

  const submit = () => {
    if (!canSend) return;
    send({
      body: trimmed,
      // Generated here, once. A retry below reuses the same identifier, which
      // is what makes a lost response safe to repeat.
      clientMessageId: crypto.randomUUID(),
      message: undefined,
      state: 'sending',
    });
  };

  return (
    <div className="v-thread" data-testid="conversation-view">
      <header className="v-thread__head">
        <Link
          aria-label="Back to messages"
          className="v-icon-btn v-thread__back"
          href="/messages"
        >
          <Icon name="arrowLeft" size="md" />
        </Link>
        <Avatar
          displayName={conversation.counterpart.displayName}
          seed={conversation.counterpart.id}
          size="sm"
        />
        <div className="v-row__body">
          <p className="v-subheading v-truncate">
            {conversation.counterpart.displayName}
          </p>
          {closed ? <p className="v-caption v-quiet">Closed</p> : null}
        </div>
        <div className="v-inline v-inline--tight v-inline--nowrap">
          <PersonSafetyMenu
            onBlocked={onChanged}
            person={{
              displayName: conversation.counterpart.displayName,
              id: conversation.counterpart.id,
            }}
            size="sm"
          />
        </div>
      </header>

      <div
        className="v-thread__scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          atBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
        ref={scroller}
      >
        {cursor === undefined ? null : (
          <div style={{ textAlign: 'center' }}>
            <Button
              busy={loading}
              data-testid="messages-more"
              onClick={() => {
                atBottom.current = false;
                void readPage(cursor, false);
              }}
              size="sm"
              tone="ghost"
            >
              Load earlier messages
            </Button>
          </div>
        )}

        {loading && ordered.length === 0 ? (
          <StatusMessage testId="messages-loading">
            Loading messages…
          </StatusMessage>
        ) : null}

        {error === undefined ? null : (
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="messages-failed">{error}</ErrorMessage>
            <div>
              <Button
                onClick={() => {
                  void readPage(undefined, true);
                }}
                size="sm"
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {!loading && error === undefined && ordered.length === 0 ? (
          <EmptyState
            body={`You and ${conversation.counterpart.displayName} both said yes. Somebody has to go first.`}
            icon="sparkle"
            testId="messages-empty"
            title="No messages yet"
          />
        ) : null}

        <MessageStream messages={ordered} selfId={selfId} />

        {pending === undefined ? null : (
          <div
            className={`v-message v-message--mine${
              pending.state === 'sending' ? ' v-message--sending' : ''
            }`}
            data-testid="message-pending"
          >
            <div className="v-message__bubble">
              <p className="v-wrap">{pending.body}</p>
            </div>
            <div className="v-message__meta">
              {pending.state === 'sending' ? (
                <span data-testid="message-sending">Sending…</span>
              ) : (
                <span data-testid="message-send-failed">{pending.message}</span>
              )}
            </div>
            {pending.state === 'sending' ? null : (
              <div
                className="v-inline v-inline--tight"
                style={{ justifyContent: 'flex-end' }}
              >
                {pending.state === 'failed' ? (
                  <Button
                    data-testid="message-retry"
                    onClick={() => {
                      send(pending);
                    }}
                    size="sm"
                  >
                    Try again
                  </Button>
                ) : (
                  <Button
                    data-testid="message-discard"
                    onClick={() => {
                      setPending(undefined);
                    }}
                    size="sm"
                    tone="ghost"
                  >
                    Dismiss
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {closed ? (
        <div style={{ padding: 'var(--space-4)' }}>
          <Notice testId="conversation-closed" tone="quiet">
            This conversation is closed. You can still read it, and nothing new
            can be sent either way.
          </Notice>
        </div>
      ) : (
        <form
          className="v-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="v-composer__row">
            <label className="v-visually-hidden" htmlFor="message-body">
              Message {conversation.counterpart.displayName}
            </label>
            <textarea
              className="v-composer__input"
              data-testid="message-body"
              disabled={pending?.state === 'sending'}
              id="message-body"
              name="body"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line. On a touch keyboard
                // Enter is the return key and there is a send button beside it,
                // so nothing is unreachable either way.
                if (event.key !== 'Enter' || event.shiftKey) return;
                event.preventDefault();
                submit();
              }}
              placeholder="Write a message"
              ref={composer}
              rows={1}
              value={draft}
            />
            <Button
              busy={pending?.state === 'sending'}
              data-testid="message-send"
              disabled={!canSend}
              icon="send"
              onClick={submit}
              tone="primary"
            >
              <span className="v-visually-hidden">Send</span>
            </Button>
          </div>
          <div className="v-composer__foot">
            <span>Not end-to-end encrypted.</span>
            {draft.length > maximumMessageBodyCharacters * 0.8 ? (
              <span
                className={`v-composer__count${
                  overLimit
                    ? ' v-composer__count--over'
                    : ' v-composer__count--near'
                }`}
                data-testid="message-count"
              >
                {draft.length}/{maximumMessageBodyCharacters}
              </span>
            ) : null}
          </div>
          {overLimit ? (
            <ErrorMessage testId="message-too-long">
              That is longer than a message can be. Trim it and send again.
            </ErrorMessage>
          ) : null}
        </form>
      )}
    </div>
  );
}

/** Renders the transcript with day separators and sender grouping. */
function MessageStream({
  messages,
  selfId,
}: {
  readonly messages: readonly Message[];
  readonly selfId: string | undefined;
}) {
  let lastDay: string | undefined;
  return (
    <ol className="v-stack v-stack--3" data-testid="messages">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const day = formatDay(message.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        const mine = selfId !== undefined && message.senderId === selfId;
        const grouped =
          previous?.senderId === message.senderId &&
          !showDay &&
          Date.parse(message.createdAt) - Date.parse(previous.createdAt) <
            groupingWindowMilliseconds;

        return (
          <li key={message.id}>
            {showDay ? <p className="v-thread__day v-caption">{day}</p> : null}
            <div
              className={`v-message ${mine ? 'v-message--mine' : 'v-message--theirs'}${
                grouped ? ' v-message--grouped' : ''
              }`}
              data-sequence={message.sequence}
            >
              <div className="v-message__bubble">
                <p className="v-wrap">{message.body}</p>
              </div>
              {grouped ? null : (
                <p className="v-message__meta">
                  <time dateTime={message.createdAt}>
                    {formatTime(message.createdAt)}
                  </time>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Adds messages without ever showing one twice.
 *
 * Paging, revalidation, and a send that succeeded can all deliver the same
 * message, and the identifier is what makes the duplicate detectable. A newer
 * copy replaces an older one because the server's answer is always the current
 * truth about a message.
 */
function merge(
  current: readonly Message[],
  incoming: readonly Message[],
): readonly Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()];
}
