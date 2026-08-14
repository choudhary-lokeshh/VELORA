import type { UserAccountRow, UsersRepository } from './repository.js';

export interface UsersServiceDependencies {
  readonly now: () => Date;
  readonly repository: UsersRepository;
}

/**
 * USERS application service.
 *
 * Every method takes the AUTH account identifier the server derived from the
 * presented credential. None of them accepts a consumer account identifier from
 * a caller, which is what makes it structurally impossible for a client to
 * address someone else's account through this domain.
 */
export class UsersService {
  constructor(private readonly dependencies: UsersServiceDependencies) {}

  /**
   * Creates or returns the one consumer account for an AUTH account.
   *
   * `docs/flows/onboarding.md` requires this to be idempotent: a duplicate
   * command resolves to the same identity. The insert races on the unique index
   * rather than on a read-then-write, so two simultaneous first calls produce
   * one account and both callers see it.
   */
  async provisionAccount(input: {
    readonly authAccountId: string;
    readonly locale?: string | undefined;
  }): Promise<{ readonly account: UserAccountRow; readonly created: boolean }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();

    const existing = await repository.findByAuthAccountId(
      repository.transactionless,
      input.authAccountId,
    );
    if (existing !== undefined) return { account: existing, created: false };

    const inserted = await repository.insertIfAbsent(
      repository.transactionless,
      {
        authAccountId: input.authAccountId,
        locale: input.locale,
        now,
        // A new consumer account has completed no onboarding gate, so it starts
        // where `docs/flows/consumer-account-profile.md` says it starts.
        status: 'pending_profile',
      },
    );
    if (inserted !== undefined) return { account: inserted, created: true };

    // Another request won the unique index. Its row is the one account.
    const settled = await repository.findByAuthAccountId(
      repository.transactionless,
      input.authAccountId,
    );
    if (settled === undefined) {
      throw new Error('Consumer account insert conflicted with no visible row');
    }
    return { account: settled, created: false };
  }

  async findAccount(
    authAccountId: string,
  ): Promise<UserAccountRow | undefined> {
    const { repository } = this.dependencies;
    return repository.findByAuthAccountId(
      repository.transactionless,
      authAccountId,
    );
  }

  /** Reads by consumer identifier, for callers that already authorized one. */
  async findAccountById(id: string): Promise<UserAccountRow | undefined> {
    const { repository } = this.dependencies;
    return repository.findById(repository.transactionless, id);
  }
}
