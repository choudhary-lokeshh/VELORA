import { and, eq, inArray } from 'drizzle-orm';

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

  /**
   * Public handles for creators a caller already legitimately references.
   *
   * Bounded by the batch, and answered only for creators whose page is
   * published: a member holding an entitlement needs somewhere to go, and a
   * creator who has withdrawn their page has not offered one. A creator with no
   * published handle is simply absent from the result rather than reported as
   * hidden.
   */
  handlesFor(input: {
    readonly creatorIds: readonly string[];
    readonly executor: Executor;
  }): Promise<ReadonlyMap<string, string>>;

  /**
   * Which country this creator operates from, or nothing.
   *
   * CREATORS holds no country of its own: a creator is a person, and where that
   * person is, is USERS' fact. This asks USERS through its published standing
   * contract rather than reading `users_`, and answers nothing when the person
   * has not told Velora — which is a state commerce eligibility must refuse
   * rather than fill in.
   */
  operatingCountryFor(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<string | undefined>;
}

export class CreatorDirectory implements CreatorDirectoryPort {
  /**
   * The standing contract is optional so a composition that has no use for the
   * country question — the worker, which serves no creator route — is not
   * forced to build one. Absent, the answer is absent, which refuses.
   */
  constructor(
    private readonly standing?: {
      standingForAuthAccount(input: {
        readonly authAccountId: string;
        readonly executor: Executor;
        readonly now: Date;
      }): Promise<{ readonly region: string | undefined } | undefined>;
    },
  ) {}

  async operatingCountryFor(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<string | undefined> {
    if (this.standing === undefined) return undefined;
    const rows = await input.executor
      .select({ authAccountId: creatorAccounts.authAccountId })
      .from(creatorAccounts)
      .where(eq(creatorAccounts.id, input.creatorId))
      .limit(1);
    const authAccountId = rows[0]?.authAccountId;
    if (authAccountId === undefined) return undefined;
    const standing = await this.standing.standingForAuthAccount({
      authAccountId,
      executor: input.executor,
      now: input.now,
    });
    return standing?.region;
  }

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

  async handlesFor(input: {
    readonly creatorIds: readonly string[];
    readonly executor: Executor;
  }): Promise<ReadonlyMap<string, string>> {
    if (input.creatorIds.length === 0) return new Map();
    const rows = await input.executor
      .select({
        creatorId: creatorProfiles.creatorId,
        handle: creatorProfiles.handle,
      })
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
          inArray(creatorProfiles.creatorId, [...input.creatorIds]),
          eq(creatorProfiles.publication, 'published'),
        ),
      );
    return new Map(rows.map((row) => [row.creatorId, row.handle]));
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
