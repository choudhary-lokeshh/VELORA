'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ApiResult,
  ConsumerApi,
  Conversation,
  Message,
} from '@velora/consumer-client';
import { failureMessage, isRetryable } from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';
import {
  EmptyState,
  ErrorMessage,
  MoreButton,
  ResourceState,
  Section,
  StatusMessage,
} from './ui';

/**
 * Conversations and the messages in them.
 *
 * **Messages are not end-to-end encrypted, and nothing on this surface says
 * they are.** The server can read message bodies, because moderation,
 * reporting, and lawful safety review require it (`packages/validation` states
 * this in the contract itself).
 *
 * Three rules govern what happens here. Order is the server's: messages are
 * placed by the sequence it assigned, never by a clock this browser owns, so
 * two devices with different clocks still read the same conversation the same
 * way. Retry is safe: every send carries a client message identifier that is
 * generated once and reused for every attempt, so a response lost after the
 * server committed produces no second message. And nothing is optimistic about
 * permission: a message appears in the transcript when the server says it
 * exists.
 */

/** How many messages one page asks for. */
const messagePageSize = 30;

type PendingState = 'sending' | 'failed' | 'refused';

interface PendingMessage {
  readonly body: string;
  /** Generated once, reused by every retry. This is what makes retry safe. */
  readonly clientMessageId: string;
  readonly message: string | undefined;
  readonly state: PendingState;
}

export function ConversationsPanel({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.conversations({}, signal),
    [api],
  );
  const conversations = useResource(load);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  useRevalidateOnFocus(conversations.reload);

  const rows = conversations.value?.conversations ?? [];
  const open = rows.find((row) => row.id === openId);

  return (
    <Section headingId="conversations-heading" title="Conversations">
      <ResourceState resource={conversations} testId="conversations" />
      {!conversations.loading &&
      conversations.error === undefined &&
      rows.length === 0 ? (
        <EmptyState testId="conversations-empty">
          No conversations yet. They open from a mutual introduction.
        </EmptyState>
      ) : null}

      <ul data-testid="conversation-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              aria-current={row.id === openId ? 'true' : undefined}
              data-testid={`conversation-${row.id}`}
              onClick={() => {
                setOpenId(row.id);
              }}
              type="button"
            >
              {row.counterpart.displayName}
              {row.lastMessageSequence > row.lastReadSequence
                ? ' (unread)'
                : ''}
              {row.state === 'closed' ? ' (closed)' : ''}
            </button>
          </li>
        ))}
      </ul>

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
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingMessage | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const inFlight = useRef<AbortController | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sending = useSingleFlight();

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
      setExhausted(result.value.nextCursor === undefined);
      setMessages((current) =>
        merge(replace ? [] : current, result.value.messages),
      );
    },
    [api, conversationId],
  );

  useEffect(() => {
    setMessages([]);
    setCursor(undefined);
    setExhausted(false);
    setPending(undefined);
    void readPage(undefined, true);
    return () => {
      inFlight.current?.abort();
    };
  }, [readPage]);

  // Acknowledging what has been read is monotonic on the server, so repeating
  // it is harmless and an out-of-order client cannot un-read anything.
  useEffect(() => {
    const newest = messages.at(-1);
    if (newest === undefined) return;
    if (newest.sequence <= conversation.lastReadSequence) return;
    void api
      .markConversationRead({ conversationId, sequence: newest.sequence })
      .then(onChanged);
  }, [api, conversation.lastReadSequence, conversationId, messages, onChanged]);

  const send = (attempt: PendingMessage) => {
    // A double-click must not become two messages. Each attempt carries one
    // client identifier, so a *retry* is safe — but two clicks would generate
    // two identifiers, and the server would rightly treat them as two sends.
    sending.run(async () => {
      setPending({ ...attempt, message: undefined, state: 'sending' });
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

  const ordered = [...messages].sort((left, right) =>
    // Server-assigned position, never a local timestamp. Two clients with
    // different clocks still read the same conversation in the same order.
    left.sequence === right.sequence
      ? left.id.localeCompare(right.id)
      : left.sequence - right.sequence,
  );

  return (
    <div data-testid="conversation-view">
      <h3>{conversation.counterpart.displayName}</h3>
      {conversation.state === 'closed' ? (
        <StatusMessage testId="conversation-closed">
          This conversation is closed. You can still read it.
        </StatusMessage>
      ) : null}
      {loading && messages.length === 0 ? (
        <StatusMessage testId="messages-loading">
          Loading messages…
        </StatusMessage>
      ) : null}
      {error === undefined ? null : (
        <div>
          <ErrorMessage testId="messages-failed">{error}</ErrorMessage>
          <button
            onClick={() => {
              void readPage(undefined, true);
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      <ol data-testid="messages">
        {ordered.map((message) => (
          <li data-sequence={message.sequence} key={message.id}>
            <p>{message.body}</p>
            <p className="hint">
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </p>
          </li>
        ))}
      </ol>

      {exhausted || cursor === undefined ? null : (
        <MoreButton
          busy={loading}
          label="Load earlier messages"
          onClick={() => {
            void readPage(cursor, false);
          }}
          testId="messages-more"
        />
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (body.length === 0) return;
          send({
            body,
            // Generated here, once. A retry below reuses the same identifier,
            // which is what makes a lost response safe to repeat.
            clientMessageId: crypto.randomUUID(),
            message: undefined,
            state: 'sending',
          });
        }}
      >
        <label htmlFor="message-body">Message</label>
        <textarea
          disabled={
            pending?.state === 'sending' || conversation.state === 'closed'
          }
          id="message-body"
          maxLength={4000}
          name="body"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          ref={composer}
          rows={2}
          value={draft}
        />
        <button
          data-testid="message-send"
          disabled={
            pending?.state === 'sending' ||
            draft.trim().length === 0 ||
            conversation.state === 'closed'
          }
          type="submit"
        >
          Send
        </button>
      </form>

      {pending === undefined ? null : (
        <div data-testid="message-pending">
          {pending.state === 'sending' ? (
            <StatusMessage testId="message-sending">Sending…</StatusMessage>
          ) : (
            <>
              <ErrorMessage testId="message-send-failed">
                {pending.message}
              </ErrorMessage>
              {pending.state === 'failed' ? (
                <button
                  data-testid="message-retry"
                  onClick={() => {
                    send(pending);
                  }}
                  type="button"
                >
                  Try again
                </button>
              ) : (
                <button
                  data-testid="message-discard"
                  onClick={() => {
                    setPending(undefined);
                  }}
                  type="button"
                >
                  Dismiss
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
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
