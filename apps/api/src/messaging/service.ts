import { defaultPageSize } from '@velora/validation';

import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import {
  conversationSubjectType,
  messageSentEventName,
  messageSentEventVersion,
} from './events.js';
import type { ConsumerDirectory } from '../users/directory.js';
import type { OnboardingService } from '../users/onboarding.js';
import type { UserAccountRow } from '../users/repository.js';
import {
  decodeConversationCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageCursor,
} from './cursor.js';
import {
  maximumConversationPageSize,
  maximumMessagePageSize,
} from './policy.js';
import type {
  ConversationMembership,
  ConversationRow,
  MessageRow,
  MessagingRepository,
} from './repository.js';
import type { SafetyEligibilityPort } from './safety.js';

export interface ConversationCounterpart {
  readonly displayName: string;
  readonly id: string;
  readonly media: readonly { readonly id: string; readonly position: number }[];
}

export interface ConversationView {
  readonly counterpart: ConversationCounterpart;
  readonly createdAt: Date;
  readonly id: string;
  readonly lastActivityAt: Date;
  readonly lastMessage:
    | {
        readonly bodyPreview: string;
        readonly createdAt: Date;
        readonly sender: 'caller' | 'counterpart';
        readonly sequence: number;
      }
    | undefined;
  readonly lastMessageSequence: number;
  readonly lastReadSequence: number;
  readonly relationship: {
    readonly introductionId: string;
    readonly kind: 'mutual_introduction';
  };
  readonly state: 'active' | 'closed';
}

export interface MessageView {
  readonly body: string;
  readonly clientMessageId: string;
  readonly conversationId: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly senderId: string;
  readonly sequence: number;
}

export type ConversationOutcome =
  | { readonly kind: 'conversation'; readonly view: ConversationView }
  /** The caller's own account does not currently permit messaging. */
  | { readonly kind: 'not_eligible' }
  /** Deliberately indistinguishable from a conversation that does not exist. */
  | { readonly kind: 'not_found' }
  /** The pair may not communicate: closed conversation or safety refusal. */
  | { readonly kind: 'not_permitted' };

export type ConversationListOutcome =
  | {
      readonly kind: 'page';
      readonly conversations: readonly ConversationView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'invalid_cursor' };

