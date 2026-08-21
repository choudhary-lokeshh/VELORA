import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import {
  rtcBacklogKinds,
  rtcBacklogThresholdMilliseconds,
  rtcJoinTimeoutMilliseconds,
  rtcProviderEventStates,
  rtcProviderObligationStates,
  rtcReconnectGraceMilliseconds,
  rtcSessionStates,
  terminalRtcSessionStates,
  type RtcBacklogKind,
} from './policy.js';
import type { RtcRepository } from './repository.js';
import {
  realtimeProviderEvents,
  realtimeProviderObligations,
  realtimeSessions,
} from './schema.js';

/**
 * What an operator may see of calling.
 *
 * This lives in REALTIME rather than in ADMIN, on the rule MEDIA's operational
 * view already follows: nothing outside this domain queries a `realtime_`
 * table, and an operator genuinely needs the technical lifecycle, so the query
 * belongs where the rule is rather than in a module that would have to break
 * it.
 *
 * **The state screen carries no identifier of any kind.** Not a call, not an
 * account, not a provider room. It is counts and ages, because a screen an
 * operator watches all day is a screen that must not become a window onto who
 * is talking to whom. Two people having a call is not an operational fact.
 *
 * There is deliberately no list of calls and no search. An operator who could
 * page through calls has a browsing surface over who contacts whom, which is
 * not an operations tool however it is labelled — and unlike media, where an
 * asset has an owner, a call has two people and browsing it would expose a
 * relationship neither of them published.
 *
 * The detail below is one call, reached only by an operator who already has its
 * identifier from a report or a finding, and it carries the lifecycle because
 * triaging a stuck call without it is guesswork. It carries no credential, no
 * provider room reference, no address, and nothing about media, because none of
 * those exists anywhere in this domain to carry.
 */

/** One count under a label. The same shape the other operational screens use. */
export interface RtcStateCount {
  readonly count: number;
  readonly state: string;
}

/**
 * One class of owed work, with the age of the oldest thing in it.
 *
 * The age is the point. A count says how much is waiting and nothing about
 * whether it is moving: forty calls past their join timeout in the last minute
 * is a busy platform, and one call past it since Tuesday is a sweep that has
 * stopped running. Those are indistinguishable by count and unmistakable by
 * age.
 *
 * `oldestAgeSeconds` is absent rather than zero when nothing is waiting,
 * because a zero reads as "something has waited no time at all" and an alert
 * rule written against it would be written against a lie.
 */
export interface RtcBacklogAge {
  /** True when the oldest has waited past this class's threshold. */
  readonly breached: boolean;
  readonly count: number;
  /** How long the oldest has waited. Absent when nothing is waiting. */
  readonly oldestAgeSeconds: number | undefined;
  readonly state: RtcBacklogKind;
  /**
   * The age at which this class becomes an alert, reported beside it so a
   * screen and a rule cannot come to disagree about when work is late.
   */
  readonly thresholdSeconds: number;
}

export interface RtcOperationalState {
  /** Which adapters are in force, by name. `unavailable` is the truth. */
  readonly adapters: {
    readonly eligibility: string;
    readonly provider: string;
    readonly signalTransport: string;
  };
  /**
   * Owed work, by class, with the age of the oldest in each.
   *
   * Every class is reported every time, including the empty ones, for the same
   * reason MEDIA reports its own: a list that omits what is healthy cannot be
   * told apart from a signal that stopped arriving.
   */
  readonly backlogs: readonly RtcBacklogAge[];
  /** Calls by state. Every state, including the ones at zero. */
  readonly calls: readonly RtcStateCount[];
  /**
   * Calls that finished while a teardown obligation for them did not.
   *
   * The one disagreement worth a number of its own: the platform believes the
   * call is over and the provider may still be holding a room open. It is
   * counted rather than listed, because listing it would name calls.
   */
  readonly endedWithUndischargedTeardown: number;
  readonly providerEvents: readonly RtcStateCount[];
  readonly providerObligations: readonly RtcStateCount[];
}

/** One call as an operator sees it. Reached only by identifier. */
export interface RtcCallDetail {
  readonly acceptedAt: string | undefined;
  readonly authorizationGeneration: number;
  readonly connectedAt: string | undefined;
  readonly createdAt: string;
  readonly endReason: string | undefined;
  readonly endedAt: string | undefined;
  readonly id: string;
  /** How many credentials have been minted for this call, in total. */
  readonly issuances: number;
  readonly medium: string;
  /**
   * Whether a provider room was ever bound, and under which adapter. The room's
   * own reference is not reported: it is the provider's handle for a private
   * conversation, and an operations screen is not where it belongs.
   */
  readonly providerBound: boolean;
  readonly providerName: string | undefined;
  readonly state: string;
  /** Teardown and revocation owed for this call, by state. */
  readonly obligations: readonly RtcStateCount[];
}

