import type {
  CreatorContentLifecycleValue,
  SaveCreatorContentRequest,
} from '@velora/validation';

import type { ContentCreatorPort } from './creators.js';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  type CatalogCursor,
} from './cursor.js';
import { maximumCatalogPageSize } from './policy.js';
import type {
  ClubsDatabase,
  ClubsRepository,
  CreatorContentRow,
} from './repository.js';

/**
 * The creator catalog.
 *
 * Three rules decide everything here. Nothing is visible because it exists —
 * only because somebody published it. Nothing a creator writes changes who may
 * see it. And every read of somebody else's catalog re-asks whether that
 * creator may still be seen at all, rather than trusting a flag written when
 * they were.
 */

export type ContentOutcome =
  | {
      readonly kind: 'saved';
      readonly created: boolean;
      readonly row: CreatorContentRow;
    }
  /**
   * One outcome for a stale version, an item that is not this creator's, a
   * transition the item cannot make, and a creator who may not operate. They
   * are deliberately indistinguishable: separating them would let a caller
   * probe for items belonging to somebody else.
   */
  | { readonly kind: 'conflict' };

export interface ContentPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly CreatorContentRow[];
}

/** Club ownership, so an item cannot be attached to somebody else's room. */
export interface ContentClubOwnershipPort {
  findOwnClub(
    executor: ClubsDatabase,
    input: { readonly clubId: string; readonly creatorId: string },
  ): Promise<unknown>;
}

export interface ClubsServiceDependencies {
  readonly clubs: ContentClubOwnershipPort;
  readonly creators: ContentCreatorPort;
  readonly now: () => Date;
  readonly repository: ClubsRepository;
}

/** Transitions a creator may ask for, and what each requires. */
const allowedTransitions: Readonly<
  Record<CreatorContentLifecycleValue, readonly CreatorContentLifecycleValue[]>
> = {
  // Archived is a withdrawal, not a deletion, so returning to draft is how an
  // item comes back — never straight to published, which would put something
  // back in front of people without a fresh decision.
  archived: ['draft'],
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
};

export class ClubsService {
  constructor(private readonly dependencies: ClubsServiceDependencies) {}

  /** One page of the creator's own catalog, drafts included. */
  async listOwn(input: {
    readonly creatorId: string;
    readonly cursor: string | undefined;
    readonly pageSize: number;
  }): Promise<ContentPage> {
    const { repository } = this.dependencies;
    return this.page(
      await repository.listOwn(repository.transactionless, {
        after: this.after(input.cursor),
        creatorId: input.creatorId,
        limit: this.limit(input.pageSize),
      }),
      input.pageSize,
      (row) => row.createdAt,
    );
  }

  /**
   * One page of what a visitor may see for a handle, or nothing at all.
   *
   * `undefined` covers an unknown handle, a profile still in draft, and a
   * creator who is not active, because CREATORS answers all three the same way
   * and this domain has no business telling them apart.
   */
  async listPublic(input: {
    readonly cursor: string | undefined;
    readonly handle: string;
    readonly pageSize: number;
  }): Promise<ContentPage | undefined> {
    const { repository } = this.dependencies;
    const creatorId = await this.dependencies.creators.publishedCreatorFor({
      executor: repository.transactionless,
      handle: input.handle,
    });
    if (creatorId === undefined) return undefined;
    return this.page(
      await repository.listPublished(repository.transactionless, {
        after: this.after(input.cursor),
        creatorId,
        limit: this.limit(input.pageSize),
      }),
      input.pageSize,
      // Published items are ordered by when they were published, which is the
      // only instant a reader could reason about and the only one that does not
      // move when a creator edits a typo.
      (row) => row.publishedAt ?? row.createdAt,
    );
  }

