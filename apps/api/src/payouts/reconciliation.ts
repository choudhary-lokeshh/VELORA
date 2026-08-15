import type { SafeLogger } from '@velora/observability/server';

import { money, moneyEquals } from '../money/money.js';
import type { PayoutProviderPort } from './provider.js';
import type { PayoutsRepository } from './repository.js';
import type { PayoutsService } from './service.js';

/**
 * Resolving payout instructions the platform sent and never heard back about.
 *
 * A payout in `submitted` has either moved money or not, and the reservation it
 * holds keeps a creator's balance earmarked until somebody finds out which. The
 * one thing this must never do is send a second instruction: it asks the
 * provider what it holds under the key Velora already used, which returns the
 * object that key created if there is one and creates nothing if there is not.
 *
 * A `reserved` instruction is the crash-before-call case — the reservation was
 * committed and the process died before the provider was reached. Re-issuing
 * under the same key is the same read-your-write, and it is the only way to
 * learn a reference the platform never received.
 *
 * Nothing here is a blind retry, nothing runs inside a transaction across a
 * provider call, and nothing releases a reservation on a guess: an instruction
 * whose outcome is still unknown stays exactly where it is.
 */

export interface PayoutReconciliationReport {
  readonly examined: number;
  readonly failed: number;
  readonly resolved: number;
}

export interface PayoutReconciliationDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly provider: PayoutProviderPort;
  readonly repository: PayoutsRepository;
  readonly service: PayoutsService;
}

const batchSize = 50;

export class PayoutsReconciliation {
  constructor(
    private readonly dependencies: PayoutReconciliationDependencies,
  ) {}

  async reconcileOnce(): Promise<PayoutReconciliationReport> {
    const { logger, provider, repository, service } = this.dependencies;
    if (provider.provider === 'unavailable') {
      return { examined: 0, failed: 0, resolved: 0 };
    }
    const stale = await repository.listReserving(
      repository.transactionless,
      batchSize,
    );
    let resolved = 0;
    let failed = 0;
    for (const instruction of stale) {
      try {
        const recipient = await repository.findRecipient(
          repository.transactionless,
          instruction.creatorId,
        );
        if (recipient?.providerReference == null) continue;
        // The same instruction under the same key. A provider that already
        // paid returns what it created; one that never received it acts now.
        const snapshot = await provider.sendPayout({
          amount: money(instruction.amountMinor, instruction.currency),
          idempotencyKey: instruction.providerIdempotencyKey,
          operationReference: instruction.id,
          recipientReference: recipient.providerReference,
        });
        if (
          !moneyEquals(
            snapshot.amount,
            money(instruction.amountMinor, instruction.currency),
          )
        ) {
          logger.error(
            { instructionId: instruction.id, provider: instruction.provider },
            'provider payout snapshot disagrees with the recorded instruction',
          );
          continue;
        }
        if (snapshot.status === 'paid') {
          const settled = await repository.transaction(async (executor) =>
            service.settle(executor, {
              instruction,
              providerReference: snapshot.providerReference,
            }),
          );
          if (settled !== undefined) resolved += 1;
          continue;
        }
        if (snapshot.status === 'failed') {
          const released = await repository.transaction(async (executor) =>
            service.release(executor, {
              failureReason: 'declined',
              instruction,
              providerReference: snapshot.providerReference,
            }),
          );
          if (released !== undefined) resolved += 1;
          continue;
        }
        // Still with the provider. The reference is recorded because a later
        // sweep matches on it; the state is not, because nothing is known.
        await repository.transaction(async (executor) =>
          repository.transition(executor, {
            from: ['reserved'],
            instructionId: instruction.id,
            lastProviderSyncAt: this.dependencies.now(),
            now: this.dependencies.now(),
            providerReference: snapshot.providerReference,
            to: 'submitted',
          }),
        );
      } catch (error) {
        failed += 1;
        // Unreachable, or an answer this platform cannot use. The instruction
        // stays exactly where it is, with its reservation intact, and the next
        // sweep tries again. Nothing is released on a guess.
        logger.warn(
          { error, provider: instruction.provider },
          'payout reconciliation could not resolve an instruction',
        );
      }
    }
    return { examined: stale.length, failed, resolved };
  }
}
