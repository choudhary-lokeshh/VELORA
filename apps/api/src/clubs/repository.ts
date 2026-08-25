import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import type { CatalogCursor } from './cursor.js';
import {
  maximumContentMedia,
  type CreatorContentLifecycle,
  type CreatorContentVisibility,
} from './policy.js';
import { clubs, creatorContent, creatorContentMedia } from './schema.js';

export type ClubsDatabase = BunSQLDatabase;
export type ClubsExecutor = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];
type AnyExecutor = ClubsDatabase | ClubsExecutor;

export type CreatorContentRow = typeof creatorContent.$inferSelect;

export interface CreatorContentInput {
  readonly body: string | null;
  /** The club this item belongs to, if any. */
  readonly clubId: string | null;
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
   *
   * An item scoped to a club is public only when that club is. Without the
   * club condition a creator preparing a room — writing posts inside it before
   * deciding to open it — would have had those posts on their public page the
   * moment they were published, which is exactly the surprise a draft club
   * exists to prevent. Found in the freeze audit.
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
          or(
            isNull(creatorContent.clubId),
            exists(
              executor
                .select({ present: clubs.id })
                .from(clubs)
                .where(
                  and(
                    eq(clubs.id, creatorContent.clubId),
                    eq(clubs.lifecycle, 'published'),
                  ),
                ),
            ),
          ),
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
        clubId: input.content.clubId,
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
        clubId: input.content.clubId,
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

  /**
   * Which images an item is showing, in order.
   *
   * PRIVATE CLUBS owns the attachment, so this is the only place that can
   * answer it. A takedown asks, because withdrawing an item from public view
   * leaves whatever it was showing sitting in a cache until somebody tells the
   * cache — and MEDIA holds the bytes without holding any idea of what they
   * were attached to.
   */
  async listContentMediaAssets(
    executor: AnyExecutor,
    contentId: string,
  ): Promise<readonly string[]> {
    const rows = await executor
      .select({ mediaAssetId: creatorContentMedia.mediaAssetId })
      .from(creatorContentMedia)
      .where(eq(creatorContentMedia.contentId, contentId))
      .orderBy(asc(creatorContentMedia.position));
    return rows.map((row) => row.mediaAssetId);
  }

  /** Attached images for a page of items, in one query rather than per row. */
  async listContentMedia(
    executor: AnyExecutor,
    contentIds: readonly string[],
  ): Promise<
    readonly {
      readonly contentId: string;
      readonly mediaAssetId: string;
      readonly position: number;
    }[]
  > {
    if (contentIds.length === 0) return [];
    return executor
      .select({
        contentId: creatorContentMedia.contentId,
        mediaAssetId: creatorContentMedia.mediaAssetId,
        position: creatorContentMedia.position,
      })
      .from(creatorContentMedia)
      .where(inArray(creatorContentMedia.contentId, [...contentIds]))
      .orderBy(
        asc(creatorContentMedia.contentId),
        asc(creatorContentMedia.position),
      );
  }

  /**
   * The item an asset is attached to, and who owns that item.
   *
   * Used to answer "is this image yours" without a caller naming an item it
   * might not own. The asset column is uniquely indexed, so one asset resolves
   * to one attachment.
   */
  async findContentMediaByAsset(
    executor: AnyExecutor,
    assetId: string,
  ): Promise<
    | {
        readonly contentId: string;
        readonly creatorId: string;
      }
    | undefined
  > {
    const rows = await executor
      .select({
        contentId: creatorContentMedia.contentId,
        creatorId: creatorContent.creatorId,
      })
      .from(creatorContentMedia)
      .innerJoin(
        creatorContent,
        eq(creatorContent.id, creatorContentMedia.contentId),
      )
      .where(eq(creatorContentMedia.mediaAssetId, assetId))
      .limit(1);
    return rows[0];
  }

  /**
   * Claims the lowest free position on an item for a new asset.
   *
   * The partial unique index is the authority rather than this loop: two
   * concurrent attachments cannot take the same position, and the loser retries
   * against the positions it can now see. Attempts are bounded by how many
   * positions there are, so a genuinely full item is reported as full rather
   * than retried forever.
   */
  async attachContentMedia(
    executor: AnyExecutor,
    input: {
      readonly assetId: string;
      readonly contentId: string;
      readonly now: Date;
    },
  ): Promise<{ readonly position: number } | undefined> {
    for (let attempt = 0; attempt < maximumContentMedia; attempt += 1) {
      const taken = await executor
        .select({ position: creatorContentMedia.position })
        .from(creatorContentMedia)
        .where(eq(creatorContentMedia.contentId, input.contentId));
      const used = new Set(taken.map((row) => row.position));
      const free = Array.from(
        { length: maximumContentMedia },
        (_, index) => index,
      ).find((position) => !used.has(position));
      if (free === undefined) return undefined;
      try {
        const inserted = await executor
          .insert(creatorContentMedia)
          .values({
            contentId: input.contentId,
            createdAt: input.now,
            id: crypto.randomUUID(),
            mediaAssetId: input.assetId,
            position: free,
            updatedAt: input.now,
          })
          .returning({ position: creatorContentMedia.position });
        const row = inserted[0];
        if (row !== undefined) return row;
      } catch {
        // The position was taken between the read and the insert. Look again.
      }
    }
    return undefined;
  }

  /** Detaches one asset, freeing its position without renumbering the rest. */
  async detachContentMedia(
    executor: AnyExecutor,
    assetId: string,
  ): Promise<void> {
    await executor
      .delete(creatorContentMedia)
      .where(eq(creatorContentMedia.mediaAssetId, assetId));
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
