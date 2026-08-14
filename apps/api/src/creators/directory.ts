import { and, eq } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import { canonicalCreatorHandle } from '@velora/validation';
import { creatorAccounts, creatorProfiles } from './schema.js';

/**
 * The creator answer other domains need and may not read.
 *
 * PRIVATE CLUBS has to know which creator a public handle belongs to, and
 * whether a creator may currently operate at all. Neither is its to decide:
 * `docs/architecture/03-domain-boundaries.md` keeps creator identity and
 * eligibility in CREATORS, and lets another domain reference an opaque
 * identifier or call an approved contract, and nothing else.
 *
 * Both answers are deliberately minimal. A caller learns an identifier it can
 * store, or a boolean — never a status, a reason, a profile, or the fact that a
 * creator exists but is suspended.
 *
 * Every method takes the caller's executor, so an eligibility check can be
 * taken inside the transaction it authorizes. A check that commits separately
 * from the write it permits is not a check.
 */
export interface CreatorDirectoryPort {
  /**
   * The creator behind a published public page, or nothing.
   *
   * One answer covers an unknown handle, a profile that is still a draft, and a
   * creator who is not active, because a caller that could tell them apart
   * could enumerate creators who have not published.
   */
  publishedCreatorFor(input: {
    readonly executor: Executor;
    readonly handle: string;
  }): Promise<string | undefined>;

  /** Whether this creator may currently operate on their own catalog. */
  mayOperate(input: {
    readonly executor: Executor;
    readonly creatorId: string;
  }): Promise<boolean>;
}

export class CreatorDirectory implements CreatorDirectoryPort {
  async publishedCreatorFor(input: {
    readonly executor: Executor;
    readonly handle: string;
  }): Promise<string | undefined> {
    const rows = await input.executor
      .select({ creatorId: creatorProfiles.creatorId })
      .from(creatorProfiles)
      .innerJoin(
        creatorAccounts,
        and(
          eq(creatorAccounts.id, creatorProfiles.creatorId),
          eq(creatorAccounts.status, 'active'),
        ),
      )
      .where(
        and(
          eq(creatorProfiles.handle, canonicalCreatorHandle(input.handle)),
          eq(creatorProfiles.publication, 'published'),
        ),
      )
      .limit(1);
    return rows[0]?.creatorId;
  }

  async mayOperate(input: {
    readonly executor: Executor;
    readonly creatorId: string;
  }): Promise<boolean> {
    const rows = await input.executor
      .select({ status: creatorAccounts.status })
      .from(creatorAccounts)
      .where(eq(creatorAccounts.id, input.creatorId))
      .limit(1);
    // Fail closed: an unknown creator is not an operable one.
    return rows[0]?.status === 'active';
  }
}
