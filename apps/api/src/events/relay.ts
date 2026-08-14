import type { SafeLogger } from '@velora/observability/server';

import type { OutboxSourceRepository } from './outbox.js';
import type { OutboxRow } from './outbox-table.js';

/**
 * The durable worker that publishes what a producer committed.
 *
 * It is the second half of the outbox pattern and the half that has to survive
 * being killed. Everything it does is therefore recorded in PostgreSQL before
 * it is acted on: the claim is a lease on a row, the outcome is a state
 * transition on the same row, and neither is held in memory across a restart.
 * A relay that dies mid-dispatch loses nothing — its lease expires and the next
 * relay claims the row again.
 *
 * Delivery is at-least-once, which is a property of the design and not a
 * shortcoming of it. Making it once would require the consumer's side effect
 * and the row's state transition to commit together, which is impossible when
 * the effect is remote. Consumers are therefore required to be idempotent, and
 * the event's immutable identity is what lets them be.
 */

export interface OutboxEvent {
  readonly attempts: number;
  readonly correlationId: string | null;
  readonly eventName: string;
  readonly eventVersion: number;
  readonly id: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
  readonly producer: string;
  readonly subjectId: string | null;
  readonly subjectType: string;
}

/**
 * A registered reader of one versioned event name.
 *
 * `handle` must be idempotent against `event.id`. It is called again whenever a
 * relay dies after the side effect and before the state transition, and there
 * is no arrangement of this code that removes that case.
 */
export interface OutboxConsumer {
  readonly eventName: string;
  handle(event: OutboxEvent): Promise<void>;
}

export interface OutboxSource {
  readonly producer: string;
  readonly repository: OutboxSourceRepository;
}

export interface OutboxRelayPolicy {
  /** Retirement threshold. A row that reaches it is dead-lettered and alerted. */
  readonly maximumAttempts: number;
  /** How long a claim stays valid without being settled. */
  readonly leaseMilliseconds: number;
  readonly batchSize: number;
  readonly backoffMilliseconds: (attempts: number) => number;
}

export const defaultOutboxRelayPolicy: OutboxRelayPolicy = {
  backoffMilliseconds: (attempts) =>
    // Deterministic, capped exponential. No jitter: a handful of relays draining
    // one table are already spread apart by `skip locked`, and a reproducible
    // schedule is worth more here than the thundering-herd protection jitter
    // buys a fleet that does not yet exist.
    Math.min(2 ** Math.max(0, attempts) * 1_000, 300_000),
  batchSize: 50,
  leaseMilliseconds: 60_000,
  maximumAttempts: 8,
};

export interface RelayCycleReport {
  readonly claimed: number;
  readonly deadLettered: number;
  readonly dispatched: number;
  readonly retried: number;
}

function eventOf(row: OutboxRow, producer: string): OutboxEvent {
  return {
    attempts: row.attempts,
    correlationId: row.correlationId,
    eventName: row.eventName,
    eventVersion: row.eventVersion,
    id: row.id,
    occurredAt: row.occurredAt,
    payload: row.payload,
    producer,
    subjectId: row.subjectId,
    subjectType: row.subjectType,
  };
}

export class OutboxRelay {
  private readonly consumersByEvent: ReadonlyMap<
    string,
    readonly OutboxConsumer[]
  >;

  constructor(
    private readonly dependencies: {
      readonly consumers: readonly OutboxConsumer[];
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly owner: string;
      readonly policy?: OutboxRelayPolicy;
      readonly sources: readonly OutboxSource[];
    },
  ) {
    const grouped = new Map<string, OutboxConsumer[]>();
    for (const consumer of dependencies.consumers) {
      const existing = grouped.get(consumer.eventName) ?? [];
      existing.push(consumer);
      grouped.set(consumer.eventName, existing);
    }
    this.consumersByEvent = grouped;
  }

  private get policy(): OutboxRelayPolicy {
    return this.dependencies.policy ?? defaultOutboxRelayPolicy;
  }

