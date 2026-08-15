import { and, desc, eq, inArray, like, lt, or } from 'drizzle-orm';

import { decodeCatalogCursor, encodeCatalogCursor } from '../clubs/cursor.js';
import { creatorAccounts, creatorProfiles } from '../creators/schema.js';
import type {
  CreatorAccountRow,
  CreatorProfileRepository,
  CreatorsDatabase,
} from '../creators/repository.js';

/**
 * The operational view of creators an operator reads.
 *
 * It is a read model rather than a domain service: nothing here changes state,
 * and every mutation an operator can perform goes through the owning domain.
 * It joins the creator capability to the public handle because that is what an
 * operator recognises somebody by, and the handle is already public.
 */
export interface AdminCreatorView {
  readonly creator: CreatorAccountRow;
  readonly handle: string | undefined;
  readonly profilePublished: boolean;
}

export interface AdminCreatorPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminCreatorView[];
}

const maximumAdminPageSize = 50;

export class AdminCreatorDirectory {
  constructor(
    private readonly database: CreatorsDatabase,
    private readonly profiles: CreatorProfileRepository,
  ) {}

  /**
   * One bounded page, newest first.
   *
   * Search is a prefix over the public handle and nothing else. Searching by
   * anything an operator could not already see on a public page would make this
   * a lookup tool for private data rather than a way to find a creator somebody
   * reported by name.
   */
  async list(input: {
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly search?: string;
  }): Promise<AdminCreatorPage> {
    const size = Math.min(input.pageSize, maximumAdminPageSize);
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCatalogCursor(input.cursor);
    const search = input.search?.toLowerCase();

    const rows = await this.database
      .select()
      .from(creatorAccounts)
      .where(
        and(
          after === undefined
            ? undefined
            : or(
                lt(creatorAccounts.createdAt, after.moment),
                and(
                  eq(creatorAccounts.createdAt, after.moment),
                  lt(creatorAccounts.id, after.id),
                ),
              ),
          search === undefined
            ? undefined
            : inArray(
                creatorAccounts.id,
                this.database
                  .select({ creatorId: creatorProfiles.creatorId })
                  .from(creatorProfiles)
                  .where(like(creatorProfiles.handle, `${search}%`)),
              ),
        ),
      )
      .orderBy(desc(creatorAccounts.createdAt), desc(creatorAccounts.id))
      .limit(size + 1);

    const page = rows.slice(0, size);
    // One statement for the page rather than one per row: the page is bounded,
    // so this is bounded with it, and it goes through the repository that owns
    // the profile rather than reading its table from here.
    const summaries = await this.profiles.summariesFor(
      this.profiles.transactionless,
      page.map((creator) => creator.id),
    );
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page.map((creator) => ({
        creator,
        handle: summaries.get(creator.id)?.handle,
        profilePublished: summaries.get(creator.id)?.published ?? false,
      })),
    };
  }

  /** The same view for one creator, after an operation changed it. */
  async describe(creator: CreatorAccountRow): Promise<AdminCreatorView> {
    const summaries = await this.profiles.summariesFor(
      this.profiles.transactionless,
      [creator.id],
    );
    const summary = summaries.get(creator.id);
    return {
      creator,
      handle: summary?.handle,
      profilePublished: summary?.published ?? false,
    };
  }
}
