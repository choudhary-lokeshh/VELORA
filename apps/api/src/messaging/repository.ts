import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import {
  messagingConversations,
  messagingMessages,
  messagingParticipants,
} from './schema.js';

export type ConversationRow = typeof messagingConversations.$inferSelect;
export type ParticipantRow = typeof messagingParticipants.$inferSelect;
export type MessageRow = typeof messagingMessages.$inferSelect;

/** A conversation together with the calling participant's own state in it. */
export interface ConversationMembership {
  readonly conversation: ConversationRow;
  /** The message at `messageSequence`, or null before the first send. */
  readonly latestMessage: MessageRow | null;
  readonly participant: ParticipantRow;
}

/**
 * An unordered pair stored in a fixed order, the same convention DISCOVERY
 * uses. The same two people must be the same conversation whichever of them
 * opens it.
 */
export function orderedPair(
  first: string,
  second: string,
): { readonly high: string; readonly low: string } {
  return first < second
    ? { high: second, low: first }
    : { high: first, low: second };
}

/**
 * Every MESSAGING read and write.
 *
 * Nothing here touches another domain's tables. Whether two people are
 * introduced comes from DISCOVERY's published connection contract and whether
 * they may still communicate comes from the safety port; this class only knows
 * about `messaging_`.
 */
