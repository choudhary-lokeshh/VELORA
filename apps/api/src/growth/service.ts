import type { SafeLogger } from '@velora/observability/server';

import type { GrowthRepository } from './repository.js';
import {
  acquisitionSummaryDays,
  directAcquisitionSource,
  invitationAcquisitionSource,
  liveWindowHorizonDays,
  maximumLiveWindowHours,
  mintInviteCode,
  normalizeAcquisitionParameter,
} from './policy.js';

/**
 * What GROWTH does, and the three things it refuses to become.
 *
 * It is not an authorisation service: an invitation code opens a page and
 * attributes one signup, and there is no method here that grants anything.
 *
 * It is not an analytics warehouse: it counts what it owns, over a fixed
 * window, with no identifier in the answer. Whether somebody went on to use the
 * product is USERS' and LIVE's fact, and a number joined across those would be
 * this domain claiming to know something it cannot see.
 *
 * It is not a rewards engine. Nothing here credits, entitles, or unlocks. When
 * a reward exists it will be a decision somebody makes with a qualification
 * rule attached, and the honest state today is that no such rule is approved —
 * so there is nothing to store and nothing to pay.
 */

export interface GrowthLiveWindowView {
  readonly endsAt: Date;
  readonly slug: string;
  readonly startsAt: Date;
  readonly state: 'upcoming' | 'active' | 'ended';
  readonly title: string;
}

export interface GrowthServiceDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly repository: GrowthRepository;
}

/** Everything a caller can offer about where an account came from. */
export interface AcquisitionInput {
  readonly campaign?: string | undefined;
  readonly content?: string | undefined;
  readonly inviteCode?: string | undefined;
  readonly medium?: string | undefined;
  readonly source?: string | undefined;
}

export class GrowthService {
  constructor(private readonly dependencies: GrowthServiceDependencies) {}

  /** The caller's own link, without creating one. */
  async inviteFor(
    inviterUserId: string,
  ): Promise<{ readonly code: string; readonly createdAt: Date } | undefined> {
    const { repository } = this.dependencies;
    const found = await repository.findInviteByOwner(
      repository.transactionless,
      inviterUserId,
    );
    return found === undefined
      ? undefined
      : { code: found.code, createdAt: found.createdAt };
  }

  /**
   * The caller's link, minting one the first time and only the first time.
   *
   * The insert is attempted and its conflict is the answer, rather than a read
   * followed by a write: two presses in the same millisecond both pass a read
   * and only one passes the unique index. A caller that loses reads back what
   * the winner wrote, which is the same link either way.
   */
  async createInvite(
    inviterUserId: string,
  ): Promise<{ readonly code: string; readonly createdAt: Date }> {
    const { logger, now, randomBytes, repository } = this.dependencies;
    const at = now();
    const inserted = await repository.insertInvite(repository.transactionless, {
      code: mintInviteCode(randomBytes),
      id: crypto.randomUUID(),
      inviterUserId,
      now: at,
    });

    if (inserted !== undefined) {
      await repository.insertEvent(repository.transactionless, {
        id: crypto.randomUUID(),
        inviteId: inserted.id,
        name: 'invite_created',
        now: at,
        source: invitationAcquisitionSource,
      });
      logger.info({ event: 'growth.invite.created' }, 'invitation minted');
      return { code: inserted.code, createdAt: inserted.createdAt };
    }

    const existing = await repository.findInviteByOwner(
      repository.transactionless,
      inviterUserId,
    );
    if (existing === undefined) {
      // The insert conflicted and nothing is there to read. The only way to
      // reach this is a code collision against another owner's row, which at
      // 113 bits is not a thing that happens — so it is reported rather than
      // retried silently, because a retry loop would hide the day it did.
      throw new Error('invitation could not be established');
    }
    return { code: existing.code, createdAt: existing.createdAt };
  }

