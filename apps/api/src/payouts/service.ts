import type { Executor, TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import type { JournalStore } from '../money/journal.js';
import { compareMoney, isPositiveMoney, money } from '../money/money.js';
import { disbursementSettledEvent } from './disbursement-events.js';
import type { PayoutPolicy } from './payout-policy.js';
import { payoutsBusinessTypes } from './policy.js';
import type { PayoutProviderPort } from './provider.js';
import type { PayoutInstructionRow, PayoutsRepository } from './repository.js';

/**
 * Sending a creator their money, and refusing to.
 *
 * The same prepare, commit, call, record ordering every provider interaction in
 * this repository follows, with one addition that only payouts need: the
 * reservation. An amount is moved out of what a creator may claim, durably and
 * as an accounting transaction, *before* any provider is contacted. That is
 * what stops two concurrent requests spending one balance, and it is why the
 * bound is not a lock somebody has to remember to take — a reservation that
 * exists is visible to every replica that reads the book.
 *
 * Three things are deliberately impossible here.
 *
 * **No payout exceeds the derived available amount.** The available figure is
 * summed from journal entries under a lock on the recipient row, and the
 * database refuses a posting that would overdraw a creator's position whatever
 * this code believes.
 *
 * **Nothing marks money as sent except a provider.** There is no path — for a
 * creator, for an operator, or for a job — that sets an instruction to `paid`
 * without a provider reference, because a CHECK constraint refuses the row.
 *
 * **Nothing retries a movement of money blindly.** An ambiguous answer leaves
 * the instruction `submitted` with its reservation intact, and reconciliation
 * resolves it from the provider's own record under the key Velora sent.
 *
 * In a deployed environment none of this runs at all. No payout provider is
 * eligible — [provider eligibility](../../../../docs/compliance/06-payment-provider-eligibility.md)
 * records why, from primary sources — and no payout terms are published, so
 * both the adapter and the policy refuse before anything is written.
 */

export type PayoutRefusal =
  /** The same key already names an instruction for a different amount. */
  | 'idempotency_mismatch'
  /** More than the policy currently releases, or more than the book holds. */
  | 'insufficient_balance'
  /** The provider does not say this recipient can be paid. */
  | 'recipient_not_ready'
  /** No approved payout provider, or no approved payout terms. */
  | 'unavailable';

export type PayoutOutcome =
  | { readonly kind: 'accepted'; readonly instruction: PayoutInstructionRow }
  | { readonly kind: 'refused'; readonly reason: PayoutRefusal };

export interface PayoutsServiceDependencies {
  readonly journal: JournalStore;
  readonly now: () => Date;
  readonly outbox: OutboxAppendPort;
  readonly policy: PayoutPolicy;
  readonly provider: PayoutProviderPort;
  readonly repository: PayoutsRepository;
}

function refused(reason: PayoutRefusal): {
  readonly kind: 'refused';
  readonly reason: PayoutRefusal;
} {
  return { kind: 'refused', reason };
}

const availableAccount = (creatorId: string) =>
  ({
    category: 'creator_available',
    subjectId: creatorId,
    subjectType: 'creator',
  }) as const;

const reservedAccount = (creatorId: string) =>
  ({
    category: 'creator_reserved',
    subjectId: creatorId,
    subjectType: 'creator',
  }) as const;

const disbursedAccount = {
  category: 'payout_disbursed',
  subjectType: 'platform',
} as const;

export class PayoutsService {
  constructor(private readonly dependencies: PayoutsServiceDependencies) {}

  /**
   * Requests one payout, reserving before it asks anybody for anything.
   *
   * Everything that could refuse is decided inside the transaction that writes
   * the reservation, against the recipient held under lock. A revenue reversal
   * landing a moment ago, a hold applied a moment ago, and another request for
   * the same creator all either win over this call or lose to it.
   */
  async request(input: {
    readonly amountMinor: bigint;
    readonly correlationId: string;
    readonly creatorId: string;
    readonly currency: string;
    readonly idempotencyKey: string;
    readonly requestedBy: string;
  }): Promise<PayoutOutcome> {
    const { policy, provider, repository } = this.dependencies;
    // Two environment refusals before anything is read. A platform with no
    // published settlement terms has nothing available to release, and an
    // adapter that refuses every call cannot send anything — recording a
    // durable intention to pay somebody through a provider that does not exist
    // would be worse than saying so.
    if (provider.provider === 'unavailable') return refused('unavailable');
    if (policy.source === 'unpublished') return refused('unavailable');

    const prepared = await repository.transaction(async (executor) =>
      this.reserve(executor, input),
    );
    if (prepared.kind === 'refused') return prepared;
    const instruction = prepared.instruction;

    // Already past the provider call. A replay answers with current state.
    if (instruction.state !== 'reserved') {
      return { kind: 'accepted', instruction };
    }

    let snapshot;
    try {
      // Outside every transaction, deliberately. The reservation is already
      // durable, so a crash here leaves an instruction reconciliation can
      // resolve rather than money sent that Velora has no record of.
      snapshot = await provider.sendPayout({
        amount: money(instruction.amountMinor, instruction.currency),
        idempotencyKey: instruction.providerIdempotencyKey,
        operationReference: instruction.id,
        recipientReference: prepared.recipientReference,
      });
    } catch {
      // The provider may or may not have sent the money. That is not a failure
      // and it is certainly not a success: the instruction waits, its
      // reservation stays in place so nothing else can spend it, and no second
      // instruction is sent under a new key.
      const submitted = await repository.transaction(async (executor) =>
        repository.transition(executor, {
          from: ['reserved'],
          instructionId: instruction.id,
          now: this.dependencies.now(),
          to: 'submitted',
        }),
      );
      return { kind: 'accepted', instruction: submitted ?? instruction };
    }

    return {
      kind: 'accepted',
      instruction: await this.record({
        instruction,
        providerReference: snapshot.providerReference,
        status: snapshot.status,
      }),
    };
  }

  /**
   * Settles an instruction the provider has confirmed, with its accounting.
   *
   * Public because a confirmation arrives from more than one place: the request
   * thread, and reconciliation resolving one whose answer was lost. Both land
   * here so there is one posting and one published fact.
   */
  async settle(
    executor: Executor,
    input: {
      readonly instruction: PayoutInstructionRow;
      readonly providerReference: string;
    },
  ): Promise<PayoutInstructionRow | undefined> {
    const { journal, outbox, repository } = this.dependencies;
    const paid = await repository.transition(executor, {
      from: ['reserved', 'submitted'],
      instructionId: input.instruction.id,
      lastProviderSyncAt: this.dependencies.now(),
      now: this.dependencies.now(),
      providerReference: input.providerReference,
      to: 'paid',
    });
    // Already settled. A redelivered confirmation is the normal case and must
    // not post a second disbursement or publish a second fact.
    if (paid === undefined) return undefined;

    const amount = money(paid.amountMinor, paid.currency);
    // The reservation becomes a disbursement. The creator's claim is
    // extinguished and the money is recorded as having left.
    await journal.post(executor, {
      businessReference: paid.id,
      businessType: payoutsBusinessTypes.disbursement,
      ...(paid.correlationId === null
        ? {}
        : { correlationId: paid.correlationId }),
      entries: [
        {
          account: reservedAccount(paid.creatorId),
          amount,
          direction: 'debit',
        },
        { account: disbursedAccount, amount, direction: 'credit' },
      ],
      occurredAt: this.dependencies.now(),
      reason: 'payout_paid',
    });

    // BILLING owes the same creator the same money from the other side of the
    // seam. It learns that it no longer does by consuming this fact, never by
    // PAYOUTS writing a `billing_` row.
    await outbox.append(executor as TransactionHandle, {
      ...(paid.correlationId === null
        ? {}
        : { correlationId: paid.correlationId }),
      eventName: disbursementSettledEvent,
      eventVersion: 1,
      now: this.dependencies.now(),
      occurredAt: this.dependencies.now(),
      payload: {
        amountMinor: paid.amountMinor.toString(),
        creatorId: paid.creatorId,
        currency: paid.currency,
        instructionId: paid.id,
      },
      subjectId: paid.id,
      subjectType: 'payouts.instruction',
    });
    return paid;
  }

  /**
   * Releases a reservation the provider refused, without money moving.
   *
   * A compensating transaction rather than a reversal of the original: the
   * reservation happened, the release happens, and both stay in the book. The
   * creator's balance returns to what it was, which is the only correct outcome
   * for money that never left.
   */
  async release(
    executor: Executor,
    input: {
      readonly failureReason: 'declined' | 'provider_error';
      readonly instruction: PayoutInstructionRow;
      readonly providerReference?: string;
    },
  ): Promise<PayoutInstructionRow | undefined> {
    const { journal, repository } = this.dependencies;
    const failed = await repository.transition(executor, {
      failureReason: input.failureReason,
      from: ['reserved', 'submitted'],
      instructionId: input.instruction.id,
      lastProviderSyncAt: this.dependencies.now(),
      now: this.dependencies.now(),
      ...(input.providerReference === undefined
        ? {}
        : { providerReference: input.providerReference }),
      to: 'failed',
    });
    if (failed === undefined) return undefined;

    const amount = money(failed.amountMinor, failed.currency);
    await journal.post(executor, {
      businessReference: failed.id,
      businessType: payoutsBusinessTypes.release,
      entries: [
        {
          account: reservedAccount(failed.creatorId),
          amount,
          direction: 'debit',
        },
        {
          account: availableAccount(failed.creatorId),
          amount,
          direction: 'credit',
        },
      ],
      occurredAt: this.dependencies.now(),
      reason: 'reservation_released',
    });
    return failed;
  }

  /**
   * The transactional half: the recipient under lock, the bound, the
   * reservation.
   *
   * The lock is the whole design. Everything read about how much a creator may
   * claim is read after it, so two callers cannot both see room only one of
   * them can have.
   */
  private async reserve(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly correlationId: string;
      readonly creatorId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly requestedBy: string;
    },
  ): Promise<
    | { readonly kind: 'refused'; readonly reason: PayoutRefusal }
    | {
        readonly instruction: PayoutInstructionRow;
        readonly kind: 'reserved';
        readonly recipientReference: string;
      }
  > {
    const { journal, policy, provider, repository } = this.dependencies;
    const recipient = await repository.lockRecipient(executor, input.creatorId);
    // A provider that has not said this recipient can be paid is the end of it.
    // Provider recipient readiness never overrides Velora's own gates, but the
    // absence of it is decisive on its own.
    if (recipient?.status !== 'ready') return refused('recipient_not_ready');
    const recipientReference = recipient.providerReference;
    if (recipientReference === null) return refused('recipient_not_ready');

    const existing = await repository.findByIdempotency(executor, {
      creatorId: input.creatorId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing !== undefined) {
      // The same key against a different amount is not a replay; it is a
      // different instruction wearing a used key, and answering it with the old
      // one would send the wrong amount.
      if (
        existing.amountMinor !== input.amountMinor ||
        existing.currency !== input.currency
      ) {
        return refused('idempotency_mismatch');
      }
      return { instruction: existing, kind: 'reserved', recipientReference };
    }

    const balances = await repository.balancesFor(executor, {
      creatorId: input.creatorId,
      currency: input.currency,
    });
    const releasable = policy.releasable(balances);
    if (releasable === undefined) return refused('unavailable');
    const requested = money(input.amountMinor, input.currency);
    if (!isPositiveMoney(releasable)) return refused('insufficient_balance');
    if (compareMoney(requested, releasable) > 0) {
      return refused('insufficient_balance');
    }

    const inserted = await repository.insertInstruction(executor, {
      amountMinor: input.amountMinor,
      correlationId: input.correlationId,
      creatorId: input.creatorId,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      now: this.dependencies.now(),
      provider: provider.provider,
      // Derived from the instruction's own identity rather than random, so the
      // key a retry sends is the key the first attempt sent even if this
      // process never learned what happened to it.
      providerIdempotencyKey:
        `velora-payout-${input.creatorId}-${input.idempotencyKey}`.slice(
          0,
          200,
        ),
      requestedBy: input.requestedBy,
    });
    if (inserted === undefined) {
      const winner = await repository.findByIdempotency(executor, {
        creatorId: input.creatorId,
        idempotencyKey: input.idempotencyKey,
      });
      if (winner === undefined) return refused('idempotency_mismatch');
      return { instruction: winner, kind: 'reserved', recipientReference };
    }

    // The reservation, posted in the same transaction as the instruction. The
    // database refuses this posting outright if it would overdraw the creator's
    // position, so the bound above exists for the error message and this exists
    // for the guarantee.
    await journal.post(executor, {
      businessReference: inserted.id,
      businessType: payoutsBusinessTypes.reservation,
      correlationId: input.correlationId,
      entries: [
        {
          account: availableAccount(input.creatorId),
          amount: requested,
          direction: 'debit',
        },
        {
          account: reservedAccount(input.creatorId),
          amount: requested,
          direction: 'credit',
        },
      ],
      occurredAt: this.dependencies.now(),
      reason: 'payout_reserved',
    });
    const reserved = await repository.transition(executor, {
      from: ['requested'],
      instructionId: inserted.id,
      now: this.dependencies.now(),
      to: 'reserved',
    });
    return {
      instruction: reserved ?? inserted,
      kind: 'reserved',
      recipientReference,
    };
  }

  /** Records what the provider said, with the accounting a success implies. */
  private async record(input: {
    readonly instruction: PayoutInstructionRow;
    readonly providerReference: string;
    readonly status: 'failed' | 'paid' | 'submitted';
  }): Promise<PayoutInstructionRow> {
    const { repository } = this.dependencies;
    if (input.status === 'paid') {
      const paid = await repository.transaction(async (executor) =>
        this.settle(executor, {
          instruction: input.instruction,
          providerReference: input.providerReference,
        }),
      );
      return paid ?? input.instruction;
    }
    if (input.status === 'failed') {
      const failed = await repository.transaction(async (executor) =>
        this.release(executor, {
          failureReason: 'declined',
          instruction: input.instruction,
          providerReference: input.providerReference,
        }),
      );
      return failed ?? input.instruction;
    }
    const submitted = await repository.transaction(async (executor) =>
      repository.transition(executor, {
        from: ['reserved'],
        instructionId: input.instruction.id,
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        providerReference: input.providerReference,
        to: 'submitted',
      }),
    );
    return submitted ?? input.instruction;
  }
}
