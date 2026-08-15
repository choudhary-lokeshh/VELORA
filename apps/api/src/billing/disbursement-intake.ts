import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { OutboxConsumer, OutboxEvent } from '../events/relay.js';
import type { JournalStore } from '../money/journal.js';
import { money } from '../money/money.js';
import { billingBusinessTypes } from './policy.js';
import {
  creatorPayableAccount,
  payoutClearingAccount,
} from './revenue-entries.js';

/**
 * BILLING learning that a creator was paid.
 *
 * The return leg of the money seam. BILLING records what it owes a creator out
 * of customer money and has no way to know when that obligation is discharged —
 * PAYOUTS owns the disbursement and says so through a published fact. This
 * consumes it and moves the liability out of the customer-money book, so the
 * two books agree about what is still owed without either writing the other's
 * rows.
 *
 * Idempotent by construction: the posting carries the payout instruction as its
 * business identity, and the unique index over that identity is what makes one
 * disbursement post once however many times the fact is delivered.
 */

interface DisbursementFact {
  readonly amountMinor?: unknown;
  readonly creatorId?: unknown;
  readonly currency?: unknown;
  readonly instructionId?: unknown;
}

function disbursementOf(payload: unknown):
  | {
      readonly amountMinor: bigint;
      readonly creatorId: string;
      readonly currency: string;
      readonly instructionId: string;
    }
  | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fact = payload as DisbursementFact;
  if (typeof fact.creatorId !== 'string') return undefined;
  if (typeof fact.currency !== 'string') return undefined;
  if (typeof fact.instructionId !== 'string') return undefined;
  if (typeof fact.amountMinor !== 'string') return undefined;
  if (!/^[1-9][0-9]{0,18}$/u.test(fact.amountMinor)) return undefined;
  return {
    amountMinor: BigInt(fact.amountMinor),
    creatorId: fact.creatorId,
    currency: fact.currency,
    instructionId: fact.instructionId,
  };
}

export class PayoutDisbursementIntake implements OutboxConsumer {
  constructor(
    readonly eventName: string,
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly journal: JournalStore;
      readonly logger: SafeLogger;
      readonly now: () => Date;
    },
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const fact = disbursementOf(event.payload);
    if (fact === undefined) return;
    const { database, journal } = this.dependencies;
    const amount = money(fact.amountMinor, fact.currency);

    await database.transaction(async (executor) => {
      await journal.post(executor, {
        businessReference: fact.instructionId,
        businessType: billingBusinessTypes.payout,
        entries: [
          {
            account: creatorPayableAccount(fact.creatorId),
            amount,
            direction: 'debit',
          },
          { account: payoutClearingAccount, amount, direction: 'credit' },
        ],
        occurredAt: event.occurredAt,
        reason: 'payout_settled',
      });
    });
  }
}