export class RtcOperations {
  constructor(
    private readonly dependencies: {
      readonly adapters: {
        readonly eligibility: string;
        readonly provider: string;
        readonly signalTransport: string;
      };
      readonly now: () => Date;
      readonly repository: RtcRepository;
    },
  ) {}

  async operationalState(): Promise<RtcOperationalState> {
    const executor = this.dependencies.repository.transactionless;
    const now = this.dependencies.now();
    const [calls, obligations, events, backlogs, drift] = await Promise.all([
      this.countCallsByState(executor),
      this.countObligationsByState(executor),
      this.countEventsByState(executor),
      this.backlogAges(executor, now),
      this.countEndedWithUndischargedTeardown(executor),
    ]);
    return {
      adapters: this.dependencies.adapters,
      backlogs,
      calls,
      endedWithUndischargedTeardown: drift,
      providerEvents: events,
      providerObligations: obligations,
    };
  }

  /**
   * One call, for an operator who already has its identifier.
   *
   * Answers nothing for a call that does not exist rather than saying so
   * differently — an operations tool is still a place where guessing
   * identifiers must not be productive.
   */
  async callDetail(callId: string): Promise<RtcCallDetail | undefined> {
    const executor = this.dependencies.repository.transactionless;
    const found = await this.dependencies.repository.findById(executor, callId);
    if (found === undefined) return undefined;
    const { session } = found;

    const [issuances, obligations] = await Promise.all([
      this.dependencies.repository.countIssuancesForCall(executor, callId),
      this.countObligationsByState(executor, callId),
    ]);

    return {
      acceptedAt: session.acceptedAt?.toISOString(),
      authorizationGeneration: session.authorizationGeneration,
      connectedAt: session.connectedAt?.toISOString(),
      createdAt: session.createdAt.toISOString(),
      endReason: session.endReason ?? undefined,
      endedAt: session.endedAt?.toISOString(),
      id: session.id,
      issuances,
      medium: session.medium,
      obligations,
      providerBound: session.providerReference !== null,
      providerName: session.provider ?? undefined,
      state: session.state,
    };
  }

  /**
   * Counts by state, with every declared value present.
   *
   * Three explicit queries rather than one generic helper taking a column. The
   * generic version needed the table inferred back out of the column, which is
   * a trick that reads as cleverness and buys nothing: there are three of
   * these and they are each four lines.
   *
   * The zero rows are supplied here rather than left to callers, because a
   * caller that had to remember them would eventually forget, and the screen
   * would silently stop reporting a class the moment it emptied.
   */
  private async countCallsByState(
    executor: Executor,
  ): Promise<readonly RtcStateCount[]> {
    const rows = await executor
      .select({
        count: sql<string>`count(*)::text`,
        state: realtimeSessions.state,
      })
      .from(realtimeSessions)
      .groupBy(realtimeSessions.state);
    return fill(rtcSessionStates, rows);
  }

  private async countObligationsByState(
    executor: Executor,
    sessionId?: string,
  ): Promise<readonly RtcStateCount[]> {
    const rows = await executor
      .select({
        count: sql<string>`count(*)::text`,
        state: realtimeProviderObligations.state,
      })
      .from(realtimeProviderObligations)
      .where(
        sessionId === undefined
          ? sql`true`
          : eq(realtimeProviderObligations.sessionId, sessionId),
      )
      .groupBy(realtimeProviderObligations.state);
    return fill(rtcProviderObligationStates, rows);
  }

  private async countEventsByState(
    executor: Executor,
  ): Promise<readonly RtcStateCount[]> {
    const rows = await executor
      .select({
        count: sql<string>`count(*)::text`,
        state: realtimeProviderEvents.state,
      })
      .from(realtimeProviderEvents)
      .groupBy(realtimeProviderEvents.state);
    return fill(rtcProviderEventStates, rows);
  }