export class MessagingRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Creates the conversation for a pair, or reports that one already exists.
   *
   * The unique index over the pair decides, not a prior read, so two
   * simultaneous first opens cannot both create one.
   */
  async insertConversation(
    executor: Executor,
    input: {
      readonly first: string;
      readonly now: Date;
      readonly originIntroductionId: string;
      readonly second: string;
    },
  ): Promise<ConversationRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const inserted = await executor
      .insert(messagingConversations)
      .values({
        createdAt: input.now,
        id: crypto.randomUUID(),
        lastActivityAt: input.now,
        originIntroductionId: input.originIntroductionId,
        pairHighId: pair.high,
        pairLowId: pair.low,
        state: 'active',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    const conversation = inserted[0];
    if (conversation === undefined) return undefined;
    await executor.insert(messagingParticipants).values([
      {
        conversationId: conversation.id,
        joinedAt: input.now,
        userId: pair.low,
      },
      {
        conversationId: conversation.id,
        joinedAt: input.now,
        userId: pair.high,
      },
    ]);
    return conversation;
  }

  async findPair(
    executor: Executor,
    input: { readonly first: string; readonly second: string },
  ): Promise<ConversationRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select()
      .from(messagingConversations)
      .where(
        and(
          eq(messagingConversations.pairLowId, pair.low),
          eq(messagingConversations.pairHighId, pair.high),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The conversation and the caller's membership in it, in one statement.
   *
   * Membership is part of the predicate rather than a check performed after the
   * read, so a conversation the caller is not in is simply not found and cannot
   * leak through a code path that forgot to compare.
   */
  async findMembership(
    executor: Executor,
    input: { readonly conversationId: string; readonly userId: string },
  ): Promise<ConversationMembership | undefined> {
    const rows = await executor
      .select({
        conversation: messagingConversations,
        latestMessage: messagingMessages,
        participant: messagingParticipants,
      })
      .from(messagingParticipants)
      .innerJoin(
        messagingConversations,
        eq(messagingConversations.id, messagingParticipants.conversationId),
      )
      .leftJoin(
        messagingMessages,
        and(
          eq(messagingMessages.conversationId, messagingConversations.id),
          eq(
            messagingMessages.sequence,
            messagingConversations.messageSequence,
          ),
        ),
      )
      .where(
        and(
          eq(messagingParticipants.conversationId, input.conversationId),
          eq(messagingParticipants.userId, input.userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Takes the conversation's row lock.
   *
   * Sending serializes on this. Two people sending at the same instant then
   * receive distinct adjacent positions from one allocator, rather than two
   * writers racing to compute the same "next" value; and a duplicate send waits
   * here, so once it proceeds it can see the winner it would otherwise have
   * raced.
   */
  async lockConversation(
    executor: TransactionHandle,
    conversationId: string,
  ): Promise<ConversationRow | undefined> {
    const rows = await executor
      .select()
      .from(messagingConversations)
      .where(eq(messagingConversations.id, conversationId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async findMessageByClientId(
    executor: Executor,
    input: {
      readonly clientMessageId: string;
      readonly conversationId: string;
      readonly senderId: string;
    },
  ): Promise<MessageRow | undefined> {
    const rows = await executor
      .select()
      .from(messagingMessages)
      .where(
        and(
          eq(messagingMessages.conversationId, input.conversationId),
          eq(messagingMessages.senderId, input.senderId),
          eq(messagingMessages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Consumes the next ordering position and records the activity in the same
   * statement, so a conversation's list position and its newest message can
   * never disagree.
   */
  async allocateSequence(
    executor: TransactionHandle,
    input: { readonly conversationId: string; readonly now: Date },
  ): Promise<number> {
    const rows = await executor
      .update(messagingConversations)
      .set({
        lastActivityAt: input.now,
        messageSequence: sql`${messagingConversations.messageSequence} + 1`,
        updatedAt: input.now,
      })
      .where(eq(messagingConversations.id, input.conversationId))
      .returning({ sequence: messagingConversations.messageSequence });
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Conversation vanished while allocating a sequence');
    }
    return row.sequence;
  }

  /**
   * How many messages this account has sent since the given instant, across
   * every conversation.
   *
   * Across conversations rather than within one: a per-conversation bound is
   * evaded by opening more of them, and somebody being written to at machine
   * speed does not care which conversation it arrived in. The sender index
   * makes this an index range rather than a scan.
   */
  async countMessagesSince(
    executor: Executor,
    input: { readonly senderId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ count: sql<string>`count(*)::text` })
      .from(messagingMessages)
      .where(
        and(
          eq(messagingMessages.senderId, input.senderId),
          gte(messagingMessages.createdAt, input.since),
        ),
      );
    return Number(rows.at(0)?.count ?? '0');
  }

  async insertMessage(
    executor: TransactionHandle,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly conversationId: string;
      readonly now: Date;
      readonly senderId: string;
      readonly sequence: number;
    },
  ): Promise<MessageRow> {
    const rows = await executor
      .insert(messagingMessages)
      .values({
        body: input.body,
        clientMessageId: input.clientMessageId,
        conversationId: input.conversationId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        senderId: input.senderId,
        sequence: input.sequence,
        updatedAt: input.now,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('Message insert returned no row');
    return row;
  }

  /**
   * One page of a conversation's history, newest first.
   *
   * Keyset on the sequence, which is immutable and unique within the
   * conversation, so a page boundary is exact regardless of what arrives while
   * a reader is scrolling.
   */
  async listMessages(
    executor: Executor,
    input: {
      readonly before: number | undefined;
      readonly conversationId: string;
      readonly limit: number;
    },
  ): Promise<MessageRow[]> {
    return executor
      .select()
      .from(messagingMessages)
      .where(
        and(
          eq(messagingMessages.conversationId, input.conversationId),
          input.before === undefined
            ? undefined
            : lt(messagingMessages.sequence, input.before),
        ),
      )
      .orderBy(desc(messagingMessages.sequence))
      .limit(input.limit);
  }

  /** The caller's conversations, most recently active first. */
  async listConversations(
    executor: Executor,
    input: {
      readonly before:
        { readonly id: string; readonly lastActivityAt: Date } | undefined;
      readonly limit: number;
      readonly userId: string;
    },
  ): Promise<ConversationMembership[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(
              messagingConversations.lastActivityAt,
              input.before.lastActivityAt,
            ),
            and(
              eq(
                messagingConversations.lastActivityAt,
                input.before.lastActivityAt,
              ),
              lt(messagingConversations.id, input.before.id),
            ),
          );
    return executor
      .select({
        conversation: messagingConversations,
        latestMessage: messagingMessages,
        participant: messagingParticipants,
      })
      .from(messagingParticipants)
      .innerJoin(
        messagingConversations,
        eq(messagingConversations.id, messagingParticipants.conversationId),
      )
      .leftJoin(
        messagingMessages,
        and(
          eq(messagingMessages.conversationId, messagingConversations.id),
          eq(
            messagingMessages.sequence,
            messagingConversations.messageSequence,
          ),
        ),
      )
      .where(and(eq(messagingParticipants.userId, input.userId), position))
      .orderBy(
        desc(messagingConversations.lastActivityAt),
        desc(messagingConversations.id),
      )
      .limit(input.limit);
  }

  /**
   * Advances the caller's read position, never retreats it.
   *
   * `greatest` is applied in the statement rather than by reading and comparing
   * first, so two acknowledgements racing cannot interleave into the lower one
   * winning.
   */
  async advanceReadPosition(
    executor: Executor,
    input: {
      readonly conversationId: string;
      readonly now: Date;
      readonly sequence: number;
      readonly userId: string;
    },
  ): Promise<number> {
    const rows = await executor
      .update(messagingParticipants)
      .set({
        lastReadAt: sql`case
          when ${input.sequence} > ${messagingParticipants.lastReadSequence}
            then ${input.now}
          else ${messagingParticipants.lastReadAt}
        end`,
        lastReadSequence: sql`greatest(${messagingParticipants.lastReadSequence}, ${input.sequence})`,
      })
      .where(
        and(
          eq(messagingParticipants.conversationId, input.conversationId),
          eq(messagingParticipants.userId, input.userId),
        ),
      )
      .returning({ sequence: messagingParticipants.lastReadSequence });
    const row = rows[0];
    if (row === undefined) throw new Error('Read position update matched none');
    return row.sequence;
  }
}
