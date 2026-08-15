import { and, eq } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import { messagingParticipants } from './schema.js';

/**
 * Whether somebody is in a conversation.
 *
 * The one thing MESSAGING tells TRUST & SAFETY about a conversation, and the
 * whole of what a report about one needs. A conversation somebody is not in is
 * not a conversation they may report: a report naming an arbitrary identifier
 * would be a way to assert that two other people are talking, and the answer
 * would be a disclosure however the report was later handled.
 *
 * A boolean. No participants, no counterpart, no message, no state — nothing
 * that would let a caller learn about a conversation by reporting it.
 */
export interface ConversationParticipationPort {
  participates(input: {
    readonly accountId: string;
    readonly conversationId: string;
    readonly executor: Executor;
  }): Promise<boolean>;
}

export class ConversationParticipation implements ConversationParticipationPort {
  async participates(input: {
    readonly accountId: string;
    readonly conversationId: string;
    readonly executor: Executor;
  }): Promise<boolean> {
    const rows = await input.executor
      .select({ userId: messagingParticipants.userId })
      .from(messagingParticipants)
      .where(
        and(
          eq(messagingParticipants.conversationId, input.conversationId),
          eq(messagingParticipants.userId, input.accountId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
