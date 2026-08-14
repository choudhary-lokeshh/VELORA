import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import type { CatalogCursor } from './cursor.js';
import type {
  CreatorContentLifecycle,
  CreatorContentVisibility,
} from './policy.js';
import { creatorContent } from './schema.js';

export type ClubsDatabase = BunSQLDatabase;
export type ClubsExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = ClubsDatabase | ClubsExecutor;

export type CreatorContentRow = typeof creatorContent.$inferSelect;

export interface CreatorContentInput {
  readonly body: string | null;
  readonly summary: string | null;
  readonly title: string;
  readonly visibility: CreatorContentVisibility;
}

/**
 * Every PRIVATE CLUBS catalog read and write.
 *
 * Two rules run through all of them. A creator identifier is always part of the
 * predicate, never merely checked afterwards, so a query cannot return
 * somebody else's row and rely on a later comparison to catch it. And every
 * state transition names the state and version it expects, so a concurrent
 * change is refused rather than overwritten.
 */
export class ClubsRepository {
  constructor(private readonly database: ClubsDatabase) {}

  get transactionless(): ClubsDatabase {
    return this.database;
  }

  /**
   * One item belonging to this creator, or nothing.
   *
   * The creator is in the predicate, so an identifier belonging to somebody
   * else is indistinguishable from one that does not exist — which is what
   * makes cross-creator access impossible to express rather than merely
   * checked.
   */
  async findOwn(
    executor: AnyExecutor,
    input: { readonly contentId: string; readonly creatorId: string },
  ): Promise<CreatorContentRow | undefined> {
    const rows = await executor
      .select()
      .from(creatorContent)
      .where(
        and(
          eq(creatorContent.id, input.contentId),
          eq(creatorContent.creatorId, input.creatorId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** One page of this creator's own catalog, newest first, every lifecycle. */
  async listOwn(
    executor: AnyExecutor,
    input: {
      readonly after: CatalogCursor | undefined;
      readonly creatorId: string;
      readonly limit: number;
    },
  ): Promise<CreatorContentRow[]> {
    return executor
      .select()
      .from(creatorContent)
      .where(
        and(
          eq(creatorContent.creatorId, input.creatorId),
          keysetBefore(creatorContent.createdAt, input.after),
        ),
      )
      .orderBy(desc(creatorContent.createdAt), desc(creatorContent.id))
      .limit(input.limit);
  }

  /**
   * One page of what a visitor may see: published, public, newest first.
   *
   * Lifecycle and visibility are in the predicate rather than applied to a page
   * afterwards. A condition applied after paging would change how many results
   * a page holds, and a condition somebody forgets to apply is a draft on the
   * public internet.
   */
  async listPublished(
    executor: AnyExecutor,
    input: {
      readonly after: CatalogCursor | undefined;
      readonly creatorId: string;
      readonly limit: number;
    },
  ): Promise<CreatorContentRow[]> {
    return executor
      .select()
      .from(creatorContent)
      .where(
        and(
          eq(creatorContent.creatorId, input.creatorId),
          eq(creatorContent.lifecycle, 'published'),
          eq(creatorContent.visibility, 'public'),
          keysetBefore(creatorContent.publishedAt, input.after),
        ),
      )
      .orderBy(desc(creatorContent.publishedAt), desc(creatorContent.id))
      .limit(input.limit);
  }

  async insert(
    executor: AnyExecutor,
    input: {
      readonly content: CreatorContentInput;
      readonly creatorId: string;
      readonly now: Date;
    },
  ): Promise<CreatorContentRow> {
    const inserted = await executor
      .insert(creatorContent)
      .values({
        body: input.content.body,
        createdAt: input.now,
        creatorId: input.creatorId,
        id: crypto.randomUUID(),
        // Always a draft. An item that arrived published would be one nobody
        // decided to publish.
        lifecycle: 'draft',
        summary: input.content.summary,
        title: input.content.title,
        updatedAt: input.now,
        version: 1,
        visibility: input.content.visibility,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) throw new Error('Content insert returned no row');
    return row;
  }

  /** Applies an edit only to the version the caller actually read. */
  async update(
    executor: AnyExecutor,
    input: {
      readonly content: CreatorContentInput;
      readonly contentId: string;
      readonly creatorId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ): Promise<CreatorContentRow | undefined> {
    const updated = await executor
      .update(creatorContent)
      .set({
        body: input.content.body,
        summary: input.content.summary,
        title: input.content.title,
        updatedAt: input.now,
        version: sql`${creatorContent.version} + 1`,
        visibility: input.content.visibility,
      })
      .where(
        and(
          eq(creatorContent.id, input.contentId),
          eq(creatorContent.creatorId, input.creatorId),
          eq(creatorContent.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Moves one item between lifecycle states, only from the version the caller
   * read.
   *
   * The version predicate is what makes two simultaneous publish attempts
   * settle as one transition: both write, one matches, and the loser is told to
   * re-read rather than producing a second publication of the same item.
   */
  async transitionLifecycle(
    executor: AnyExecutor,
    input: {
      readonly contentId: string;
      readonly creatorId: string;
      readonly expectedVersion: number;
      readonly lifecycle: CreatorContentLifecycle;
      readonly now: Date;
    },
  ): Promise<CreatorContentRow | undefined> {
    const updated = await executor
      .update(creatorContent)
      .set({
        // Set and cleared together with the lifecycle, because the database
        // constraint requires them consistent and a row claiming a publication
        // instant it no longer has would be a lie the catalog could read.
        archivedAt: input.lifecycle === 'archived' ? input.now : null,
        lifecycle: input.lifecycle,
        publishedAt: input.lifecycle === 'published' ? input.now : null,
        updatedAt: input.now,
        version: sql`${creatorContent.version} + 1`,
      })
      .where(
        and(
          eq(creatorContent.id, input.contentId),
          eq(creatorContent.creatorId, input.creatorId),
          eq(creatorContent.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }
}

/**
 * The keyset predicate both listings share.
 *
 * Strictly after the cursor in the descending order the queries use, with the
 * identifier breaking a tie on the instant. Without the tie-break two items
 * published in the same millisecond would sit either side of a page boundary
 * and one of them would be delivered twice or not at all.
 */
function keysetBefore(
  column: typeof creatorContent.createdAt | typeof creatorContent.publishedAt,
  after: CatalogCursor | undefined,
) {
  if (after === undefined) return undefined;
  return or(
    lt(column, after.moment),
    and(eq(column, after.moment), lt(creatorContent.id, after.id)),
  );
}
