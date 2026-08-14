import type { Executor } from '../database/executor.js';
import type { UserAccountRow, UsersRepository } from './repository.js';

/**
 * The account-standing change USERS publishes for enforcement.
 *
 * An account's lifecycle state is USERS' truth. TRUST & SAFETY decides that an
 * account should be restricted; it does not decide what "restricted" means, and
 * it does not write to `users_accounts`. This contract is the whole of what an
 * enforcement decision may do to an account, which is deliberately narrow: it
 * cannot delete, cannot rename, cannot change a region, and cannot read a
 * profile.
 *
 * The reason recorded is the coarse one USERS already publishes. A peer must
 * never learn another account's restriction cause, so the finer finding stays
 * with the enforcement record in TRUST & SAFETY.
 */
export interface ConsumerEnforcementPort {
  /**
   * Restricts an account. Idempotent: an account already restricted is
   * reported as restricted rather than failing, because an enforcement decision
   * repeated is the same decision.
   */
  restrict(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<UserAccountRow | undefined>;

  /**
   * Returns a restricted account to active standing after review.
   *
   * Only from `restricted`, and only to `active`: this is the reversal of the
   * method above and not a general way to set an account's state.
   */
  restore(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<UserAccountRow | undefined>;
}

export class ConsumerEnforcement implements ConsumerEnforcementPort {
  constructor(private readonly repository: UsersRepository) {}

  async restrict(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<UserAccountRow | undefined> {
    const transitioned = await this.repository.transitionAccountStatus(
      input.executor,
      {
        expectedStatus: 'active',
        now: input.now,
        status: 'restricted',
        statusReason: 'safety_enforcement',
        userId: input.userId,
      },
    );
    if (transitioned !== undefined) return transitioned;
    // Losing the compare-and-set means the account was not active. An account
    // already restricted is the outcome this asked for, so it is reported as
    // success; any other state is a change this contract may not make.
    const current = await this.repository.findById(
      input.executor,
      input.userId,
    );
    return current?.status === 'restricted' ? current : undefined;
  }

  restore(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<UserAccountRow | undefined> {
    return this.repository.transitionAccountStatus(input.executor, {
      expectedStatus: 'restricted',
      now: input.now,
      status: 'active',
      statusReason: null,
      userId: input.userId,
    });
  }
}
