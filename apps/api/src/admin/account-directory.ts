import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { authSessions } from '../auth/schema.js';
import { bounded } from '../database/fan-out.js';
import { billingPayments, billingSubscriptions } from '../billing/schema.js';
import { creatorAccounts, creatorProfiles } from '../creators/schema.js';
import type { DatabaseHandle } from '../database/executor.js';
import { discoveryIntroductions } from '../discovery/schema.js';
import { growthSignupAttributions } from '../growth/schema.js';
import { liveEncounters, liveParticipations } from '../live/schema.js';
import { messagingConversations } from '../messaging/schema.js';
import { notificationPushDevices } from '../notifications/schema.js';
import {
  safetyAppeals,
  safetyBlocks,
  safetyEnforcements,
  safetyReports,
} from '../safety/schema.js';
import { supportTickets } from '../support/schema.js';
import { userAccounts, userProfiles } from '../users/schema.js';
import { walletBalances } from '../wallet/schema.js';

/**
 * One account, in every operational term that matters and none that do not.
 *
 * The shape of this read is the privacy boundary made concrete. An operator
 * opening somebody's record sees how many conversations they are in, not what
 * is in one; how many reports name them, not what a reporter wrote; that a
 * push device is registered, not its token; a balance, not a payment
 * instrument. Every field below was chosen by asking what an operator would do
 * differently if they knew it, and the ones that failed that test are not here.
 *
 * Specifically absent, and deliberately: display name, bio, photographs,
 * languages, availability, matching declaration, message bodies, report
 * narratives, ticket text, push tokens, provider references, and the account's
 * AUTH identity subject. Some of those are reachable by an operator with a
 * legitimate reason through the case, the ticket, or the moderation record that
 * justifies it — which is exactly the point: the reason comes first, and the
 * screen an operator opens by default carries none of them.
 */

export interface AccountSessionRow {
  readonly audience: string;
  readonly authenticatedAt: Date;
  readonly id: string;
  readonly lastActiveAt: Date;
  readonly revocationReason: string | undefined;
  readonly revokedAt: Date | undefined;
}

export interface AccountDeviceRow {
  readonly disableReason: string | undefined;
  readonly disabledAt: Date | undefined;
  readonly id: string;
  readonly lastSeenAt: Date;
  readonly platform: string;
  readonly registeredAt: Date;
}

export interface AccountEncounterRow {
  readonly endReason: string | undefined;
  readonly endedAt: Date | undefined;
  readonly id: string;
  readonly medium: string;
  readonly startedAt: Date;
  readonly state: string;
}

export interface OperationalCount {
  readonly label: string;
  readonly total: number;
}

export interface AccountDetail {
  readonly account: {
    readonly createdAt: Date;
    readonly deletionRequestedAt: Date | undefined;
    readonly id: string;
    readonly region: string | undefined;
    readonly status: string;
    readonly statusChangedAt: Date;
    readonly statusReason: string | undefined;
  };
  readonly acquisition:
    | {
        readonly attributedAt: Date;
        readonly campaign: string | undefined;
        readonly source: string;
        readonly viaInvitation: boolean;
      }
    | undefined;
  /** The AUTH account this consumer signs in with. Needed to read its timeline. */
  readonly authAccountId: string | undefined;
  readonly commerce: {
    readonly payments: readonly OperationalCount[];
    readonly subscriptions: readonly OperationalCount[];
  };
  readonly connections: {
    readonly conversations: number;
    readonly introductions: readonly OperationalCount[];
  };
  readonly creator:
    | {
        readonly handle: string | undefined;
        readonly id: string;
        readonly publishedAt: Date | undefined;
        readonly status: string;
      }
    | undefined;
  readonly devices: readonly AccountDeviceRow[];
  readonly live: {
    readonly encounters: readonly AccountEncounterRow[];
    /** What LIVE currently believes this person is doing, if anything. */
    readonly participation:
      | {
          readonly medium: string;
          readonly since: Date;
          readonly state: string;
        }
      | undefined;
  };
  /** Whether a profile exists at all. Never its contents. */
  readonly profileComplete: boolean;
  readonly safety: {
    readonly appeals: number;
    readonly blocksMade: number;
    readonly blocksReceived: number;
    readonly enforcements: readonly OperationalCount[];
    readonly reportsAbout: number;
    readonly reportsMade: number;
  };
  readonly sessions: readonly AccountSessionRow[];
  readonly support: readonly OperationalCount[];
  readonly wallet:
    { readonly available: string; readonly reserved: string } | undefined;
}

const recentSessionCount = 10;
const recentEncounterCount = 10;
const recentDeviceCount = 10;

function grouped(
  rows: readonly { readonly label: string | null; readonly total: number }[],
): readonly OperationalCount[] {
  return rows
    .filter(
      (row): row is { label: string; total: number } => row.label !== null,
    )
    .map((row) => ({ label: row.label, total: row.total }));
}

export class AdminAccountDirectory {
  constructor(private readonly database: DatabaseHandle) {}