  /**
   * Records that an invitation address was opened, and says whether it works.
   *
   * The opening is recorded whichever answer it gets, because "how many people
   * opened a link that no longer works" is exactly the number that says whether
   * revoked links are a problem. Both are deduplicated on the visitor's own
   * key, so a person refreshing is one opening rather than a stream of them.
   *
   * It never says who invited them. An invitation address can be forwarded,
   * posted, or scraped, so anything answered here is answered to everybody who
   * ever saw the link.
   */
  async recordOpening(input: {
    readonly code: string;
    readonly openingKey: string;
  }): Promise<{ readonly usable: boolean }> {
    const { now, repository } = this.dependencies;
    const at = now();
    const invite = await repository.findUsableInviteByCode(
      repository.transactionless,
      input.code,
    );
    await repository.insertEvent(repository.transactionless, {
      dedupeKey: input.openingKey,
      id: crypto.randomUUID(),
      name: invite === undefined ? 'invite_refused' : 'invite_opened',
      now: at,
      source: invitationAcquisitionSource,
      ...(invite === undefined ? {} : { inviteId: invite.id }),
    });
    return { usable: invite !== undefined };
  }

  /**
   * Records where one account came from, once, at the moment it was created.
   *
   * Four refusals, in the order they matter.
   *
   * A code nobody holds, and a code its owner has withdrawn, attribute nothing
   * — and the account is still recorded as having come from wherever else it
   * says it did, because "arrived through a dead link" is still an arrival.
   *
   * An account cannot invite itself. The check is here so the answer is a
   * refusal rather than a constraint violation, and it is in the schema too so
   * it stays true if this is ever wrong.
   *
   * An account that already has an origin keeps it. That is the conflict target
   * rather than a read, so two requests racing produce one row.
   *
   * Nothing here reads or writes anything outside GROWTH. It cannot grant, and
   * there is no method it could call that would.
   */
  async attributeSignup(input: {
    readonly acquisition: AcquisitionInput | undefined;
    readonly userId: string;
  }): Promise<void> {
    const { logger, now, repository } = this.dependencies;
    const at = now();
    const acquisition = input.acquisition ?? {};

    const invite =
      acquisition.inviteCode === undefined
        ? undefined
        : await repository.findUsableInviteByCode(
            repository.transactionless,
            acquisition.inviteCode,
          );
    // Somebody opening their own link and signing up again is not a referral,
    // and an account cannot be its own origin.
    const attributable =
      invite !== undefined && invite.inviterUserId !== input.userId
        ? invite
        : undefined;

    const campaign = normalizeAcquisitionParameter(acquisition.campaign);
    const content = normalizeAcquisitionParameter(acquisition.content);
    const medium = normalizeAcquisitionParameter(acquisition.medium);
    const declaredSource = normalizeAcquisitionParameter(acquisition.source);
    const source =
      attributable !== undefined
        ? invitationAcquisitionSource
        : (declaredSource ?? directAcquisitionSource);

    const written = await repository.insertAttribution(
      repository.transactionless,
      {
        campaign,
        content,
        inviteId: attributable?.id,
        inviterUserId: attributable?.inviterUserId,
        medium,
        now: at,
        source,
        userId: input.userId,
      },
    );
    if (written === undefined) {
      // This account already has an origin. That is the design working rather
      // than a failure: an account has exactly one, forever.
      logger.debug(
        { event: 'growth.attribution.already_recorded' },
        'signup already attributed',
      );
      return;
    }

    await repository.insertEvent(repository.transactionless, {
      id: crypto.randomUUID(),
      name: 'signup_attributed',
      now: at,
      source,
      subjectId: input.userId,
      ...(campaign === undefined ? {} : { campaign }),
      ...(medium === undefined ? {} : { medium }),
      ...(attributable === undefined ? {} : { inviteId: attributable.id }),
    });
    logger.info(
      { event: 'growth.attribution.recorded', source },
      'signup attributed',
    );
  }

  /**
   * The windows worth telling anybody about, with their state derived now.
   *
   * `ended` never appears in this answer — a window that has finished is simply
   * absent — but the state is still part of the shape, because the page that
   * renders one is looking at a moment that can pass while somebody is reading.
   */
  async publishableWindows(
    limit: number,
  ): Promise<readonly GrowthLiveWindowView[]> {
    const { now, repository } = this.dependencies;
    const at = now();
    const until = new Date(
      at.getTime() + liveWindowHorizonDays * 24 * 60 * 60 * 1_000,
    );
    const rows = await repository.listPublishableWindows(
      repository.transactionless,
      { limit, now: at, until },
    );
    return rows.map((row) => ({
      endsAt: row.endsAt,
      slug: row.slug,
      startsAt: row.startsAt,
      state: windowState(row, at),
      title: row.title,
    }));
  }

