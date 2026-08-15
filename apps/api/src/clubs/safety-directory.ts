import { and, eq } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import { clubs, creatorContent } from './schema.js';

/**
 * What PRIVATE CLUBS is willing to tell TRUST & SAFETY about its catalog.
 *
 * Exactly one thing per question: the identifier of something a visitor could
 * legitimately have been looking at, or nothing. Not a title, not an owner, not
 * a visibility, not a lifecycle, and not whether the identifier exists when it
 * names something unpublished — a caller that could tell "no such item" from
 * "not published yet" could walk a creator's drafts one identifier at a time.
 *
 * The direction matters. SAFETY asks so that a report names something real;
 * PRIVATE CLUBS never learns that a report exists, who filed it, or what it
 * said. Nothing here reads or writes a `safety_` table.
 */
export class ClubSafetyDirectory {
  /**
   * A published item's identifier.
   *
   * Published rather than public: a members-only item is reportable by the
   * members who can see it, and whether this particular reporter is one of them
   * is an entitlement question PRIVATE CLUBS answers elsewhere. Withholding it
   * here would make exactly the content behind a paywall the content nobody can
   * report.
   */
  async publishedContentFor(input: {
    readonly contentId: string;
    readonly executor: Executor;
  }): Promise<string | undefined> {
    const rows = await input.executor
      .select({ id: creatorContent.id })
      .from(creatorContent)
      .where(
        and(
          eq(creatorContent.id, input.contentId),
          eq(creatorContent.lifecycle, 'published'),
        ),
      )
      .limit(1);
    return rows[0]?.id;
  }

  /** A published club's identifier, addressed as a visitor sees it. */
  async publishedClubFor(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly slug: string;
  }): Promise<string | undefined> {
    const rows = await input.executor
      .select({ id: clubs.id })
      .from(clubs)
      .where(
        and(
          eq(clubs.creatorId, input.creatorId),
          eq(clubs.slug, input.slug),
          eq(clubs.lifecycle, 'published'),
        ),
      )
      .limit(1);
    return rows[0]?.id;
  }
}
