import { eq } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import { messagingConversations } from './schema.js';

/**
 * The conversation-state change MESSAGING publishes for enforcement.
 *
 * A conversation's state is MESSAGING's truth. TRUST & SAFETY decides that a
 * conversation should end; it does not decide what ending one means, and it does
 * not write to `messaging_`. This contract is the whole of what an enforcement
 * decision may do to a conversation: close it. It cannot delete a message,
 * cannot read one, and cannot reopen a conversation, because none of those is a
 * decision the enforcement scope covers.
 *
 * Nothing is deleted. Closing ends the ability to send; the history stays
 * exactly where it was, because message retention is an open legal decision and
 * enforcement must not quietly pre-empt it.
 */
export interface ConversationEnforcementPort {
  close(input: {
    readonly conversationId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<boolean>;
}

export class ConversationEnforcement implements ConversationEnforcementPort {
  constructor(private readonly database: DatabaseHandle) {}

  async close(input: {
    readonly conversationId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<boolean> {
    const updated = await input.executor
      .update(messagingConversations)
      .set({ state: 'closed', updatedAt: input.now })
      .where(eq(messagingConversations.id, input.conversationId))
      .returning({ id: messagingConversations.id });
    return updated.length > 0;
  }

  /** Present so the class owns a handle of its own, as the other contracts do. */
  get transactionless(): DatabaseHandle {
    return this.database;
  }
}
