import type { Executor } from '../database/executor.js';

/**
 * The safety answer DISCOVERY needs and does not own.
 *
 * Whether two people may interact is a TRUST & SAFETY decision. DISCOVERY
 * declares the shape it needs here — the dependency points from the consumer to
 * the contract — and the published safety directory satisfies it.
 *
 * Two questions, because the feed and a single decision have genuinely
 * different shapes. A feed asks about a bounded batch, so no count of a
 * person's safety relationships enters its query plan. A signal asks about one
 * pair, inside the transaction that writes, so the answer and the write commit
 * together.
 */
export interface CandidateSafetyPort {
  blockedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly executor: Executor;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>>;

  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}