  /** Drains every registered source once. Returns what it did, for tests and metrics. */
  async dispatchOnce(): Promise<RelayCycleReport> {
    let claimed = 0;
    let deadLettered = 0;
    let dispatched = 0;
    let retried = 0;
    for (const source of this.dependencies.sources) {
      const report = await this.dispatchSource(source);
      claimed += report.claimed;
      deadLettered += report.deadLettered;
      dispatched += report.dispatched;
      retried += report.retried;
    }
    return { claimed, deadLettered, dispatched, retried };
  }

  private async dispatchSource(
    source: OutboxSource,
  ): Promise<RelayCycleReport> {
    const now = this.dependencies.now();
    const claim = await source.repository.claim({
      leaseMilliseconds: this.policy.leaseMilliseconds,
      limit: this.policy.batchSize,
      now,
      owner: this.dependencies.owner,
    });

    let deadLettered = 0;
    let dispatched = 0;
    let retried = 0;
    for (const row of claim.rows) {
      const outcome = await this.publish(source, row);
      if (outcome === 'dispatched') dispatched += 1;
      else if (outcome === 'dead_letter') deadLettered += 1;
      else retried += 1;
    }
    return { claimed: claim.rows.length, deadLettered, dispatched, retried };
  }

  private async publish(
    source: OutboxSource,
    row: OutboxRow,
  ): Promise<'dispatched' | 'dead_letter' | 'retry'> {
    const event = eventOf(row, source.producer);
    const consumers = this.consumersByEvent.get(row.eventName);
    try {
      if (consumers === undefined || consumers.length === 0) {
        // An unrouted event is a deployment mistake, not a fact to discard. It
        // retries — a consumer may be a rolling deploy away — and then retires
        // loudly, still holding its payload for whoever repairs it.
        throw new Error(`No consumer registered for ${row.eventName}`);
      }
      // Sequentially, so one consumer's failure does not leave another's
      // side effect unrecorded in the same attempt.
      for (const consumer of consumers) await consumer.handle(event);
    } catch (error) {
      return this.settleFailure(source, row, error);
    }

    const settled = await source.repository.markDispatched({
      id: row.id,
      now: this.dependencies.now(),
      owner: this.dependencies.owner,
    });
    if (!settled) {
      // The lease expired while the consumer ran and somebody else owns the row
      // now. The side effect stands; the other relay will repeat it, and the
      // consumer's idempotency is what makes that harmless.
      this.dependencies.logger.warn(
        {
          eventId: row.id,
          eventName: row.eventName,
          producer: source.producer,
        },
        'outbox lease expired before dispatch was recorded',
      );
      return 'retry';
    }
    return 'dispatched';
  }

  private async settleFailure(
    source: OutboxSource,
    row: OutboxRow,
    error: unknown,
  ): Promise<'dead_letter' | 'retry'> {
    const now = this.dependencies.now();
    const attempts = row.attempts + 1;
    const deadLetter = attempts >= this.policy.maximumAttempts;
    await source.repository.markFailed({
      availableAt: new Date(
        now.getTime() + this.policy.backoffMilliseconds(attempts),
      ),
      deadLetter,
      id: row.id,
      now,
      owner: this.dependencies.owner,
      // A code, not a message. The error itself goes to the log, which is
      // redacted; the row is read by operators and must not become a place
      // where a payload fragment leaks into a different audience.
      reason: deadLetter ? 'attempts_exhausted' : 'dispatch_failed',
    });
    const fields = {
      attempts,
      error,
      eventId: row.id,
      eventName: row.eventName,
      producer: source.producer,
    };
    if (deadLetter) {
      // Loud on purpose. A dead-lettered event is a fact the platform owes
      // somebody and has not delivered.
      this.dependencies.logger.error(fields, 'outbox event dead-lettered');
    } else {
      this.dependencies.logger.warn(fields, 'outbox dispatch failed');
    }
    return deadLetter ? 'dead_letter' : 'retry';
  }
}

/**
 * How often a relay drains its sources when nothing wakes it.
 *
 * The relay has no push notification of a committed row and deliberately does
 * not want one: polling is what makes it independent of whatever produced the
 * row, including a producer that crashed immediately afterwards.
 */
export const outboxRelayIntervalMilliseconds = 5_000;
