import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type { IdentityProviderEventState } from './policy.js';
import { identityProviderEvents } from './schema.js';

export type IdentityProviderEventRow =
  typeof identityProviderEvents.$inferSelect;

export type IdentityProviderEventReceipt =
  | { readonly kind: 'inserted'; readonly row: IdentityProviderEventRow }
  | { readonly kind: 'duplicate'; readonly row: IdentityProviderEventRow }
  | { readonly kind: 'mismatch'; readonly row: IdentityProviderEventRow };

/** Durable inbox for verified, minimized provider receipts. */
export class IdentityProviderEventRepository {
  constructor(private readonly database: DatabaseHandle) {}

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  async receive(
    executor: Executor,
    input: {
      readonly eventId: string;
      readonly eventType: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly payloadDigest: string;
      readonly provider: string;
      readonly providerAccount: string;
      readonly providerEnvironment: string;
      readonly providerReference: string;
    },
  ): Promise<IdentityProviderEventReceipt> {
    const inserted = await executor
      .insert(identityProviderEvents)
      .values({
        attempts: 0,
        availableAt: input.now,
        failureReason: null,
        id: crypto.randomUUID(),
        leaseExpiresAt: null,
        leaseOwner: null,
        normalizedEventType: input.eventType,
        occurredAt: input.occurredAt,
        payloadDigest: input.payloadDigest,
        processedAt: null,
        provider: input.provider,
        providerAccount: input.providerAccount,
        providerEnvironment: input.providerEnvironment,
        providerEventId: input.eventId,
        providerReference: input.providerReference,
        receivedAt: input.now,
        state: 'received',
      })
      .onConflictDoNothing({
        target: [
          identityProviderEvents.provider,
          identityProviderEvents.providerAccount,
          identityProviderEvents.providerEnvironment,
          identityProviderEvents.providerEventId,
        ],
      })
      .returning();
    if (inserted[0] !== undefined) {
      return { kind: 'inserted', row: inserted[0] };
    }

    const existing = await this.findByIdentity(executor, input);
    if (existing === undefined) {
      throw new Error(
        'identity provider event conflict resolved without a row',
      );
    }
    return sameReceipt(existing, input)
      ? { kind: 'duplicate', row: existing }
      : { kind: 'mismatch', row: existing };
  }

  async findByIdentity(
    executor: Executor,
    input: {
      readonly eventId: string;
      readonly provider: string;
      readonly providerAccount: string;
      readonly providerEnvironment: string;
    },
  ): Promise<IdentityProviderEventRow | undefined> {
    const rows = await executor
      .select()
      .from(identityProviderEvents)
      .where(
        and(
          eq(identityProviderEvents.provider, input.provider),
          eq(identityProviderEvents.providerAccount, input.providerAccount),
          eq(
            identityProviderEvents.providerEnvironment,
            input.providerEnvironment,
          ),
          eq(identityProviderEvents.providerEventId, input.eventId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async claim(input: {
    readonly leaseMilliseconds: number;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<readonly IdentityProviderEventRow[]> {
    const leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseMilliseconds,
    );
    return this.database.transaction(async (executor) => {
      const candidates = await executor
        .select({ id: identityProviderEvents.id })
        .from(identityProviderEvents)
        .where(
          and(
            or(
              eq(identityProviderEvents.state, 'received'),
              eq(identityProviderEvents.state, 'retry_wait'),
            ),
            lte(identityProviderEvents.availableAt, input.now),
            or(
              isNull(identityProviderEvents.leaseExpiresAt),
              lte(identityProviderEvents.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(
          asc(identityProviderEvents.availableAt),
          asc(identityProviderEvents.id),
        )
        .limit(input.limit)
        .for('update', { skipLocked: true });

      const claimed: IdentityProviderEventRow[] = [];
      for (const candidate of candidates) {
        const rows = await executor
          .update(identityProviderEvents)
          .set({
            attempts: sql`${identityProviderEvents.attempts} + 1`,
            leaseExpiresAt,
            leaseOwner: input.owner,
          })
          .where(eq(identityProviderEvents.id, candidate.id))
          .returning();
        if (rows[0] !== undefined) claimed.push(rows[0]);
      }
      return claimed;
    });
  }

  async settle(
    executor: Executor,
    input: {
      readonly availableAt?: Date;
      readonly failureReason?: string;
      readonly id: string;
      readonly now: Date;
      readonly owner: string;
      readonly state: IdentityProviderEventState;
    },
  ): Promise<boolean> {
    const processed = input.state === 'processed' || input.state === 'ignored';
    const updated = await executor
      .update(identityProviderEvents)
      .set({
        ...(input.availableAt === undefined
          ? {}
          : { availableAt: input.availableAt }),
        failureReason:
          input.state === 'dead_letter'
            ? (input.failureReason ?? 'processing_failed')
            : null,
        leaseExpiresAt: null,
        leaseOwner: null,
        processedAt: processed ? input.now : null,
        state: input.state,
      })
      .where(
        and(
          eq(identityProviderEvents.id, input.id),
          eq(identityProviderEvents.leaseOwner, input.owner),
        ),
      )
      .returning({ id: identityProviderEvents.id });
    return updated.length > 0;
  }
}

function sameReceipt(
  row: IdentityProviderEventRow,
  input: {
    readonly eventType: string;
    readonly occurredAt: Date;
    readonly payloadDigest: string;
    readonly providerReference: string;
  },
): boolean {
  return (
    row.normalizedEventType === input.eventType &&
    row.occurredAt.getTime() === input.occurredAt.getTime() &&
    row.payloadDigest === input.payloadDigest &&
    row.providerReference === input.providerReference
  );
}
