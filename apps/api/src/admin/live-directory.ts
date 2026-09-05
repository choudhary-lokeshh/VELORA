import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { DatabaseHandle } from '../database/executor.js';
import { bounded } from '../database/fan-out.js';
import { discoveryIntroductions } from '../discovery/schema.js';
import { liveEncounters, liveParticipations } from '../live/schema.js';
import { safetyBlocks, safetyReports } from '../safety/schema.js';
import { livePreferenceEntitlements } from '../wallet/schema.js';

/**
 * LIVE, in operational terms an operator can act on.
 *
 * Two questions and nothing else. What is the matching pool doing right now,
 * and what happened in one encounter. Both are answered from LIVE's and
 * REALTIME's own rows, which means every figure here is countable and every
 * count is over a whole table rather than over a page.
 *
 * There is no "users online". A count of people the platform believes are
 * connected is exactly the number nothing can know truthfully — a browser that
 * closed, a phone that slept, and a tunnel that dropped all look the same from
 * here — and inventing one would make every honest number beside it worth less.
 * What is published instead is what the platform has actually written down:
 * how many participations are in the searching state, how many encounters are
 * in the active state, and when each of those states was entered.
 *
 * And nothing in this module can reach a stream, a track, a frame, or a
 * message. An encounter is a row with two account identifiers, two instants,
 * and a reason it stopped. Watching a call is not a feature that exists in
 * this product, and this is one of the places it deliberately does not.
 */

export interface OperationalCount {
  readonly label: string;
  readonly total: number;
}

export interface LiveOperationsState {
  /** Encounters that started inside the window, by medium. */
  readonly encounterStarts: readonly OperationalCount[];
  /** Encounters that ended inside the window, by the reason LIVE recorded. */
  readonly endReasons: readonly OperationalCount[];
  /** Encounters LIVE currently believes are running. */
  readonly liveEncounters: number;
  /** When the platform computed these figures. Never when a page rendered. */
  readonly observedAt: Date;
  /** The oldest still-searching participation, which is how a stall shows up. */
  readonly oldestSearchSince: Date | undefined;
  /** Participations by state, over the whole table. */
  readonly participations: readonly OperationalCount[];
  /** Narrowed searches paid for and still open, by what they narrowed on. */
  readonly premiumWindows: readonly OperationalCount[];
  readonly since: Date;
}

export interface LiveEncounterDetail {
  readonly createdAt: Date;
  readonly endReason: string | undefined;
  readonly endedAt: Date | undefined;
  /** The operator-visible outcome of the pair meeting: did either ask again. */
  readonly introduction:
    { readonly createdAt: Date; readonly state: string } | undefined;
  readonly id: string;
  readonly medium: string;
  /** Two opaque account identifiers. No names, no profiles, no media. */
  readonly participants: readonly string[];
  /** Whether a paid narrowing was open for either side at allocation. */
  readonly premiumWindows: number;
  /** REALTIME's session, so an operator can find the call's own record. */
  readonly realtimeSessionId: string | undefined;
  /** Whether the pair produced a report or a block. Counts, never contents. */
  readonly safety: { readonly blocks: number; readonly reports: number };
  readonly state: string;
}

function grouped(
  rows: readonly { readonly label: string | null; readonly total: number }[],
): readonly OperationalCount[] {
  return rows
    .filter(
      (row): row is { label: string; total: number } => row.label !== null,
    )
    .map((row) => ({ label: row.label, total: row.total }));
}

