import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import type { CreatorProfilePublication } from './handle-policy.js';
import {
  creatorAccounts,
  creatorPolicyAcknowledgements,
  creatorProfileLinks,
  creatorProfiles,
  type CreatorAccountStatus,
  type CreatorAccountStatusReason,
  type CreatorPolicyKey,
} from './schema.js';

export type CreatorsDatabase = BunSQLDatabase;
export type CreatorsExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = CreatorsDatabase | CreatorsExecutor;

export type CreatorAccountRow = typeof creatorAccounts.$inferSelect;
export type CreatorPolicyAcknowledgementRow =
  typeof creatorPolicyAcknowledgements.$inferSelect;

/**
 * Every CREATORS read and write. PostgreSQL is the authority for creator
 * capability existence and lifecycle state; nothing here consults a cache, and
 * no other domain reaches these tables.
 */
export class CreatorsRepository {
  constructor(private readonly database: CreatorsDatabase) {}

  /** For reads and single-statement writes that need no transaction. */
  get transactionless(): CreatorsDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: CreatorsExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async findByAuthAccountId(
    executor: AnyExecutor,
    authAccountId: string,
  ): Promise<CreatorAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(creatorAccounts)
      .where(eq(creatorAccounts.authAccountId, authAccountId))
      .limit(1);
    return rows[0];
  }

  async findById(
    executor: AnyExecutor,
    id: string,
  ): Promise<CreatorAccountRow | undefined> {
    const rows = await executor
      .select()
      .from(creatorAccounts)
      .where(eq(creatorAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Creates the creator capability for an AUTH principal, or returns nothing
   * when one already exists.
   *
   * The unique index on `auth_account_id` is what makes concurrent first calls
   * converge on a single row: the loser's insert is discarded by the conflict
   * clause rather than by a read that could race. No lock is taken, because a
   * unique constraint already expresses the invariant and an advisory lock
   * would only add a way to get it wrong.
   */
  async insertIfAbsent(
    executor: AnyExecutor,
    input: {
      readonly authAccountId: string;
      readonly now: Date;
      readonly status: CreatorAccountStatus;
      readonly statusReason: CreatorAccountStatusReason | null;
    },
  ): Promise<CreatorAccountRow | undefined> {
    const inserted = await executor
      .insert(creatorAccounts)
      .values({
        authAccountId: input.authAccountId,
        createdAt: input.now,
        id: crypto.randomUUID(),
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: creatorAccounts.authAccountId })
      .returning();
    return inserted[0];
  }

  /**
   * Moves a creator capability between states, only from the state the caller
   * believed it was in.
   *
   * The expected status in the predicate is what makes concurrent transitions
   * safe without a lock: two callers racing to activate the same applicant both
   * write, one matches and one does not, and the loser gets `undefined` rather
   * than overwriting a decision it never saw. A read-then-write would have had
   * a gap between the two where either could win.
   */
  async transitionStatus(
    executor: AnyExecutor,
    input: {
      readonly activatedAt?: Date | undefined;
      readonly closedAt?: Date | undefined;
      readonly creatorId: string;
      readonly expectedStatus: CreatorAccountStatus;
      readonly now: Date;
      readonly status: CreatorAccountStatus;
      readonly statusReason: CreatorAccountStatusReason | null;
      readonly suspendedAt?: Date | undefined;
    },
  ): Promise<CreatorAccountRow | undefined> {
    const updated = await executor
      .update(creatorAccounts)
      .set({
        ...(input.activatedAt === undefined
          ? {}
          : { activatedAt: input.activatedAt }),
        ...(input.closedAt === undefined ? {} : { closedAt: input.closedAt }),
        status: input.status,
        statusChangedAt: input.now,
        statusReason: input.statusReason,
        ...(input.suspendedAt === undefined
          ? {}
          : { suspendedAt: input.suspendedAt }),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(creatorAccounts.id, input.creatorId),
          eq(creatorAccounts.status, input.expectedStatus),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Records acknowledgement evidence. A version already acknowledged is left
   * exactly as it was: re-submitting must never rewrite when a person agreed.
   */
  async recordPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly acknowledgedAt: Date;
      readonly audience: string;
      readonly creatorId: string;
      readonly documents: readonly {
        readonly key: CreatorPolicyKey;
        readonly version: string;
      }[];
    },
  ): Promise<void> {
    if (input.documents.length === 0) return;
    await executor
      .insert(creatorPolicyAcknowledgements)
      .values(
        input.documents.map((document) => ({
          acknowledgedAt: input.acknowledgedAt,
          audience: input.audience,
          creatorId: input.creatorId,
          policyKey: document.key,
          policyVersion: document.version,
        })),
      )
      .onConflictDoNothing({
        target: [
          creatorPolicyAcknowledgements.creatorId,
          creatorPolicyAcknowledgements.policyKey,
          creatorPolicyAcknowledgements.policyVersion,
        ],
      });
  }

  /** Acknowledgements the capability holds for the named policy keys. */
  async findPolicyAcknowledgements(
    executor: AnyExecutor,
    input: {
      readonly creatorId: string;
      readonly keys: readonly CreatorPolicyKey[];
    },
  ): Promise<CreatorPolicyAcknowledgementRow[]> {
    if (input.keys.length === 0) return [];
    return executor
      .select()
      .from(creatorPolicyAcknowledgements)
      .where(
        and(
          eq(creatorPolicyAcknowledgements.creatorId, input.creatorId),
          inArray(creatorPolicyAcknowledgements.policyKey, [...input.keys]),
        ),
      );
  }
}

export type CreatorProfileRow = typeof creatorProfiles.$inferSelect;
export type CreatorProfileLinkRow = typeof creatorProfileLinks.$inferSelect;

/** A profile and its links, which are always read and written together. */
export interface CreatorProfileRecord {
  readonly links: readonly CreatorProfileLinkRow[];
  readonly profile: CreatorProfileRow;
}

export interface CreatorProfileInput {
  readonly bio: string | null;
  readonly displayName: string;
  readonly links: readonly {
    readonly label: string | null;
    readonly url: string;
  }[];
}

/**
 * Reads and writes for the creator's public identity.
 *
 * A profile and its links are one unit: a save that replaced the row and then
 * failed on the links would leave a page nobody chose. Every write below that
 * touches both does so in one transaction, and none of them calls anything
 * outside this domain while it is open.
 */
export class CreatorProfileRepository {
  constructor(private readonly database: CreatorsDatabase) {}

  get transactionless(): CreatorsDatabase {
    return this.database;
  }

  async findByCreatorId(
    executor: AnyExecutor,
    creatorId: string,
  ): Promise<CreatorProfileRecord | undefined> {
    const rows = await executor
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.creatorId, creatorId))
      .limit(1);
    const profile = rows[0];
    if (profile === undefined) return undefined;
    return { links: await this.linksFor(executor, creatorId), profile };
  }

  /**
   * The published profile for a canonical handle, joined to the capability so
   * one statement answers both halves of "is this page public".
   *
   * A creator whose capability is not active has no public page, and asking in
   * two statements would leave a window where a suspension had landed between
   * them. It is deliberately not parameterized by publication state: a caller
   * that could ask for a draft by handle would be a caller that could enumerate
   * unpublished creators.
   */
  async findPublishedByHandle(
    executor: AnyExecutor,
    handle: string,
  ): Promise<CreatorProfileRecord | undefined> {
    const rows = await executor
      .select({ profile: creatorProfiles })
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
          eq(creatorProfiles.handle, handle),
          eq(creatorProfiles.publication, 'published'),
        ),
      )
      .limit(1);
    const profile = rows[0]?.profile;
    if (profile === undefined) return undefined;
    return {
      links: await this.linksFor(executor, profile.creatorId),
      profile,
    };
  }

  private async linksFor(
    executor: AnyExecutor,
    creatorId: string,
  ): Promise<CreatorProfileLinkRow[]> {
    return executor
      .select()
      .from(creatorProfileLinks)
      .where(eq(creatorProfileLinks.creatorId, creatorId))
      .orderBy(asc(creatorProfileLinks.position));
  }

  /**
   * Claims a handle and creates the draft profile, or reports that it could not.
   *
   * The unique index on the canonical handle is what decides a contested claim.
   * Fifty simultaneous requests for the same name all reach this insert; one
   * commits and the rest are told the name is taken, which is the same answer
   * they would get a second later from somebody who was simply first.
   */
  async insertProfile(input: {
    readonly creatorId: string;
    readonly handle: string;
    readonly now: Date;
    readonly profile: CreatorProfileInput;
  }): Promise<CreatorProfileRecord | undefined> {
    return this.database.transaction(async (executor) => {
      const inserted = await executor
        .insert(creatorProfiles)
        .values({
          bio: input.profile.bio,
          createdAt: input.now,
          creatorId: input.creatorId,
          displayName: input.profile.displayName,
          handle: input.handle,
          publication: 'draft',
          updatedAt: input.now,
          version: 1,
        })
        .onConflictDoNothing()
        .returning();
      const profile = inserted[0];
      if (profile === undefined) return undefined;
      await this.replaceLinks(executor, input.creatorId, input.profile.links);
      return { links: await this.linksFor(executor, input.creatorId), profile };
    });
  }

  /**
   * Applies an edit only to the version the caller actually read.
   *
   * The expected version in the predicate is the whole of the concurrency
   * story: two tabs editing the same profile both write, one matches and one
   * does not, and the loser is told to re-read rather than silently discarding
   * an edit it never saw.
   */
  async updateProfile(input: {
    readonly creatorId: string;
    readonly expectedVersion: number;
    readonly now: Date;
    readonly profile: CreatorProfileInput;
  }): Promise<CreatorProfileRecord | undefined> {
    return this.database.transaction(async (executor) => {
      const updated = await executor
        .update(creatorProfiles)
        .set({
          bio: input.profile.bio,
          displayName: input.profile.displayName,
          updatedAt: input.now,
          version: sql`${creatorProfiles.version} + 1`,
        })
        .where(
          and(
            eq(creatorProfiles.creatorId, input.creatorId),
            eq(creatorProfiles.version, input.expectedVersion),
          ),
        )
        .returning();
      const profile = updated[0];
      if (profile === undefined) return undefined;
      await this.replaceLinks(executor, input.creatorId, input.profile.links);
      return { links: await this.linksFor(executor, input.creatorId), profile };
    });
  }

  /** Sets publication state against the version the caller read. */
  async setPublication(input: {
    readonly creatorId: string;
    readonly expectedVersion: number;
    readonly now: Date;
    readonly publication: CreatorProfilePublication;
  }): Promise<CreatorProfileRecord | undefined> {
    const updated = await this.database
      .update(creatorProfiles)
      .set({
        publication: input.publication,
        // Unpublishing clears the instant, because the constraint keeps the two
        // consistent and a draft that still claimed a publication moment would
        // be a page that says it is public while it is not.
        publishedAt: input.publication === 'published' ? input.now : null,
        updatedAt: input.now,
        version: sql`${creatorProfiles.version} + 1`,
      })
      .where(
        and(
          eq(creatorProfiles.creatorId, input.creatorId),
          eq(creatorProfiles.version, input.expectedVersion),
        ),
      )
      .returning();
    const profile = updated[0];
    if (profile === undefined) return undefined;
    return {
      links: await this.linksFor(this.database, input.creatorId),
      profile,
    };
  }

  /**
   * Links are replaced wholesale rather than merged. A creator editing their
   * page supplies the list they want; reconciling additions and removals would
   * invent an intent the request does not carry.
   */
  private async replaceLinks(
    executor: CreatorsExecutor,
    creatorId: string,
    links: readonly { readonly label: string | null; readonly url: string }[],
  ): Promise<void> {
    await executor
      .delete(creatorProfileLinks)
      .where(eq(creatorProfileLinks.creatorId, creatorId));
    if (links.length === 0) return;
    await executor.insert(creatorProfileLinks).values(
      links.map((link, position) => ({
        creatorId,
        label: link.label,
        position,
        url: link.url,
      })),
    );
  }
}