  /**
   * Everything about one account, in one bounded round of reads.
   *
   * Nineteen selects, at most three in flight. Issuing them all at once was the
   * first thing this module did and it was wrong: a single screen took as many
   * pooled connections as it could get, and ADR-0019's admission bound counts
   * requests rather than queries, so what it produced was `503`s from a
   * platform that had capacity a moment earlier. Three at a time is fast enough
   * for a reader who is not racing anybody and leaves the pool to the product.
   *
   * Every list is bounded to its most recent handful and every aggregate is a
   * grouped count over an indexed column, so this read does not grow with the
   * account's history. The lists that would grow — encounters, sessions,
   * devices — are the ones an operator drills into elsewhere.
   */
  async detail(accountId: string): Promise<AccountDetail | undefined> {
    const accounts = await this.database
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, accountId))
      .limit(1);
    const account = accounts[0];
    if (account === undefined) return undefined;

    const authAccountId = account.authAccountId;
    const [
      profiles,
      sessions,
      devices,
      participations,
      encounters,
      introductions,
      conversations,
      blocksMade,
      blocksReceived,
      reportsMade,
      reportsAbout,
      enforcements,
      appeals,
      tickets,
      balances,
      payments,
      subscriptions,
      attributions,
      creator,
    ] = await bounded([
      async () =>
        this.database
          .select({ userId: userProfiles.userId })
          .from(userProfiles)
          .where(eq(userProfiles.userId, accountId))
          .limit(1),
      async () =>
        this.database
          .select({
            audience: authSessions.audience,
            authenticatedAt: authSessions.authenticatedAt,
            id: authSessions.id,
            lastActiveAt: authSessions.lastActiveAt,
            revocationReason: authSessions.revocationReason,
            revokedAt: authSessions.revokedAt,
          })
          .from(authSessions)
          .where(eq(authSessions.accountId, authAccountId))
          .orderBy(desc(authSessions.lastActiveAt))
          .limit(recentSessionCount),
      async () =>
        this.database
          .select({
            disableReason: notificationPushDevices.disableReason,
            disabledAt: notificationPushDevices.disabledAt,
            id: notificationPushDevices.id,
            lastSeenAt: notificationPushDevices.lastSeenAt,
            platform: notificationPushDevices.platform,
            registeredAt: notificationPushDevices.createdAt,
          })
          .from(notificationPushDevices)
          .where(eq(notificationPushDevices.recipientId, accountId))
          .orderBy(desc(notificationPushDevices.lastSeenAt))
          .limit(recentDeviceCount),
      async () =>
        this.database
          .select({
            medium: liveParticipations.medium,
            state: liveParticipations.state,
            stateEnteredAt: liveParticipations.stateEnteredAt,
          })
          .from(liveParticipations)
          .where(eq(liveParticipations.userId, accountId))
          .orderBy(desc(liveParticipations.stateEnteredAt))
          .limit(1),
      async () =>
        this.database
          .select({
            createdAt: liveEncounters.createdAt,
            endReason: liveEncounters.endReason,
            endedAt: liveEncounters.endedAt,
            id: liveEncounters.id,
            medium: liveEncounters.medium,
            state: liveEncounters.state,
          })
          .from(liveEncounters)
          .where(
            sql`${liveEncounters.pairHighId} = ${accountId} or ${liveEncounters.pairLowId} = ${accountId}`,
          )
          .orderBy(desc(liveEncounters.createdAt))
          .limit(recentEncounterCount),
      async () =>
        this.database
          .select({ label: discoveryIntroductions.state, total: count() })
          .from(discoveryIntroductions)
          .where(
            sql`${discoveryIntroductions.pairHighId} = ${accountId} or ${discoveryIntroductions.pairLowId} = ${accountId}`,
          )
          .groupBy(discoveryIntroductions.state),
      async () =>
        this.database
          .select({ total: count() })
          .from(messagingConversations)
          .where(
            sql`${messagingConversations.pairHighId} = ${accountId} or ${messagingConversations.pairLowId} = ${accountId}`,
          ),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyBlocks)
          .where(
            and(
              eq(safetyBlocks.blockerId, accountId),
              isNull(safetyBlocks.revokedAt),
            ),
          ),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyBlocks)
          .where(
            and(
              eq(safetyBlocks.blockedId, accountId),
              isNull(safetyBlocks.revokedAt),
            ),
          ),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyReports)
          .where(eq(safetyReports.reporterId, accountId)),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyReports)
          .where(eq(safetyReports.subjectId, accountId)),
      async () =>
        this.database
          .select({ label: safetyEnforcements.scope, total: count() })
          .from(safetyEnforcements)
          .where(eq(safetyEnforcements.subjectId, accountId))
          .groupBy(safetyEnforcements.scope),
      async () =>
        this.database
          .select({ total: count() })
          .from(safetyAppeals)
          .where(eq(safetyAppeals.appellantReference, accountId)),
      async () =>
        this.database
          .select({ label: supportTickets.status, total: count() })
          .from(supportTickets)
          .where(eq(supportTickets.ownerId, accountId))
          .groupBy(supportTickets.status),
      async () =>
        this.database
          .select({
            available: walletBalances.available,
            reserved: walletBalances.reserved,
          })
          .from(walletBalances)
          .where(eq(walletBalances.userId, accountId))
          .limit(1),
      async () =>
        this.database
          .select({ label: billingPayments.state, total: count() })
          .from(billingPayments)
          .where(eq(billingPayments.consumerId, accountId))
          .groupBy(billingPayments.state),
      async () =>
        this.database
          .select({ label: billingSubscriptions.state, total: count() })
          .from(billingSubscriptions)
          .where(eq(billingSubscriptions.consumerId, accountId))
          .groupBy(billingSubscriptions.state),
      async () =>
        this.database
          .select({
            attributedAt: growthSignupAttributions.attributedAt,
            campaign: growthSignupAttributions.campaign,
            inviteId: growthSignupAttributions.inviteId,
            source: growthSignupAttributions.source,
          })
          .from(growthSignupAttributions)
          .where(eq(growthSignupAttributions.userId, accountId))
          .limit(1),
      // A creator capability is held by the same AUTH account, not by the
      // consumer account, which is why this is keyed on the AUTH reference and
      // is absent for everybody who never became one.
      async () =>
        this.database
          .select({
            handle: creatorProfiles.handle,
            id: creatorAccounts.id,
            publishedAt: creatorProfiles.publishedAt,
            status: creatorAccounts.status,
          })
          .from(creatorAccounts)
          .leftJoin(
            creatorProfiles,
            eq(creatorProfiles.creatorId, creatorAccounts.id),
          )
          .where(eq(creatorAccounts.authAccountId, authAccountId))
          .limit(1),
    ]);

    const participation = participations[0];
    const balance = balances[0];
    const attribution = attributions[0];
    const creatorRow = creator[0];

    return {
      account: {
        createdAt: account.createdAt,
        deletionRequestedAt: account.deletionRequestedAt ?? undefined,
        id: account.id,
        region: account.region ?? undefined,
        status: account.status,
        statusChangedAt: account.statusChangedAt,
        statusReason: account.statusReason ?? undefined,
      },
      acquisition:
        attribution === undefined
          ? undefined
          : {
              attributedAt: attribution.attributedAt,
              campaign: attribution.campaign ?? undefined,
              source: attribution.source,
              viaInvitation: attribution.inviteId !== null,
            },
      authAccountId,
      commerce: {
        payments: grouped(payments),
        subscriptions: grouped(subscriptions),
      },
      connections: {
        conversations: conversations[0]?.total ?? 0,
        introductions: grouped(introductions),
      },
      creator:
        creatorRow === undefined
          ? undefined
          : {
              handle: creatorRow.handle ?? undefined,
              id: creatorRow.id,
              publishedAt: creatorRow.publishedAt ?? undefined,
              status: creatorRow.status,
            },
      devices: devices.map((row) => ({
        disableReason: row.disableReason ?? undefined,
        disabledAt: row.disabledAt ?? undefined,
        id: row.id,
        lastSeenAt: row.lastSeenAt,
        platform: row.platform,
        registeredAt: row.registeredAt,
      })),
      live: {
        encounters: encounters.map((row) => ({
          endReason: row.endReason ?? undefined,
          endedAt: row.endedAt ?? undefined,
          id: row.id,
          medium: row.medium,
          startedAt: row.createdAt,
          state: row.state,
        })),
        participation:
          participation === undefined || participation.state === 'left'
            ? undefined
            : {
                medium: participation.medium,
                since: participation.stateEnteredAt,
                state: participation.state,
              },
      },
      profileComplete: profiles.length > 0,
      safety: {
        appeals: appeals[0]?.total ?? 0,
        blocksMade: blocksMade[0]?.total ?? 0,
        blocksReceived: blocksReceived[0]?.total ?? 0,
        enforcements: grouped(enforcements),
        reportsAbout: reportsAbout[0]?.total ?? 0,
        reportsMade: reportsMade[0]?.total ?? 0,
      },
      sessions: sessions.map((row) => ({
        audience: row.audience,
        authenticatedAt: row.authenticatedAt,
        id: row.id,
        lastActiveAt: row.lastActiveAt,
        revocationReason: row.revocationReason ?? undefined,
        revokedAt: row.revokedAt ?? undefined,
      })),
      support: grouped(tickets),
      wallet:
        balance === undefined
          ? undefined
          : {
              // Rendered as a decimal string all the way to the screen. A coin
              // balance is an exact integer that outgrows a JavaScript number,
              // and a console that formatted one as a float would eventually
              // show somebody the wrong balance.
              available: balance.available.toString(),
              reserved: balance.reserved.toString(),
            },
    };
  }

  /** The AUTH account a consumer signs in with, for a timeline read. */
  async authAccountOf(accountId: string): Promise<string | undefined> {
    const rows = await this.database
      .select({ authAccountId: userAccounts.authAccountId })
      .from(userAccounts)
      .where(eq(userAccounts.id, accountId))
      .limit(1);
    return rows[0]?.authAccountId;
  }
}
