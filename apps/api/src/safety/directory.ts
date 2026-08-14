import type { Executor } from '../database/executor.js';
import type { SafetyRepository } from './repository.js';

/**
 * The safety answer TRUST & SAFETY publishes.
 *
 * DISCOVERY, MESSAGING, and later NOTIFICATIONS all need to know whether two
 * people may still interact, and none of them may decide it or read
 * `safety_blocks`. This is the one contract that answers, and it answers with a
 * boolean: no other domain learns who blocked whom, when, or why, because a
 * peer must never be able to infer another person's safety decision.
 *
 * Every method takes the caller's executor. That is not a convenience — a
 * safety check that commits separately from the write it authorizes is not a
 * check, and a caller inside a transaction must be able to ask without needing a
 * second pooled connection. Callers take the pair lock first; see
 * `src/database/pair-lock.ts` for why that is what removes the gap.
 */
export interface SafetyDirectoryPort {
  /** Whether these two people may interact right now. */
  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;

  /**
   * Which of these candidates the viewer may not interact with. Bounded by the
   * batch, so no count of safety relationships enters a feed's query plan.
   */
  blockedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly executor: Executor;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>>;
}

export class SafetyDirectory implements SafetyDirectoryPort {
  constructor(private readonly repository: SafetyRepository) {}

  async mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean> {
    if (input.first === input.second) return true;
    return !(await this.repository.isPairBlocked(input.executor, {
      first: input.first,
      second: input.second,
    }));
  }

  blockedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly executor: Executor;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>> {
    return this.repository.blockedAmong(input.executor, {
      candidateIds: input.candidateIds,
      viewerId: input.viewerId,
    });
  }
}