  /** One window by its shareable address, whatever state it is in. */
  async windowBySlug(slug: string): Promise<GrowthLiveWindowView | undefined> {
    const { now, repository } = this.dependencies;
    const found = await repository.findWindowBySlug(
      repository.transactionless,
      slug,
    );
    if (found?.cancelledAt != null) return undefined;
    if (found === undefined) return undefined;
    return {
      endsAt: found.endsAt,
      slug: found.slug,
      startsAt: found.startsAt,
      state: windowState(found, now()),
      title: found.title,
    };
  }

  /**
   * Schedules a window, refusing the two shapes that are not windows.
   *
   * A window that ends before it starts is nothing, and one longer than a day
   * is the product's ordinary opening hours with a name on it — which
   * concentrates nobody, which is the only thing this feature is for.
   */
  async scheduleWindow(input: {
    readonly endsAt: Date;
    readonly slug: string;
    readonly startsAt: Date;
    readonly title: string;
  }): Promise<{ readonly kind: 'scheduled' | 'refused' }> {
    const { logger, now, repository } = this.dependencies;
    const span = input.endsAt.getTime() - input.startsAt.getTime();
    if (span <= 0 || span > maximumLiveWindowHours * 60 * 60 * 1_000) {
      return { kind: 'refused' };
    }
    await repository.upsertWindow(repository.transactionless, {
      endsAt: input.endsAt,
      id: crypto.randomUUID(),
      now: now(),
      slug: input.slug,
      startsAt: input.startsAt,
      title: input.title,
    });
    logger.info(
      { event: 'growth.live_window.scheduled', slug: input.slug },
      'live window scheduled',
    );
    return { kind: 'scheduled' };
  }

  async cancelWindow(slug: string): Promise<void> {
    const { logger, now, repository } = this.dependencies;
    await repository.cancelWindow(repository.transactionless, {
      now: now(),
      slug,
    });
    logger.info(
      { event: 'growth.live_window.cancelled', slug },
      'live window cancelled',
    );
  }

  /**
   * What acquisition looked like over a fixed recent window.
   *
   * Counts and nothing else. There is no percentage here, and that is a
   * statement about honesty rather than about effort: a conversion rate would
   * need to know whether an attributed account went on to use the product, and
   * that is USERS' and LIVE's fact rather than GROWTH's.
   */
  async acquisitionSummary(): Promise<{
    readonly invitationsOpened: number;
    readonly invitesCreated: number;
    readonly signupsAttributed: number;
    readonly since: Date;
    readonly sources: readonly {
      readonly signups: number;
      readonly source: string;
    }[];
  }> {
    const { now, repository } = this.dependencies;
    const since = new Date(
      now().getTime() - acquisitionSummaryDays * 24 * 60 * 60 * 1_000,
    );
    const executor = repository.transactionless;
    const [invitesCreated, invitationsOpened, signupsAttributed, sources] =
      await Promise.all([
        repository.countInvitesSince(executor, since),
        repository.countEventsSince(executor, {
          name: 'invite_opened',
          since,
        }),
        repository.countEventsSince(executor, {
          name: 'signup_attributed',
          since,
        }),
        repository.countSignupsBySource(executor, since),
      ]);
    return {
      invitationsOpened,
      invitesCreated,
      signupsAttributed,
      since,
      sources,
    };
  }
}

/**
 * Where a window is, relative to a moment.
 *
 * Derived on every read rather than stored, because a stored state is wrong for
 * exactly as long as it takes something to update it — and the thing that would
 * update it is a job that can be late, restarted, or not running at all.
 */
function windowState(
  row: { readonly endsAt: Date; readonly startsAt: Date },
  at: Date,
): 'upcoming' | 'active' | 'ended' {
  if (at.getTime() < row.startsAt.getTime()) return 'upcoming';
  return at.getTime() < row.endsAt.getTime() ? 'active' : 'ended';
}
