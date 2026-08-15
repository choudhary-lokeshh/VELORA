import type { Executor } from '../database/executor.js';

/**
 * The creator answers PRIVATE CLUBS needs and does not own.
 *
 * Declared here, where they are consumed, so the dependency points from this
 * domain to a contract rather than from this domain into `creators_`. The
 * published CREATORS directory satisfies it.
 */
export interface ContentCreatorPort {
  /** Public handles for creators the caller already legitimately references. */
  handlesFor(input: {
    readonly creatorIds: readonly string[];
    readonly executor: Executor;
  }): Promise<ReadonlyMap<string, string>>;

  mayOperate(input: {
    readonly executor: Executor;
    readonly creatorId: string;
  }): Promise<boolean>;

  publishedCreatorFor(input: {
    readonly executor: Executor;
    readonly handle: string;
  }): Promise<string | undefined>;
}
