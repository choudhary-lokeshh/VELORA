import type { SafeLogger } from '@velora/observability/server';

import type { TransactionHandle } from '../database/executor.js';

import {
  maximumProviderEventAttempts,
  providerEventBackoffMilliseconds,
  providerEventBatchSize,
  providerEventLeaseMilliseconds,
} from './policy.js';
import type {
  NotificationProviderEventRow,
  NotificationRepository,
} from './repository.js';

export type ProviderEventApplication =
  | { readonly id: string; readonly kind: 'applied' }
  /** Nothing on this side matches what the provider named. */
  | { readonly id: string; readonly kind: 'unmatched' }
  | { readonly id: string; readonly kind: 'retry' }
  | { readonly id: string; readonly kind: 'dead_letter' }
  /** Not due, or claimed by another worker. */
  | { readonly id: string; readonly kind: 'skipped' };

/**
 * Applies what a provider said, having already established that it said it.
 *
 * Verification happened at the edge; this is the part that decides what a
 * verified observation is allowed to change. The answer is deliberately small.
 *
 * A `token_invalid` retires every live registration holding that fingerprint,
 * across every account, because a token the provider has retired is one nobody
 * can be reached on. That is the one effect with teeth, and it is safe in the
 * direction that matters: the worst case is a device that has to register
 * again, which it does on next launch.
 *
 * Everything else is recorded and applied to nothing yet. `delivered`,
 * `deferred`, `bounced`, and `complained` are all statements about an email
 * destination, and no domain stores an email address — so there is nothing for
 * them to update, and inventing a place to put them would be building against
 * a channel that cannot exist. They settle as applied so the inbox drains, and
 * the row remains as the evidence it is.
 *
 * An event naming something this platform has no record of is not an error and
 * not a reason to retry. A provider may report on a notice whose row has since
 * been removed, or report about a device that was never registered here, and
 * the honest response is to record that it did not match rather than to keep
 * asking or to invent the missing row.
 */
export class NotificationProviderEventProcessor {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly owner: string;
      readonly repository: NotificationRepository;
    },
  ) {}

  async applyDue(): Promise<readonly ProviderEventApplication[]> {
    const now = this.dependencies.now();
    const due = await this.dependencies.repository.listClaimableProviderEvents(
      this.dependencies.repository.transactionless,
      { limit: providerEventBatchSize, now },
    );
    const applied: ProviderEventApplication[] = [];
    for (const event of due) {
      applied.push(await this.apply(event));
    }
    return applied;
  }

  private async apply(
    hint: NotificationProviderEventRow,
  ): Promise<ProviderEventApplication> {
    const now = this.dependencies.now();
    return this.dependencies.repository.transaction(async (executor) => {
      const claimed = await this.dependencies.repository.claimProviderEvent(
        executor,
        {
          id: hint.id,
          leaseExpiresAt: new Date(
            now.getTime() + providerEventLeaseMilliseconds,
          ),
          now,
          owner: this.dependencies.owner,
        },
      );
      if (claimed === undefined) return { id: hint.id, kind: 'skipped' };

      try {
        const matched = await this.effectOf(executor, claimed, now);
        await this.dependencies.repository.settleProviderEvent(executor, {
          id: claimed.id,
          now,
          owner: this.dependencies.owner,
          state: 'processed',
        });
        return {
          id: claimed.id,
          kind: matched ? 'applied' : 'unmatched',
        };
      } catch (error) {
        // The provider's account is not at fault; this side failed to apply
        // it. The event keeps its evidence and comes back.
        const exhausted = claimed.attempts >= maximumProviderEventAttempts;
        this.dependencies.logger.warn(
          { error, eventId: claimed.id, exhausted },
          'notification provider event could not be applied',
        );
        await this.dependencies.repository.settleProviderEvent(executor, {
          availableAt: new Date(
            now.getTime() + providerEventBackoffMilliseconds(claimed.attempts),
          ),
          failureReason: 'apply_failed',
          id: claimed.id,
          now,
          owner: this.dependencies.owner,
          state: exhausted ? 'dead_letter' : 'retry_wait',
        });
        return {
          id: claimed.id,
          kind: exhausted ? 'dead_letter' : 'retry',
        };
      }
    });
  }

  /**
   * Returns whether the event matched anything on this side.
   *
   * Runs on the caller's executor, inside the transaction that claims and
   * settles the event. Applying an effect that committed separately from the
   * settle would leave a device retired against an event still marked
   * unprocessed, which a later run would then apply again.
   */
  private async effectOf(
    executor: TransactionHandle,
    event: NotificationProviderEventRow,
    now: Date,
  ): Promise<boolean> {
    if (event.feedbackType !== 'token_invalid') return false;
    if (event.tokenFingerprint === null) return false;

    const disabled =
      await this.dependencies.repository.disableDevicesByProviderInvalidation(
        executor,
        { now, tokenFingerprint: event.tokenFingerprint },
      );
    return disabled > 0;
  }
}