export class AdminLiveDirectory {
  constructor(
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly now: () => Date;
    },
  ) {}

  private get database(): DatabaseHandle {
    return this.dependencies.database;
  }

  async state(since: Date): Promise<LiveOperationsState> {
    const now = this.dependencies.now();
    const [participations, oldestSearch, live, starts, endReasons, premium] =
      await bounded([
        async () =>
          this.database
            .select({ label: liveParticipations.state, total: count() })
            .from(liveParticipations)
            .groupBy(liveParticipations.state),
        async () =>
          this.database
            .select({ stateEnteredAt: liveParticipations.stateEnteredAt })
            .from(liveParticipations)
            .where(eq(liveParticipations.state, 'searching'))
            .orderBy(liveParticipations.stateEnteredAt)
            .limit(1),
        async () =>
          this.database
            .select({ total: count() })
            .from(liveEncounters)
            .where(isNull(liveEncounters.endedAt)),
        async () =>
          this.database
            .select({ label: liveEncounters.medium, total: count() })
            .from(liveEncounters)
            .where(gt(liveEncounters.createdAt, since))
            .groupBy(liveEncounters.medium),
        async () =>
          this.database
            .select({ label: liveEncounters.endReason, total: count() })
            .from(liveEncounters)
            .where(gt(liveEncounters.endedAt, since))
            .groupBy(liveEncounters.endReason),
        // A paid narrowing is a coin position, so the operational question is
        // which kind of narrowing is open rather than whose or for how much.
        async () =>
          this.database
            .select({
              label: sql<string>`coalesce(${livePreferenceEntitlements.preferenceGender}, ${livePreferenceEntitlements.preferenceRegion}, ${livePreferenceEntitlements.preferenceLanguage}, 'unspecified')`,
              total: count(),
            })
            .from(livePreferenceEntitlements)
            .where(
              and(
                eq(livePreferenceEntitlements.state, 'active'),
                gt(livePreferenceEntitlements.expiresAt, now),
              ),
            )
            .groupBy(
              sql`coalesce(${livePreferenceEntitlements.preferenceGender}, ${livePreferenceEntitlements.preferenceRegion}, ${livePreferenceEntitlements.preferenceLanguage}, 'unspecified')`,
            ),
      ]);

    return {
      encounterStarts: grouped(starts),
      endReasons: grouped(endReasons),
      liveEncounters: live[0]?.total ?? 0,
      observedAt: now,
      oldestSearchSince: oldestSearch[0]?.stateEnteredAt,
      participations: grouped(participations),
      premiumWindows: grouped(premium),
      since,
    };
  }

  /**
   * One encounter, and the three things an operator asks about it next.
   *
   * Did it end and why. Did either person ask to keep talking. Did either
   * report or block the other. All three are facts other domains already own,
   * read here because an operator holding an encounter identifier should not
   * have to go and find them in three screens.
   */
  async encounter(id: string): Promise<LiveEncounterDetail | undefined> {
    const rows = await this.database
      .select()
      .from(liveEncounters)
      .where(eq(liveEncounters.id, id))
      .limit(1);
    const encounter = rows[0];
    if (encounter === undefined) return undefined;

    const low = encounter.pairLowId;
    const high = encounter.pairHighId;
    const [introductions, reports, blocks, premium] = await bounded([
      async () =>
        this.database
          .select({
            createdAt: discoveryIntroductions.createdAt,
            state: discoveryIntroductions.state,
          })
          .from(discoveryIntroductions)
          .where(
            and(
              eq(discoveryIntroductions.pairLowId, low),
              eq(discoveryIntroductions.pairHighId, high),
            ),
          )
          .orderBy(desc(discoveryIntroductions.createdAt))
          .limit(1),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyReports)
          .where(
            or(
              and(
                eq(safetyReports.reporterId, low),
                eq(safetyReports.subjectId, high),
              ),
              and(
                eq(safetyReports.reporterId, high),
                eq(safetyReports.subjectId, low),
              ),
            ),
          ),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyBlocks)
          .where(
            or(
              and(
                eq(safetyBlocks.blockerId, low),
                eq(safetyBlocks.blockedId, high),
              ),
              and(
                eq(safetyBlocks.blockerId, high),
                eq(safetyBlocks.blockedId, low),
              ),
            ),
          ),
      async () =>
        this.database
          .select({ total: count() })
          .from(livePreferenceEntitlements)
          .where(eq(livePreferenceEntitlements.encounterId, id)),
    ]);

    const introduction = introductions[0];
    return {
      createdAt: encounter.createdAt,
      endReason: encounter.endReason ?? undefined,
      endedAt: encounter.endedAt ?? undefined,
      id: encounter.id,
      introduction:
        introduction === undefined
          ? undefined
          : { createdAt: introduction.createdAt, state: introduction.state },
      medium: encounter.medium,
      participants: [low, high],
      premiumWindows: premium[0]?.total ?? 0,
      realtimeSessionId: encounter.realtimeSessionId ?? undefined,
      safety: {
        blocks: blocks[0]?.total ?? 0,
        reports: reports[0]?.total ?? 0,
      },
      state: encounter.state,
    };
  }
}
