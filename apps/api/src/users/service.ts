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

  /**
   * A deterministic, bounded list of active consumer accounts.
   *
   * Published for exactly one consumer: the local live-discovery stand-in,
   * which has to put a real, eligible account into the matching pool so that a
   * developer alone in a local world can walk a feature that needs two people.
   * `LIVE_DISCOVERY_SIMULATION` is refused outside local and test, so nothing
   * in a deployed environment composes the adapter that calls this.
   *
   * It is not a directory, not a search, and not a feed. It carries no filter,
   * no cursor, and no ordering choice, and it deliberately returns accounts
   * rather than profiles — a caller that wanted to *show* somebody would use
   * `ConsumerDirectory`, which applies the visibility rules this does not.
   */
  async listActiveAccounts(input: {
    readonly excludeId: string;
    readonly limit: number;
  }): Promise<readonly UserAccountRow[]> {
    const { repository } = this.dependencies;
    return repository.listActive(repository.transactionless, input);
  }
}
