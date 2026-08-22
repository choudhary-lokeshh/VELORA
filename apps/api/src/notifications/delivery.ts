import type { SafeLogger } from '@velora/observability/server';

import type { TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type {
  NotificationChannelPort,
  NotificationReceipt,
} from './channel.js';
import type {
  DeliveryDestination,
  DeliveryDestinationPort,
} from './destinations.js';
import {
  channelUnavailableRetryMilliseconds,
  defaultPreferenceEnabled,
  deliveryBackoffMilliseconds,
  deliveryBatchSize,
  deliveryLeaseMilliseconds,
  isMandatoryCategory,
  isRetryableFailure,
  isTerminal,
  maximumDeliveryAttempts,
  notificationTemplateByKey,
  type NotificationChannel,
  type NotificationState,
  type NotificationTemplate,
  type SuppressionReason,
} from './policy.js';
import type {
  NotificationIntentRow,
  NotificationRepository,
} from './repository.js';
import type {
  NotificationSafetyPort,
  RecipientStandingPort,
} from './safety.js';

export type DeliveryOutcome =
  | { readonly intentId: string; readonly kind: 'delivered' }
  | {
      readonly intentId: string;
      readonly kind: 'suppressed';
      readonly reason: SuppressionReason;
    }
  | { readonly intentId: string; readonly kind: 'retry' }
  | { readonly intentId: string; readonly kind: 'dead_letter' }
  /** No channel is configured. Nothing was attempted and nothing was spent. */
  | { readonly intentId: string; readonly kind: 'channel_unavailable' }
  /** Already terminal, not yet due, or claimed by another worker. */
  | { readonly intentId: string; readonly kind: 'skipped' };

type ClaimResult =
  | {
      readonly destinations: readonly DeliveryDestination[];
      readonly kind: 'claimed';
      readonly intent: NotificationIntentRow;
      readonly template: NotificationTemplate;
    }
  | { readonly kind: 'suppressed'; readonly reason: SuppressionReason }
  | { readonly kind: 'skipped' };

export interface NotificationDeliveryDependencies {
  readonly channel: NotificationChannelPort;
  readonly destinations: DeliveryDestinationPort;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  /** Identifies this worker's claims. Survives in the row, not in memory. */
  readonly owner: string;
  readonly repository: NotificationRepository;
  readonly safety: NotificationSafetyPort;
  readonly standing: RecipientStandingPort;
}

/**
 * Delivery, and the safety recheck that governs it.
 *
 * A notification is queued because something happened and delivered because the
 * recipient may still be told. Those are different moments. Between them the
 * recipient can block the person the notice is about, or the account can be
 * restricted, and a notice evaluated only at queue time would sail straight
 * past both. So the last thing that happens before the external call is a fresh
 * read of TRUST & SAFETY's and USERS' published contracts — not a cached
 * verdict, not the one intake took.
 *
 * The ordering is the guarantee, and it is worth being exact about what it does
 * and does not buy:
 *
 * 1. The pair lock is taken first, then the intent row is locked, then the
 *    recheck is read, then the claim is written — all in one transaction, in
 *    the lock order `src/database/pair-lock.ts` requires. A block committing
 *    concurrently therefore either precedes this transaction, in which case the
 *    recheck sees it and the notice is suppressed, or waits for it. There is no
 *    interleaving in which the block commits *during* the check.
 * 2. The provider call happens after that transaction commits, never inside it.
 *    Holding a transaction open across somebody else's network would put a row
 *    lock behind a timeout nobody here controls.
 * 3. That leaves one window: a block committing after the claim commits and
 *    before the provider call returns. It cannot be closed by any arrangement
 *    of this code, because the send is already in flight. It is bounded by the
 *    length of one HTTP call, and everything still queued for that pair is
 *    suppressed on its own next claim.
 *
 * A suppressed notice never reaches the channel. That is asserted by tests
 * rather than assumed, because "we checked first" and "we did not send" are
 * different claims and only the second one matters to the person who blocked
 * somebody.
 */
export class NotificationDeliveryService {
  constructor(
    private readonly dependencies: NotificationDeliveryDependencies,
  ) {}

  /**
   * Delivers everything currently due.
   *
   * This is the recovery path as much as the normal one. It reads from
   * PostgreSQL, which holds the truth, so it picks up notices whose queue
   * wake-up was never enqueued, was lost with a Redis flush, or belonged to a
   * worker that died holding the claim.
   */
  async deliverDue(
    limit = deliveryBatchSize,
  ): Promise<readonly DeliveryOutcome[]> {
    const due = await this.dependencies.repository.listDue(
      this.dependencies.repository.transactionless,
      { limit, now: this.dependencies.now() },
    );
    const outcomes: DeliveryOutcome[] = [];
    // Sequential on purpose. Each delivery takes a pair lock and calls a
    // provider; fanning the whole batch out at once would multiply both against
    // a connection pool sized for request traffic.
    for (const intent of due) outcomes.push(await this.deliver(intent.id));
    return outcomes;
  }

  /**
   * Delivers one notice, or suppresses it.
   *
   * Safe to call twice, from a queue wake-up and a sweeper at the same time:
   * the claim is a compare-and-set under a row lock, so the loser is `skipped`.
   */
  async deliver(intentId: string): Promise<DeliveryOutcome> {
    const hint = await this.dependencies.repository.findById(
      this.dependencies.repository.transactionless,
      intentId,
    );
    // The hint is only used to learn who the pair lock is for. Everything is
    // re-read under the lock, so a stale hint costs a wasted lock and never a
    // wrong decision.
    if (hint === undefined) return { intentId, kind: 'skipped' };
    if (isTerminal(hint.state as NotificationState)) {
      return { intentId, kind: 'skipped' };
    }

    const claim = await this.claim(hint);
    if (claim.kind === 'skipped') return { intentId, kind: 'skipped' };
    if (claim.kind === 'suppressed') {
      return { intentId, kind: 'suppressed', reason: claim.reason };
    }

    const receipt = await this.send(
      claim.intent,
      claim.template.channel,
      claim.destinations,
    );
    return this.settle(claim.intent, claim.template.channel, receipt);
  }

  /**
   * Takes the claim, having first established that the notice may still be
   * delivered. One transaction: pair lock, row lock, recheck, claim.
   */
  private async claim(hint: NotificationIntentRow): Promise<ClaimResult> {
    const now = this.dependencies.now();
    const template = notificationTemplateByKey[hint.templateKey];
    if (template === undefined) {
      // A stored notice whose template no longer exists cannot be evaluated, so
      // it is not sent. Loud, because it means a template was removed while
      // notices referencing it were still owed.
      this.dependencies.logger.error(
        { intentId: hint.id, templateKey: hint.templateKey },
        'notification references an unknown template',
      );
      return { kind: 'skipped' };
    }

    return this.dependencies.repository.transaction(
      async (executor): Promise<ClaimResult> => {
        // Ordering rule: pair lock, then row lock. Every transaction that takes
        // both takes them in this order, so the lock graph stays acyclic.
        if (hint.subjectId !== null) {
          await lockPair(executor, hint.recipientId, hint.subjectId);
        }
        const locked = await this.dependencies.repository.lockClaimable(
          executor,
          { id: hint.id, now },
        );
        if (locked === undefined) return { kind: 'skipped' };

        // Claimed before it is evaluated, so a suppression is recorded by the
        // same worker that holds the row and cannot be written over a claim
        // somebody else took.
        const claimed = await this.dependencies.repository.claim(executor, {
          expectedVersion: locked.version,
          id: locked.id,
          leaseExpiresAt: new Date(now.getTime() + deliveryLeaseMilliseconds),
          now,
          owner: this.dependencies.owner,
        });
        if (claimed === undefined) return { kind: 'skipped' };

        const evaluated = await this.evaluate(executor, claimed, template, now);
        if (evaluated.reason !== undefined) {
          await this.recordSuppression(
            executor,
            claimed,
            template.channel,
            evaluated.reason,
            now,
          );
          return { kind: 'suppressed', reason: evaluated.reason };
        }
        return {
          destinations: evaluated.destinations,
          intent: claimed,
          kind: 'claimed',
          template,
        };
      },
    );
  }

  /**
   * The delivery-time evaluation. Returns why this notice must not be sent, or
   * nothing if it may be.
   *
   * Read inside the claiming transaction, on the caller's executor. A check
   * that committed separately from the claim it authorizes is not a check.
   */
  private async evaluate(
    executor: TransactionHandle,
    intent: NotificationIntentRow,
    template: NotificationTemplate,
    now: Date,
  ): Promise<{
    readonly destinations: readonly DeliveryDestination[];
    readonly reason: SuppressionReason | undefined;
  }> {
    const reason = await this.suppressionFor(executor, intent, template, now);
    if (reason !== undefined) return { destinations: [], reason };

    // Read here rather than remembered from when the notice was created, for
    // the same reason the safety recheck is: a device registered last week may
    // have been retired since, and a notice aimed at a retired registration is
    // one nobody receives.
    const destinations = await this.dependencies.destinations.resolve({
      channel: template.channel,
      executor,
      recipientId: intent.recipientId,
    });
    // Nowhere to send it is a suppression, not a failure: nothing was wrong
    // and nobody was asked. It is also what stops the delivered path from
    // lying, because a channel reporting success for a recipient with no
    // destination would be reporting that somebody was reached who could not
    // have been.
    if (destinations.length === 0) {
      return { destinations: [], reason: 'destination_unavailable' };
    }
    return { destinations, reason: undefined };
  }

  private async suppressionFor(
    executor: TransactionHandle,
    intent: NotificationIntentRow,
    template: NotificationTemplate,
    now: Date,
  ): Promise<SuppressionReason | undefined> {
    // A notice about something too old to matter is suppressed rather than
    // delivered late. It is still recorded, so nothing disappears.
    if (intent.expiresAt.getTime() <= now.getTime()) return 'expired';

    if (
      !(await this.dependencies.standing.isDeliverable({
        executor,
        userId: intent.recipientId,
      }))
    ) {
      return 'recipient_not_deliverable';
    }

    if (template.requiresPairEligibility) {
      // A template that depends on a pair, on a notice with no subject, cannot
      // be evaluated — and an unevaluable safety condition fails closed.
      if (intent.subjectId === null) return 'safety_block';
      if (
        !(await this.dependencies.safety.mayInteract({
          executor,
          first: intent.recipientId,
          now,
          second: intent.subjectId,
        }))
      ) {
        return 'safety_block';
      }
    }

    return this.preferenceSuppression(executor, intent, template);
  }

  /**
   * What the recipient asked for, evaluated last on purpose.
   *
   * The platform's own obligations are settled first: whether the notice is
   * still current, whether this account may be contacted at all, and whether
   * these two people may still interact. Only then is the person's own choice
   * consulted. The ordering decides which reason an operator sees when more
   * than one applies, and a block is the more consequential fact — recording
   * `recipient_opted_out` over a block would hide the block.
   */
  private async preferenceSuppression(
    executor: TransactionHandle,
    intent: NotificationIntentRow,
    template: NotificationTemplate,
  ): Promise<SuppressionReason | undefined> {
    // A mandatory category is not an offer, so there is nothing to consult.
    // The preferences table refuses to store a disabled row for one of these,
    // so this is the second of two defences rather than the only one.
    if (isMandatoryCategory(template.category)) return undefined;

    const stored = await this.dependencies.repository.preferenceFor(executor, {
      category: template.category,
      channel: template.channel,
      recipientId: intent.recipientId,
    });
    // No row means never asked, which is not the same as off.
    const enabled = stored ?? defaultPreferenceEnabled(template.category);
    return enabled ? undefined : 'recipient_opted_out';
  }

  private async recordSuppression(
    executor: TransactionHandle,
    intent: NotificationIntentRow,
    channel: NotificationChannel,
    reason: SuppressionReason,
    now: Date,
  ): Promise<void> {
    await this.dependencies.repository.insertAttempt(executor, {
      attemptNumber: intent.attempts,
      channel,
      // A suppression is a decision this platform made, not a failure a
      // provider reported, so it carries no failure class.
      failureClass: null,
      failureReason: null,
      intentId: intent.id,
      now,
      outcome: 'suppressed',
      providerReference: null,
    });
    await this.dependencies.repository.settleSuppressed(executor, {
      id: intent.id,
      now,
      owner: this.dependencies.owner,
      reason,
    });
  }

  /**
   * The external call. Outside every transaction, and the only place in this
   * domain that talks to anybody else's network.
   */
  private async send(
    intent: NotificationIntentRow,
    channel: NotificationChannel,
    destinations: readonly DeliveryDestination[],
  ): Promise<NotificationReceipt> {
    try {
      return await this.dependencies.channel.deliver({
        channel,
        destinations,
        // Stable for the life of the notice, so a provider honouring it
        // collapses this side's retries into one send.
        idempotencyKey: intent.id,
        payload: intent.payload as Readonly<Record<string, unknown>>,
        recipientId: intent.recipientId,
        templateKey: intent.templateKey,
      });
    } catch (error) {
      this.dependencies.logger.warn(
        { error, intentId: intent.id },
        'notification channel raised',
      );
      // A raised adapter told us nothing about the destination, only that the
      // call did not complete. That is a transport failure and keeps its
      // budget; inferring anything stronger from an exception would retire a
      // notice over a bug on this side.
      return {
        failureClass: 'transport',
        kind: 'failed',
        reason: 'channel_error',
      };
    }
  }

  private async settle(
    intent: NotificationIntentRow,
    channel: NotificationChannel,
    receipt: NotificationReceipt,
  ): Promise<DeliveryOutcome> {
    const now = this.dependencies.now();

    if (receipt.kind === 'unavailable') {
      // Nothing was asked of anybody, so nothing is spent: the attempt count is
      // returned to what it was and the notice stays owed. This is what a
      // deployed environment does today, and it is why an approved provider can
      // be switched on without a backlog of notices having quietly expired.
      await this.dependencies.repository.releaseUnattempted(
        this.dependencies.repository.transactionless,
        {
          attempts: Math.max(0, intent.attempts - 1),
          id: intent.id,
          nextAttemptAt: new Date(
            now.getTime() + channelUnavailableRetryMilliseconds,
          ),
          now,
          owner: this.dependencies.owner,
        },
      );
      return { intentId: intent.id, kind: 'channel_unavailable' };
    }

    if (receipt.kind === 'delivered') {
      const settled = await this.dependencies.repository.transaction(
        async (executor) => {
          await this.dependencies.repository.insertAttempt(executor, {
            attemptNumber: intent.attempts,
            channel,
            failureClass: null,
            failureReason: null,
            intentId: intent.id,
            now,
            outcome: 'delivered',
            providerReference: receipt.providerReference,
          });
          return this.dependencies.repository.settleDelivered(executor, {
            id: intent.id,
            now,
            owner: this.dependencies.owner,
          });
        },
      );
      if (settled === undefined) return this.lostLease(intent);
      return { intentId: intent.id, kind: 'delivered' };
    }

    // Two independent reasons to stop, and they are not the same reason.
    // Exhausting the budget means every attempt so far failed in a way that
    // might have worked; a terminal class means trying again could never work,
    // whatever budget remains. A hard bounce retried five more times is five
    // more messages to a mailbox that does not exist, which is how a sender
    // reputation is lost rather than how a notice is delivered.
    const terminalClass = !isRetryableFailure(receipt.failureClass);
    const exhausted = intent.attempts >= maximumDeliveryAttempts;
    const deadLetter = terminalClass || exhausted;
    const settled = await this.dependencies.repository.transaction(
      async (executor) => {
        await this.dependencies.repository.insertAttempt(executor, {
          attemptNumber: intent.attempts,
          channel,
          failureClass: receipt.failureClass,
          failureReason: receipt.reason,
          intentId: intent.id,
          now,
          outcome: 'failed',
          providerReference: null,
        });
        return this.dependencies.repository.settleFailed(executor, {
          deadLetter,
          id: intent.id,
          nextAttemptAt: new Date(
            now.getTime() + deliveryBackoffMilliseconds(intent.attempts),
          ),
          now,
          owner: this.dependencies.owner,
          // The class outranks the budget, because it is the more specific
          // fact. "attempts_exhausted" on a hard bounce would misreport why
          // the platform stopped to whoever reads the row later.
          reason: terminalClass
            ? receipt.failureClass
            : exhausted
              ? 'attempts_exhausted'
              : receipt.reason,
        });
      },
    );
    if (settled === undefined) return this.lostLease(intent);

    if (deadLetter) {
      // Loud on purpose: a retired notice is something the platform owed a
      // person and did not deliver. The row keeps its payload for repair.
      this.dependencies.logger.error(
        {
          attempts: intent.attempts,
          failureClass: receipt.failureClass,
          intentId: intent.id,
          templateKey: intent.templateKey,
          terminalClass,
        },
        'notification dead-lettered',
      );
      return { intentId: intent.id, kind: 'dead_letter' };
    }
    return { intentId: intent.id, kind: 'retry' };
  }

  /**
   * The claim expired while the provider call was in flight and another worker
   * owns the row now. The send stands; the other worker's attempt will carry
   * the same idempotency key, so a provider honouring it does not send twice.
   */
  private lostLease(intent: NotificationIntentRow): DeliveryOutcome {
    this.dependencies.logger.warn(
      { intentId: intent.id },
      'notification lease expired before the outcome was recorded',
    );
    return { intentId: intent.id, kind: 'retry' };
  }
}
