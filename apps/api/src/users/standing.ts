import type { Executor } from '../database/executor.js';
import type { UsersRepository } from './repository.js';

/**
 * Whether an account is currently in a state that may be contacted.
 *
 * USERS owns account lifecycle, so it owns this answer. NOTIFICATIONS needs it
 * immediately before an external send — an account restricted after a notice
 * was queued must not receive it — and must not learn anything else about the
 * account in order to get it. So the contract answers with a boolean: no
 * status, no reason, no timestamps. A caller that could read the status could
 * infer an enforcement decision from a delivery path, which is not a place
 * enforcement should ever be visible.
 *
 * The executor is the caller's, so the answer can be taken inside the
 * transaction that claims the notice for delivery. A standing check that
 * commits separately from the claim it authorizes is not a check.
 */
export interface ConsumerStandingPort {
  isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean>;
}

export class ConsumerStanding implements ConsumerStandingPort {
  constructor(private readonly repository: UsersRepository) {}

  async isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean> {
    const account = await this.repository.findById(
      input.executor,
      input.userId,
    );
    // An account that does not exist, is restricted, or is in any other
    // non-active state is not contacted. Fail closed: an unknown identifier is
    // not a reason to send somebody a push.
    return account?.status === 'active';
  }
}
