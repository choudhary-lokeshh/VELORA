import type { Executor } from '../database/executor.js';

/**
 * The two answers NOTIFICATIONS needs and does not own.
 *
 * A notification is queued because something happened. It is *delivered*
 * because the person may still be told — and those are different moments, often
 * minutes apart. In between, the recipient may have blocked the person the
 * notice is about, or the account may have been restricted. Neither of those is
 * a NOTIFICATIONS decision, and neither may be cached: `docs/domains/
 * notifications.md` makes suppression a delivery-time evaluation for exactly
 * this reason.
 *
 * Both ports take the caller's executor. The recheck runs inside the same
 * transaction that claims the intent for delivery, under the pair lock, so a
 * block committing concurrently either precedes the claim — and suppresses the
 * notice — or waits for it. A check taken on a separate handle would leave the
 * window this design exists to remove.
 */
export interface NotificationSafetyPort {
  /** Whether these two people may still interact right now. */
  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;

  /**
   * Which of these subjects the viewer may not interact with.
   *
   * The in-app feed asks this instead of `mayInteract` per row, for the same
   * reason discovery does: a bounded batch keeps the number of safety
   * relationships out of the query plan. It is asked on every read rather than
   * stored, so a block takes effect on the next page load and a withdrawn one
   * does too — the feed shows what is true now, not what was true when the
   * line was written.
   */
  blockedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly executor: Executor;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>>;
}

/**
 * Whether an account is in a state that receives notices at all.
 *
 * Owned by USERS. A restricted, suspended, or deleted account does not keep
 * receiving pushes about a platform it is no longer using, and NOTIFICATIONS
 * must not decide what those words mean.
 */
export interface RecipientStandingPort {
  isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean>;
}

/**
 * Denies every pair.
 *
 * The fail-closed stand-in for a missing safety contract. A composition that
 * cannot supply the real one gets a notifications runtime that suppresses
 * everything, because a delivery-time safety check that is absent must read as
 * "not permitted" and never as "permitted".
 */
export class UnavailableNotificationSafety implements NotificationSafetyPort {
  mayInteract(): Promise<boolean> {
    return Promise.resolve(false);
  }

  blockedAmong(input: {
    readonly candidateIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(input.candidateIds));
  }
}

/** The same posture for recipient standing. */
export class UnavailableRecipientStanding implements RecipientStandingPort {
  isDeliverable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