  private async backlogAges(
    executor: Executor,
    now: Date,
  ): Promise<readonly RtcBacklogAge[]> {
    const rows = await executor
      .select({
        invitationExpiry: ageOf(
          sql`case when ${realtimeSessions.state} = 'invited'
                and ${realtimeSessions.invitationExpiresAt} <= ${now}
              then ${realtimeSessions.invitationExpiresAt} end`,
        ),
        invitationExpiryCount: countOf(
          sql`${realtimeSessions.state} = 'invited'
            and ${realtimeSessions.invitationExpiresAt} <= ${now}`,
        ),
        joinTimeout: ageOf(
          sql`case when ${realtimeSessions.state} = 'connecting'
                and ${realtimeSessions.stateEnteredAt} <= ${new Date(
                  now.getTime() - rtcJoinTimeoutMilliseconds,
                )}
              then ${realtimeSessions.stateEnteredAt} end`,
        ),
        joinTimeoutCount: countOf(
          sql`${realtimeSessions.state} = 'connecting'
            and ${realtimeSessions.stateEnteredAt} <= ${new Date(
              now.getTime() - rtcJoinTimeoutMilliseconds,
            )}`,
        ),
        reconnectGrace: ageOf(
          sql`case when ${realtimeSessions.state} = 'reconnecting'
                and ${realtimeSessions.stateEnteredAt} <= ${new Date(
                  now.getTime() - rtcReconnectGraceMilliseconds,
                )}
              then ${realtimeSessions.stateEnteredAt} end`,
        ),
        reconnectGraceCount: countOf(
          sql`${realtimeSessions.state} = 'reconnecting'
            and ${realtimeSessions.stateEnteredAt} <= ${new Date(
              now.getTime() - rtcReconnectGraceMilliseconds,
            )}`,
        ),
      })
      .from(realtimeSessions);
    const session = rows.at(0);

    const obligations = await executor
      .select({
        age: ageOf(realtimeProviderObligations.availableAt),
        count: sql<string>`count(*)::text`,
      })
      .from(realtimeProviderObligations)
      .where(
        and(
          eq(realtimeProviderObligations.state, 'pending'),
          sql`${realtimeProviderObligations.availableAt} <= ${now}`,
        ),
      );
    const events = await executor
      .select({
        age: ageOf(realtimeProviderEvents.availableAt),
        count: sql<string>`count(*)::text`,
      })
      .from(realtimeProviderEvents)
      .where(
        and(
          sql`${realtimeProviderEvents.state} in ('received', 'retry_wait')`,
          sql`${realtimeProviderEvents.availableAt} <= ${now}`,
        ),
      );

    const measured: Readonly<
      Record<RtcBacklogKind, { age: string | null; count: string | undefined }>
    > = {
      invitation_expiry: {
        age: session?.invitationExpiry ?? null,
        count: session?.invitationExpiryCount,
      },
      join_timeout: {
        age: session?.joinTimeout ?? null,
        count: session?.joinTimeoutCount,
      },
      provider_event: {
        age: events.at(0)?.age ?? null,
        count: events.at(0)?.count,
      },
      provider_obligation: {
        age: obligations.at(0)?.age ?? null,
        count: obligations.at(0)?.count,
      },
      reconnect_grace: {
        age: session?.reconnectGrace ?? null,
        count: session?.reconnectGraceCount,
      },
    };

    return rtcBacklogKinds.map((kind) => {
      const thresholdSeconds = rtcBacklogThresholdMilliseconds[kind] / 1000;
      const count = Number(measured[kind].count ?? '0');
      const rawAge = measured[kind].age;
      // Rounded to whole seconds. The age is reported to a person and read by
      // an alert rule, and neither has any use for the microseconds Postgres
      // returns from `extract(epoch ...)`.
      const oldestAgeSeconds =
        count === 0 || rawAge === null ? undefined : Math.round(Number(rawAge));
      return {
        breached:
          oldestAgeSeconds !== undefined && oldestAgeSeconds > thresholdSeconds,
        count,
        oldestAgeSeconds,
        state: kind,
        thresholdSeconds,
      };
    });
  }

  /**
   * Calls that ended while their teardown did not discharge.
   *
   * A number rather than a list. The disagreement matters — the platform thinks
   * the call is over and a provider may still hold the room — but naming the
   * calls would name the conversations, and an operator who needs one has it
   * from reconciliation's own finding.
   */
  private async countEndedWithUndischargedTeardown(
    executor: Executor,
  ): Promise<number> {
    const rows = await executor
      .select({ count: sql<string>`count(*)::text` })
      .from(realtimeProviderObligations)
      .innerJoin(
        realtimeSessions,
        eq(realtimeProviderObligations.sessionId, realtimeSessions.id),
      )
      .where(
        and(
          eq(realtimeProviderObligations.state, 'pending'),
          isNotNull(realtimeSessions.endedAt),
          sql`${realtimeSessions.state} in (${sql.raw(
            terminalRtcSessionStates.map((state) => `'${state}'`).join(', '),
          )})`,
        ),
      );
    return Number(rows.at(0)?.count ?? '0');
  }
}

/** Seconds since the oldest of a set of instants, as text. */
function ageOf(column: unknown) {
  return sql<
    string | null
  >`extract(epoch from (now() - min(${column as never})))::text`;
}

function countOf(predicate: unknown) {
  return sql<string>`count(*) filter (where ${predicate as never})::text`;
}

/** Every declared state present, whatever the query returned. */
function fill(
  states: readonly string[],
  rows: readonly { readonly count: string; readonly state: string }[],
): readonly RtcStateCount[] {
  const counted = new Map(rows.map((row) => [row.state, Number(row.count)]));
  return states.map((state) => ({ count: counted.get(state) ?? 0, state }));
}
