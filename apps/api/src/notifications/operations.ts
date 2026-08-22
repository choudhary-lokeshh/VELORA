import { eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import {
  attemptOutcomes,
  deliveryFailureClasses,
  notificationStates,
  providerEventStates,
  pushDeviceDisableReasons,
  suppressionReasons,
} from './policy.js';
import type { NotificationRepository } from './repository.js';
import {
  notificationAttempts,
  notificationIntents,
  notificationProviderEvents,
  notificationPushDevices,
} from './schema.js';

/**
 * What an operator may see of notification delivery.
 *
 * This lives in NOTIFICATIONS rather than in ADMIN, on the rule MEDIA's and
 * REALTIME's operational views already follow: nothing outside this domain
 * queries a `notifications_` table, and an operator genuinely needs the
 * technical lifecycle, so the query belongs where the rule is.
 *
 * **The state screen carries no identifier of any kind.** Not a notice, not an
 * account, not a device. It is counts and ages, because a screen an operator
 * watches all day must not become a window onto who is being told about whom.
 * One person being notified about another is not an operational fact.
 *
 * There is deliberately **no list and no search**. An operator able to page
 * through notices has a browsing surface over who contacts whom, which is not
 * an operations tool however it is labelled.
 *
 * The detail below is one delivery, reached only by an operator who already has
 * its identifier from a report or a finding. It carries the lifecycle, because
 * triaging a stuck notice without it is guesswork, and it carries **no
 * recipient, no subject, and no payload** — the whole question an operator has
 * is "why did this not go", and none of those three answer it.
 */

/** One count under a label. The same shape the other operational screens use. */
export interface NotificationStateCount {
  readonly count: number;
  readonly state: string;
}

export interface NotificationBacklog {
  readonly breached: boolean;
  readonly count: number;
  readonly oldestAgeSeconds?: number | undefined;
  readonly state: string;
  readonly thresholdSeconds: number;
}

export interface NotificationOperationalState {
  readonly adapters: { readonly deliveryChannel: string };
  readonly attempts: readonly NotificationStateCount[];
  readonly backlogs: readonly NotificationBacklog[];
  readonly devices: readonly NotificationStateCount[];
  readonly failures: readonly NotificationStateCount[];
  readonly intents: readonly NotificationStateCount[];
  readonly providerEvents: readonly NotificationStateCount[];
  readonly suppressions: readonly NotificationStateCount[];
}

export interface NotificationDeliveryDetail {
  readonly attemptOutcomes: readonly NotificationStateCount[];
  readonly attempts: number;
  readonly channel: string;
  readonly createdAt: string;
  readonly deliveredAt: string | undefined;
  readonly expiresAt: string;
  /** A redacted code from the last failure. Never a provider message. */
  readonly failureReason: string | undefined;
  readonly id: string;
  /** Whether a worker currently holds this notice. Not which one. */
  readonly leaseHeld: boolean;
  readonly nextAttemptAt: string;
  readonly state: string;
  readonly suppressionReason: string | undefined;
  readonly templateKey: string;
}

/** How long a class of owed work may sit before an operator should be told. */
export const notificationBacklogThresholdSeconds = 900;

export class NotificationOperations {
  constructor(
    private readonly dependencies: {
      readonly deliveryChannel: string;
      readonly now: () => Date;
      readonly repository: NotificationRepository;
    },
  ) {}

  async operationalState(): Promise<NotificationOperationalState> {
    const executor = this.dependencies.repository.transactionless;
    const now = this.dependencies.now();
    const [
      intents,
      attempts,
      failures,
      suppressions,
      providerEvents,
      devices,
      backlogs,
    ] = await Promise.all([
      this.countIntentStates(executor),
      this.countAttemptOutcomes(executor),
      this.countFailureClasses(executor),
      this.countSuppressions(executor),
      this.countProviderEventStates(executor),
      this.countDevices(executor),
      this.backlogs(executor, now),
    ]);
    return {
      adapters: { deliveryChannel: this.dependencies.deliveryChannel },
      attempts,
      backlogs,
      devices,
      failures,
      intents,
      providerEvents,
      suppressions,
    };
  }

  async deliveryDetail(
    id: string,
  ): Promise<NotificationDeliveryDetail | undefined> {
    const executor = this.dependencies.repository.transactionless;
    const rows = await executor
      .select()
      .from(notificationIntents)
      .where(eq(notificationIntents.id, id))
      .limit(1);
    const intent = rows[0];
    if (intent === undefined) return undefined;

    const outcomes = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationAttempts.outcome,
      })
      .from(notificationAttempts)
      .where(eq(notificationAttempts.intentId, id))
      .groupBy(notificationAttempts.outcome);

    return {
      attemptOutcomes: tally(outcomes, attemptOutcomes),
      attempts: intent.attempts,
      channel: intent.channel,
      createdAt: intent.createdAt.toISOString(),
      deliveredAt: intent.deliveredAt?.toISOString(),
      expiresAt: intent.expiresAt.toISOString(),
      failureReason: intent.failureReason ?? undefined,
      id: intent.id,
      // Whether somebody holds it, not who. The owner is a process identifier
      // and an operator cannot act on one.
      leaseHeld: intent.leaseOwner !== null,
      nextAttemptAt: intent.nextAttemptAt.toISOString(),
      state: intent.state,
      suppressionReason: intent.suppressionReason ?? undefined,
      templateKey: intent.templateKey,
    };
  }

  private async countIntentStates(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationIntents.state,
      })
      .from(notificationIntents)
      .groupBy(notificationIntents.state);
    return tally(rows, notificationStates);
  }

  private async countAttemptOutcomes(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationAttempts.outcome,
      })
      .from(notificationAttempts)
      .groupBy(notificationAttempts.outcome);
    return tally(rows, attemptOutcomes);
  }

  /**
   * Failures by the class that decided what happened next.
   *
   * This is the screen that answers "is something wrong with us or with a
   * destination". A wall of `transport` is an outage; a wall of `hard_bounce`
   * is a list problem; a wall of `invalid_token` is a fleet of devices that
   * should have been retired and were not.
   */
  private async countFailureClasses(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationAttempts.failureClass,
      })
      .from(notificationAttempts)
      .where(isNotNull(notificationAttempts.failureClass))
      .groupBy(notificationAttempts.failureClass);
    return tally(
      rows.map((row) => ({ count: row.count, state: row.state ?? '' })),
      deliveryFailureClasses,
    );
  }

  private async countSuppressions(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationIntents.suppressionReason,
      })
      .from(notificationIntents)
      .where(isNotNull(notificationIntents.suppressionReason))
      .groupBy(notificationIntents.suppressionReason);
    return tally(
      rows.map((row) => ({ count: row.count, state: row.state ?? '' })),
      suppressionReasons,
    );
  }

  private async countProviderEventStates(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const rows = await executor
      .select({
        count: sql<number>`count(*)::int`,
        state: notificationProviderEvents.state,
      })
      .from(notificationProviderEvents)
      .groupBy(notificationProviderEvents.state);
    return tally(rows, providerEventStates);
  }

  /**
   * Registrations by whether they are live, and by why they are not.
   *
   * `active` is a count of devices this platform believes it could reach. It is
   * reported beside the retirement reasons because the interesting comparison
   * is between them: a fleet retiring faster than it registers is a client bug,
   * and neither number says so alone.
   */
  private async countDevices(
    executor: Executor,
  ): Promise<readonly NotificationStateCount[]> {
    const [live, retired] = await Promise.all([
      executor
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationPushDevices)
        .where(isNull(notificationPushDevices.disabledAt)),
      executor
        .select({
          count: sql<number>`count(*)::int`,
          state: notificationPushDevices.disableReason,
        })
        .from(notificationPushDevices)
        .where(isNotNull(notificationPushDevices.disabledAt))
        .groupBy(notificationPushDevices.disableReason),
    ]);
    return [
      { count: live[0]?.count ?? 0, state: 'active' },
      ...tally(
        retired.map((row) => ({ count: row.count, state: row.state ?? '' })),
        pushDeviceDisableReasons,
      ),
    ];
  }

  /**
   * Owed work that is not moving, and how long it has not been moving.
   *
   * Two classes, because they fail for different reasons and an operator acts
   * on them differently: notices nobody has delivered, and provider events
   * nobody has applied.
   */
  private async backlogs(
    executor: Executor,
    now: Date,
  ): Promise<readonly NotificationBacklog[]> {
    const [owed, unapplied] = await Promise.all([
      executor
        .select({
          count: sql<number>`count(*)::int`,
          oldest: sql<Date | null>`min(${notificationIntents.createdAt})`,
        })
        .from(notificationIntents)
        .where(sql`${notificationIntents.state} in ('queued', 'attempted')`),
      executor
        .select({
          count: sql<number>`count(*)::int`,
          oldest: sql<Date | null>`min(${notificationProviderEvents.receivedAt})`,
        })
        .from(notificationProviderEvents)
        .where(
          sql`${notificationProviderEvents.state} in ('received', 'retry_wait')`,
        ),
    ]);
    return [
      backlogOf('undelivered', owed[0], now),
      backlogOf('unapplied_provider_events', unapplied[0], now),
    ];
  }
}

/**
 * Every declared value every time, including the zeroes.
 *
 * A list that omitted the healthy states could not tell an operator "nothing is
 * stuck" apart from "the signal stopped arriving", and those are opposite
 * situations.
 */
function tally(
  rows: readonly { readonly count: number; readonly state: string }[],
  declared: readonly string[],
): readonly NotificationStateCount[] {
  return declared.map((state) => ({
    count: rows.find((row) => row.state === state)?.count ?? 0,
    state,
  }));
}

function backlogOf(
  state: string,
  row: { readonly count: number; readonly oldest: Date | null } | undefined,
  now: Date,
): NotificationBacklog {
  const oldest = row?.oldest ?? null;
  const oldestAgeSeconds =
    oldest === null
      ? undefined
      : Math.max(
          0,
          Math.floor((now.getTime() - new Date(oldest).getTime()) / 1000),
        );
  return {
    breached:
      oldestAgeSeconds !== undefined &&
      oldestAgeSeconds > notificationBacklogThresholdSeconds,
    count: row?.count ?? 0,
    ...(oldestAgeSeconds === undefined ? {} : { oldestAgeSeconds }),
    state,
    thresholdSeconds: notificationBacklogThresholdSeconds,
  };
}