  /**
   * Creates or edits one item.
   *
   * A creator who may not operate cannot write at all — not because the catalog
   * is precious, but because a suspended creator continuing to prepare
   * publications is a suspension that does not mean anything.
   */
  async save(input: {
    readonly creatorId: string;
    readonly request: SaveCreatorContentRequest;
  }): Promise<ContentOutcome> {
    const { repository } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };

    // A club named on an item has to be one this creator owns. Accepting an
    // identifier from elsewhere would let somebody attach their writing to
    // another creator's room, which is the reverse of the isolation every other
    // read here enforces.
    const clubId = input.request.clubId ?? null;
    if (clubId !== null && !(await this.ownsClub(input.creatorId, clubId))) {
      return { kind: 'conflict' };
    }
    const content = {
      body: input.request.body ?? null,
      clubId,
      summary: input.request.summary ?? null,
      title: input.request.title,
      visibility: input.request.visibility,
    };
    const now = this.dependencies.now();

    if (input.request.contentId === undefined) {
      // Both absent creates; one without the other is refused above by the
      // contract, so reaching here with a version and no identifier is
      // impossible rather than merely unhandled.
      if (input.request.version !== undefined) return { kind: 'conflict' };
      return {
        created: true,
        kind: 'saved',
        row: await repository.insert(repository.transactionless, {
          content,
          creatorId: input.creatorId,
          now,
        }),
      };
    }
    if (input.request.version === undefined) return { kind: 'conflict' };

    const row = await repository.update(repository.transactionless, {
      content,
      contentId: input.request.contentId,
      creatorId: input.creatorId,
      expectedVersion: input.request.version,
      now,
    });
    return row === undefined
      ? { kind: 'conflict' }
      : { created: false, kind: 'saved', row };
  }

  /**
   * Moves one item between lifecycle states.
   *
   * The transition is checked against the item's current state before it is
   * attempted, so a client cannot publish something twice by asking twice, and
   * the version predicate settles two callers asking at the same moment.
   */
  async setLifecycle(input: {
    readonly contentId: string;
    readonly creatorId: string;
    readonly lifecycle: CreatorContentLifecycleValue;
    readonly version: number;
  }): Promise<ContentOutcome> {
    const { repository } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };

    const current = await repository.findOwn(repository.transactionless, {
      contentId: input.contentId,
      creatorId: input.creatorId,
    });
    if (current === undefined) return { kind: 'conflict' };
    if (!allowedTransitions[current.lifecycle].includes(input.lifecycle)) {
      return { kind: 'conflict' };
    }

    const row = await repository.transitionLifecycle(
      repository.transactionless,
      {
        contentId: input.contentId,
        creatorId: input.creatorId,
        expectedVersion: input.version,
        lifecycle: input.lifecycle,
        now: this.dependencies.now(),
      },
    );
    return row === undefined
      ? { kind: 'conflict' }
      : { created: false, kind: 'saved', row };
  }

  private async ownsClub(creatorId: string, clubId: string): Promise<boolean> {
    const club = await this.dependencies.clubs.findOwnClub(
      this.dependencies.repository.transactionless,
      { clubId, creatorId },
    );
    return club !== undefined;
  }

  private async mayOperate(creatorId: string): Promise<boolean> {
    return this.dependencies.creators.mayOperate({
      creatorId,
      executor: this.dependencies.repository.transactionless,
    });
  }

  /** One more row than asked for is how the server knows a page follows. */
  private limit(pageSize: number): number {
    return Math.min(pageSize, maximumCatalogPageSize) + 1;
  }

  private after(cursor: string | undefined): CatalogCursor | undefined {
    return cursor === undefined ? undefined : decodeCatalogCursor(cursor);
  }

  private page(
    rows: readonly CreatorContentRow[],
    pageSize: number,
    momentOf: (row: CreatorContentRow) => Date,
  ): ContentPage {
    const size = Math.min(pageSize, maximumCatalogPageSize);
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: momentOf(last) })
          : undefined,
      rows: page,
    };
  }
}
