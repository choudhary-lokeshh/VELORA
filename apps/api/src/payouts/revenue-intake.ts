import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { OutboxConsumer, OutboxEvent } from '../events/relay.js';
import type { JournalStore } from '../money/journal.js';
import { lockCreatorPosition } from './creator-position-lock.js';
import { money } from '../money/money.js';
import { payoutsBusinessTypes } from './policy.js';

/**
 * PAYOUTS reading BILLING's revenue facts.
 *
 * The receiving half of the money seam. BILLING publishes that a sale settled,
 * or that part of one was returned; this turns that into an entry in the
 * creator-liability book, using its own accounting, against its own tables.
 * Neither domain reads the other's storage and neither calls the other
 * synchronously.
 *
 * Delivery is at-least-once, so both handlers are idempotent by construction
 * rather than by checking first: a posting carries the business event it
 * accounts for, and the unique index over that identity is what makes one event
 * post once. A redelivered settlement credits nothing a second time.
 *
 * A malformed or foreign payload is ignored rather than failed. A fact naming
 * something this domain has no rule for belongs to somebody else, and treating
 * that as an error would make every future event type an outage here.
 */

interface RevenueFact {
  readonly creatorId?: unknown;
  readonly creatorMinor?: unknown;
  readonly currency?: unknown;
  readonly paymentId?: unknown;
  readonly reversalId?: unknown;
}

function revenueOf(
  payload: unknown,
  kind: 'reversed' | 'settled',
):
  | {
      readonly amountMinor: bigint;
      readonly creatorId: string;
      readonly currency: string;
      readonly reference: string;
    }
  | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fact = payload as RevenueFact;
  const reference =
    kind === 'settled' ? fact.paymentId : (fact.reversalId ?? fact.paymentId);
  if (typeof fact.creatorId !== 'string') return undefined;
  if (typeof fact.currency !== 'string') return undefined;
  if (typeof fact.creatorMinor !== 'string') return undefined;
  if (typeof reference !== 'string') return undefined;
  if (!/^[1-9][0-9]{0,18}$/u.test(fact.creatorMinor)) return undefined;
  return {
    amountMinor: BigInt(fact.creatorMinor),
    creatorId: fact.creatorId,
    currency: fact.currency,
    reference,
  };
}

const intakeAccount = {
  category: 'revenue_intake',
  subjectType: 'platform',
} as const;

const availableAccount = (creatorId: string) =>
  ({
    category: 'creator_available',
    subjectId: creatorId,
    subjectType: 'creator',
  }) as const;

export class BillingRevenueIntake implements OutboxConsumer {
  constructor(
    readonly eventName: string,
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly journal: JournalStore;
      readonly kind: 'reversed' | 'settled';
      readonly logger: SafeLogger;
      readonly now: () => Date;
    },
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const fact = revenueOf(event.payload, this.dependencies.kind);
    if (fact === undefined) return;
    const { database, journal, kind } = this.dependencies;
    const amount = money(fact.amountMinor, fact.currency);
    const settled = kind === 'settled';

    await database.transaction(async (executor) => {
      // The same lock every other writer of this position takes. Without it a
      // reversal and a payout can each pass the not-overdrawn check and commit,
      // because that check runs at commit and cannot see the other's entries.
      await lockCreatorPosition(executor, fact.creatorId);
      await journal.post(executor, {
        // The BILLING event's own identity, so a redelivery posts nothing.
        businessReference: fact.reference,
        businessType: payoutsBusinessTypes.revenue,
        entries: settled
          ? [
              { account: intakeAccount, amount, direction: 'debit' },
              {
                account: availableAccount(fact.creatorId),
                amount,
                direction: 'credit',
              },
            ]
          : [
              {
                account: availableAccount(fact.creatorId),
                amount,
                direction: 'debit',
              },
              { account: intakeAccount, amount, direction: 'credit' },
            ],
        occurredAt: event.occurredAt,
        reason: settled ? 'revenue_accrued' : 'revenue_reversed',
      });
    });
  }
}

/** Both halves of the seam, built together so neither is wired without the other. */
export function billingRevenueIntakes(dependencies: {
  readonly database: DatabaseHandle;
  readonly journal: JournalStore;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly reversedEvent: string;
  readonly settledEvent: string;
}): readonly OutboxConsumer[] {
  return [
    new BillingRevenueIntake(dependencies.settledEvent, {
      ...dependencies,
      kind: 'settled',
    }),
    new BillingRevenueIntake(dependencies.reversedEvent, {
      ...dependencies,
      kind: 'reversed',
    }),
  ];
}