export type MessageListOutcome =
  | {
      readonly kind: 'page';
      readonly conversationId: string;
      readonly messages: readonly MessageView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' }
  | { readonly kind: 'invalid_cursor' };

export type SendOutcome =
  | { readonly kind: 'message'; readonly view: MessageView }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' }
  /** The same client message identifier already carried a different body. */
  | { readonly kind: 'idempotency_mismatch' };

export type ReadOutcome =
  | {
      readonly kind: 'read';
      readonly conversationId: string;
      readonly lastReadSequence: number;
    }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' };

export interface MessagingServiceDependencies {
  readonly connections: ConnectionDirectoryPort;
  readonly directory: ConsumerDirectory;
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  /**
   * MESSAGING's own transactional outbox. A published fact is written by the
   * same transaction that writes the message, so a process killed immediately
   * after a send cannot leave a message nobody is ever told about.
   */
  readonly outbox: OutboxAppendPort;
  readonly repository: MessagingRepository;
  readonly safety: SafetyEligibilityPort;
}

/**
 * Conversations and messages.
 *
 * Three rules shape everything here.
 *
 * A conversation exists only because two people mutually introduced themselves,
 * and MESSAGING never decides that: it asks DISCOVERY's published connection
 * contract. There is no other route into messaging a stranger, and no request
 * body can assert one.
 *
 * Authorization is taken at the moment of the action and never from the page a
 * client is holding. Membership, conversation state, current safety
 * eligibility, and the connection itself are all re-read when somebody sends —
 * inside the transaction that writes, so a block landing mid-request either
 * precedes the message or follows it, and never straddles it.
 *
 * Message ordering is a server fact. The position comes from the conversation's
 * own allocator under a row lock, so no client clock, no arrival order at a
 * load balancer, and no retry can influence what order two people's messages
 * are in.
 *
 * Message bodies are stored in a form the server can read. Messaging is not
 * end-to-end encrypted; see `docs/domains/messaging.md`. Bodies are never
 * written to a log, and never appear in an error.
 */
export class MessagingService {
  constructor(private readonly dependencies: MessagingServiceDependencies) {}

  /**
   * Opens the conversation a mutual introduction authorizes, or returns the one
   * that already exists.
   *
   * Idempotent by construction rather than by a client key: the unique index
   * over the pair decides, so two simultaneous opens produce one conversation
   * and the loser reads the winner's.
   */
  async openConversation(
    actor: UserAccountRow,
    introductionId: string,
  ): Promise<ConversationOutcome> {
    if (!(await this.mayMessage(actor))) return { kind: 'not_eligible' };

    const connection = await this.dependencies.connections.mutualConnectionFor({
      actorId: actor.id,
      introductionId,
    });
    // A pending, expired, closed, or someone else's introduction answers
    // exactly as one that does not exist, so probing discloses nothing.
    if (connection === undefined) return { kind: 'not_found' };

    const now = this.dependencies.now();
    // The pair lock, the safety answer, and the insert are one transaction, so
    // a block committing concurrently either precedes this conversation or
    // waits for it. Reading safety on a separate handle would leave exactly the
    // window this design exists to remove.
    const conversation = await this.dependencies.repository.transaction(
      async (executor): Promise<ConversationRow | 'denied' | undefined> => {
        await lockPair(executor, actor.id, connection.counterpartId);
        if (
          !(await this.dependencies.safety.mayInteract({
            executor,
            first: actor.id,
            now,
            second: connection.counterpartId,
          }))
        ) {
          return 'denied';
        }
        const created = await this.dependencies.repository.insertConversation(
          executor,
          {
            first: actor.id,
            now,
            originIntroductionId: connection.introductionId,
            second: connection.counterpartId,
          },
        );
        return (
          created ??
          (await this.dependencies.repository.findPair(executor, {
            first: actor.id,
            second: connection.counterpartId,
          }))
        );
      },
    );
    if (conversation === 'denied') return { kind: 'not_permitted' };
    if (conversation === undefined) return { kind: 'not_found' };
    if (conversation.state !== 'active') return { kind: 'not_permitted' };

    const membership = await this.dependencies.repository.findMembership(
      this.dependencies.repository.transactionless,
      { conversationId: conversation.id, userId: actor.id },
    );
    if (membership === undefined) return { kind: 'not_found' };
    const views = await this.viewsOf(actor, [membership]);
    const view = views[0];
    return view === undefined
      ? { kind: 'not_found' }
      : { kind: 'conversation', view };
  }

  async listConversations(
    actor: UserAccountRow,
    input: { readonly cursor: string | undefined; readonly pageSize: number },
  ): Promise<ConversationListOutcome> {
    if (!(await this.mayMessage(actor))) return { kind: 'not_eligible' };
    const decoded =
      input.cursor === undefined
        ? undefined
        : decodeConversationCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }

    const pageSize = boundedPageSize(
      input.pageSize,
      maximumConversationPageSize,
    );
    const now = this.dependencies.now();
    const rows = await this.dependencies.repository.listConversations(
      this.dependencies.repository.transactionless,
      {
        before: decoded,
        limit: pageSize + 1,
        userId: actor.id,
      },
    );

    // Safety is applied to the list rather than only to sends. Until the
    // post-block history decision exists, the fail-closed reading is that a pair
    // that may not communicate does not see each other's conversation; nothing
    // is deleted, so the other reading stays available once it is decided.
    const permitted = await this.filterPermitted(actor, rows, now);
    const page = permitted.slice(0, pageSize);
    const last = page.at(-1);
    return {
      conversations: await this.viewsOf(actor, page),
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeConversationCursor({
              id: last.conversation.id,
              lastActivityAt: last.conversation.lastActivityAt,
            })
          : undefined,
    };
  }

  async listMessages(
    actor: UserAccountRow,
    input: {
      readonly conversationId: string;
      readonly cursor: string | undefined;
      readonly pageSize: number;
    },
  ): Promise<MessageListOutcome> {
    if (!(await this.mayMessage(actor))) return { kind: 'not_eligible' };
    const decoded =
      input.cursor === undefined
        ? undefined
        : decodeMessageCursor(input.cursor, input.conversationId);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }

    const membership = await this.dependencies.repository.findMembership(
      this.dependencies.repository.transactionless,
      { conversationId: input.conversationId, userId: actor.id },
    );
    if (membership === undefined) return { kind: 'not_found' };

    const now = this.dependencies.now();
    if (
      !(await this.dependencies.safety.mayInteract({
        executor: this.dependencies.repository.transactionless,
        first: actor.id,
        now,
        second: counterpartOf(membership.conversation, actor.id),
      }))
    ) {
      return { kind: 'not_permitted' };
    }

    const pageSize = boundedPageSize(input.pageSize, maximumMessagePageSize);
    const rows = await this.dependencies.repository.listMessages(
      this.dependencies.repository.transactionless,
      {
        before: decoded?.before,
        conversationId: input.conversationId,
        limit: pageSize + 1,
      },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      conversationId: input.conversationId,
      kind: 'page',
      messages: page.map(messageView),
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeMessageCursor({
              before: last.sequence,
              conversationId: input.conversationId,
            })
          : undefined,
    };
  }

  /**
   * Persists one message.
   *
   * Everything that decides whether the message may exist is re-read inside the
   * transaction that writes it, after the conversation's row lock is held. That
   * ordering is the whole point: it is what makes "recheck before durable
   * acceptance" true rather than approximately true, and it is what makes a
   * duplicate send wait long enough to see the original instead of racing it.
   */
  async sendMessage(
    actor: UserAccountRow,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly conversationId: string;
    },
  ): Promise<SendOutcome> {
    if (!(await this.mayMessage(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    // Who the counterpart is has to be known before the pair lock can be taken,
    // and the pair lock has to be taken before any row lock. This read is a
    // hint only: membership, state, safety, and the connection are all re-read
    // inside the transaction, so a stale hint costs a wasted lock and never a
    // wrong decision.
    const hint = await this.dependencies.repository.findMembership(
      this.dependencies.repository.transactionless,
      { conversationId: input.conversationId, userId: actor.id },
    );
    if (hint === undefined) return { kind: 'not_found' };
    const hintedCounterpartId = counterpartOf(hint.conversation, actor.id);

    return this.dependencies.repository.transaction(
      async (executor): Promise<SendOutcome> => {
        // Ordering rule: pair lock, then row lock. Every transaction that takes
        // both takes them in this order, so the lock graph has no cycle and no
        // two transactions can wait on each other.
        await lockPair(executor, actor.id, hintedCounterpartId);
        const conversation =
          await this.dependencies.repository.lockConversation(
            executor,
            input.conversationId,
          );
        if (conversation === undefined) return { kind: 'not_found' };

        const membership = await this.dependencies.repository.findMembership(
          executor,
          { conversationId: conversation.id, userId: actor.id },
        );
        if (membership === undefined) return { kind: 'not_found' };
        if (conversation.state !== 'active') return { kind: 'not_permitted' };

        const counterpartId = counterpartOf(conversation, actor.id);
        // Sequential. Both run on the transaction's single connection, and two
        // statements issued concurrently onto one connection is a protocol
        // question nobody should have to think about inside a safety check.
        const permitted = await this.dependencies.safety.mayInteract({
          executor,
          first: actor.id,
          now,
          second: counterpartId,
        });
        const connected =
          await this.dependencies.connections.isMutuallyIntroduced({
            executor,
            first: actor.id,
            second: counterpartId,
          });
        if (!permitted || !connected) return { kind: 'not_permitted' };

        const existing =
          await this.dependencies.repository.findMessageByClientId(executor, {
            clientMessageId: input.clientMessageId,
            conversationId: conversation.id,
            senderId: actor.id,
          });
        if (existing !== undefined) {
          // A retry is answered with the original. A different body under the
          // same key is not a retry, and answering it with somebody's earlier
          // message would be worse than refusing.
          return existing.body === input.body
            ? { kind: 'message', view: messageView(existing) }
            : { kind: 'idempotency_mismatch' };
        }

        const message = await this.persist(executor, {
          body: input.body,
          clientMessageId: input.clientMessageId,
          conversationId: conversation.id,
          now,
          senderId: actor.id,
        });
        // Same transaction as the message, deliberately. A queue enqueue placed
        // after this commit would be lost by a process that died in between,
        // and the recipient would never learn about a message that exists. The
        // fact is therefore a row: either both are committed or neither is.
        //
        // The payload carries no body and no name. What may be shown to the
        // recipient is NOTIFICATIONS' decision, and a field that never leaves
        // this domain cannot end up on somebody's lock screen.
        await this.dependencies.outbox.append(executor, {
          eventName: messageSentEventName,
          eventVersion: messageSentEventVersion,
          now,
          occurredAt: message.createdAt,
          payload: {
            conversationId: conversation.id,
            messageId: message.id,
            recipientId: counterpartId,
            senderId: actor.id,
            sequence: message.sequence,
          },
          subjectId: conversation.id,
          subjectType: conversationSubjectType,
        });
        return { kind: 'message', view: messageView(message) };
      },
    );
  }

  /** Advances the caller's read position. Never retreats it. */
  async markRead(
    actor: UserAccountRow,
    input: { readonly conversationId: string; readonly sequence: number },
  ): Promise<ReadOutcome> {
    if (!(await this.mayMessage(actor))) return { kind: 'not_eligible' };
    const membership = await this.dependencies.repository.findMembership(
      this.dependencies.repository.transactionless,
      { conversationId: input.conversationId, userId: actor.id },
    );
    if (membership === undefined) return { kind: 'not_found' };

    const now = this.dependencies.now();
    if (
      !(await this.dependencies.safety.mayInteract({
        executor: this.dependencies.repository.transactionless,
        first: actor.id,
        now,
        second: counterpartOf(membership.conversation, actor.id),
      }))
    ) {
      return { kind: 'not_permitted' };
    }

    // Acknowledging beyond what exists would let a client mark itself current
    // with messages it has never been sent.
    const sequence = Math.min(
      input.sequence,
      membership.conversation.messageSequence,
    );
    return {
      conversationId: input.conversationId,
      kind: 'read',
      lastReadSequence: await this.dependencies.repository.advanceReadPosition(
        this.dependencies.repository.transactionless,
        {
          conversationId: input.conversationId,
          now,
          sequence,
          userId: actor.id,
        },
      ),
    };
  }

  private async persist(
    executor: TransactionHandle,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly conversationId: string;
      readonly now: Date;
      readonly senderId: string;
    },
  ): Promise<MessageRow> {
    const sequence = await this.dependencies.repository.allocateSequence(
      executor,
      { conversationId: input.conversationId, now: input.now },
    );
    return this.dependencies.repository.insertMessage(executor, {
      ...input,
      sequence,
    });
  }

  /**
   * Messaging requires the same standing admission requires.
   *
   * An account that is suspended, that never completed admission, or whose
   * adult assurance has lapsed does not keep talking to people on an
   * adults-only platform because it was introduced to them earlier.
   */
  private async mayMessage(actor: UserAccountRow): Promise<boolean> {
    if (actor.status !== 'active') return false;
    const eligibility = await this.dependencies.onboarding.evaluate(actor);
    return eligibility.step === 'completed';
  }

  private async filterPermitted(
    actor: UserAccountRow,
    rows: readonly ConversationMembership[],
    now: Date,
  ): Promise<readonly ConversationMembership[]> {
    // One at a time. Asking concurrently would take one pooled connection per
    // row — a page of fifty conversations would ask for fifty at once — and a
    // request that holds several connections while waiting for more is how a
    // pool deadlocks. A request holds at most one at a time.
    const permitted: ConversationMembership[] = [];
    for (const row of rows) {
      const allowed = await this.dependencies.safety.mayInteract({
        executor: this.dependencies.repository.transactionless,
        first: actor.id,
        now,
        second: counterpartOf(row.conversation, actor.id),
      });
      if (allowed) permitted.push(row);
    }
    return permitted;
  }

  /**
   * Counterpart profiles come from USERS' published directory, never from a
   * copy this domain keeps. A conversation needs a name and a picture; it does
   * not need, and is not given, anything that describes why the two people were
   * introduced.
   */
  private async viewsOf(
    actor: UserAccountRow,
    rows: readonly ConversationMembership[],
  ): Promise<readonly ConversationView[]> {
    if (rows.length === 0) return [];
    const counterpartIds = rows.map((row) =>
      counterpartOf(row.conversation, actor.id),
    );
    // Sequential, so one in-flight request never holds two pooled connections.
    const names = await this.dependencies.directory.namesFor(counterpartIds);
    const media = await this.dependencies.directory.mediaFor(counterpartIds);
    const byId = new Map(names.map((name) => [name.id, name]));
    const mediaById = new Map<
      string,
      { readonly id: string; readonly position: number }[]
    >();
    for (const item of media) {
      const existing = mediaById.get(item.userId) ?? [];
      existing.push({ id: item.id, position: item.position });
      mediaById.set(item.userId, existing);
    }

    return rows.flatMap((row) => {
      const counterpartId = counterpartOf(row.conversation, actor.id);
      const counterpart = byId.get(counterpartId);
      if (counterpart === undefined) return [];
      return [
        {
          counterpart: {
            displayName: counterpart.displayName,
            id: counterpart.id,
            media: mediaById.get(counterpartId) ?? [],
          },
          createdAt: row.conversation.createdAt,
          id: row.conversation.id,
          lastActivityAt: row.conversation.lastActivityAt,
          lastMessage:
            row.latestMessage === null
              ? undefined
              : {
                  bodyPreview: messagePreview(row.latestMessage.body),
                  createdAt: row.latestMessage.createdAt,
                  sender:
                    row.latestMessage.senderId === actor.id
                      ? 'caller'
                      : 'counterpart',
                  sequence: row.latestMessage.sequence,
                },
          lastMessageSequence: row.conversation.messageSequence,
          lastReadSequence: row.participant.lastReadSequence,
          relationship: {
            introductionId: row.conversation.originIntroductionId,
            kind: 'mutual_introduction',
          },
          state: row.conversation.state,
        },
      ];
    });
  }
}

/** A compact, single-line projection; never a draft or a delivery assertion. */
function messagePreview(body: string): string {
  const normalized = body.replace(/\s+/gu, ' ').trim();
  const candidate = normalized.slice(0, 160);
  // Never publish half of a UTF-16 surrogate pair at the boundary.
  return /[\uD800-\uDBFF]$/u.test(candidate)
    ? candidate.slice(0, -1)
    : candidate;
}

function counterpartOf(conversation: ConversationRow, actorId: string): string {
  return conversation.pairLowId === actorId
    ? conversation.pairHighId
    : conversation.pairLowId;
}

function messageView(row: MessageRow): MessageView {
  return {
    body: row.body,
    clientMessageId: row.clientMessageId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    id: row.id,
    senderId: row.senderId,
    sequence: row.sequence,
  };
}

function boundedPageSize(requested: number, ceiling: number): number {
  return Math.max(1, Math.min(requested, ceiling, defaultPageSize * 2));
}
