import { and, eq } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import { clubs } from './schema.js';

/**
 * What PRIVATE CLUBS is willing to tell BILLING about a club.
 *
 * Exactly one thing: whether this creator owns it, and whether it has been
 * published. Not its name, not its member count, not its content, and not
 * whether it exists at all when it belongs to somebody else — a caller that
 * could tell "no such club" from "not yours" could enumerate another creator's
 * clubs one identifier at a time.
 *
 * The direction matters. BILLING asks and PRIVATE CLUBS answers; PRIVATE CLUBS
 * never learns that an offer exists, and never learns what one costs. The
 * reverse dependency — the commercial fact that grants access — travels the
 * other way through the outbox, and neither side reads the other's tables.
 */
export type ClubCommercialState =
  'absent' | 'owned_published' | 'owned_unpublished';

export class ClubCommercialDirectory {
  async offerableResource(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly resourceId: string;
    readonly resourceType: string;
  }): Promise<ClubCommercialState> {
    // The only resource type this domain owns. Anything else is not absent
    // here, it is simply not a question PRIVATE CLUBS can answer, and the
    // fail-closed reading of that is the same refusal.
    if (input.resourceType !== 'club') return 'absent';
    const rows = await input.executor
      .select({ lifecycle: clubs.lifecycle })
      .from(clubs)
      .where(
        and(
          eq(clubs.id, input.resourceId),
          eq(clubs.creatorId, input.creatorId),
        ),
      )
      .limit(1);
    const lifecycle = rows[0]?.lifecycle;
    if (lifecycle === undefined) return 'absent';
    // A closed club is deliberately not publishable-for-sale and not absent
    // either: it is owned and unpublished, so an existing draft offer against
    // it may be edited but never activated.
    return lifecycle === 'published' ? 'owned_published' : 'owned_unpublished';
  }
}
