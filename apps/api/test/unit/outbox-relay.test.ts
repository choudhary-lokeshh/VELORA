import { describe, expect, it } from 'bun:test';

import type {
  OutboxClaim,
  OutboxSourceRepository,
} from '../../src/events/outbox.js';
import type { OutboxRow } from '../../src/events/outbox-table.js';
import {
  defaultOutboxRelayPolicy,
  OutboxRelay,
  type OutboxConsumer,
  type OutboxEvent,
} from '../../src/events/relay.js';
import { silentLogger } from '../support/harness.js';

const now = new Date('2026-08-14T10:00:00.000Z');

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    attempts: 0,
    availableAt: now,
    correlationId: null,
    createdAt: now,
    dispatchedAt: null,
    eventName: 'messaging.message.sent.v1',
    eventVersion: 1,
    failureReason: null,
    id: '11111111-1111-4111-8111-111111111111',
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    leaseOwner: 'relay-1',
    occurredAt: now,
    payload: { conversationId: 'c' },
    sequence: 1,
    state: 'pending',
    subjectId: null,
    subjectType: 'messaging.conversation',
    updatedAt: now,
    ...overrides,
  };
}

interface Settlement {
  readonly deadLetter: boolean;
  readonly reason: string;
  readonly availableAt: Date;
}

/**
 * A source whose rows and settlements are inspectable. The relay's retry and
 * retirement arithmetic is decided entirely by what it writes back, so that is
 * what these tests read.
 */
function fakeSource(
  rows: readonly OutboxRow[],
  options: { readonly dispatchSucceeds?: boolean } = {},
) {
  const failures: Settlement[] = [];
  const dispatched: string[] = [];
  const repository: OutboxSourceRepository = {
    claim(): Promise<OutboxClaim> {
      return Promise.resolve({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        rows,
      });
    },
    markDispatched(input): Promise<boolean> {
      dispatched.push(input.id);
      return Promise.resolve(options.dispatchSucceeds ?? true);
    },
    markFailed(input): Promise<boolean> {
      failures.push({
        availableAt: input.availableAt,
        deadLetter: input.deadLetter,
        reason: input.reason,
      });
      return Promise.resolve(true);
    },
  };
  return { dispatched, failures, repository };
}

function consumer(
  handle: (event: OutboxEvent) => Promise<void>,
  eventName = 'messaging.message.sent.v1',
): OutboxConsumer {
  return { eventName, handle };
}

function relayOver(
  source: { readonly repository: OutboxSourceRepository },
  consumers: readonly OutboxConsumer[],
  logs: unknown[] = [],
) {
  return new OutboxRelay({
    consumers,
    logger: silentLogger(logs),
    now: () => now,
    owner: 'relay-1',
    sources: [{ producer: 'messaging', repository: source.repository }],
  });
}

describe('outbox relay', () => {
  it('records the dispatch only after every consumer has accepted the fact', async () => {
    const order: string[] = [];
    const source = fakeSource([row()]);
    const relay = relayOver(source, [
      consumer(async () => {
        order.push('consumer');
        await Promise.resolve();
      }),
    ]);

    const report = await relay.dispatchOnce();

    expect(report).toEqual({
      claimed: 1,
      deadLettered: 0,
      dispatched: 1,
      retried: 0,
    });
    // If this order ever inverts, a worker killed between the two would leave a
    // fact marked published that nobody ever consumed.
    expect(order).toEqual(['consumer']);
    expect(source.dispatched).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(source.failures).toEqual([]);
  });

  it('keeps a failed fact claimable rather than dropping it', async () => {
    const source = fakeSource([row({ attempts: 1 })]);
    const relay = relayOver(source, [
      consumer(() => Promise.reject(new Error('consumer unavailable'))),
    ]);

    const report = await relay.dispatchOnce();

    expect(report.retried).toBe(1);
    expect(report.dispatched).toBe(0);
    expect(source.failures[0]?.deadLetter).toBe(false);
    expect(source.failures[0]?.reason).toBe('dispatch_failed');
    expect(source.failures[0]?.availableAt.getTime()).toBe(
      now.getTime() + defaultOutboxRelayPolicy.backoffMilliseconds(2),
    );
  });

  it('retires a fact that has exhausted its budget, loudly and without deleting it', async () => {
    const logs: unknown[] = [];
    const source = fakeSource([
      row({ attempts: defaultOutboxRelayPolicy.maximumAttempts - 1 }),
    ]);
    const relay = relayOver(
      source,
      [consumer(() => Promise.reject(new Error('still broken')))],
      logs,
    );

    const report = await relay.dispatchOnce();

    expect(report.deadLettered).toBe(1);
    expect(source.failures[0]?.deadLetter).toBe(true);
    expect(source.failures[0]?.reason).toBe('attempts_exhausted');
    // A retired fact is something the platform owed somebody and did not
    // deliver, so it is an error rather than a warning.
    expect(
      logs.some(
        (entry) =>
          (entry as { message?: string }).message ===
          'outbox event dead-lettered',
      ),
    ).toBe(true);
  });

  it('treats an unrouted event as a deployment fault, not as a fact to discard', async () => {
    const source = fakeSource([row({ eventName: 'messaging.unknown.v1' })]);
    const relay = relayOver(source, [consumer(() => Promise.resolve())]);

    const report = await relay.dispatchOnce();

    expect(report.dispatched).toBe(0);
    expect(source.failures).toHaveLength(1);
    expect(source.failures[0]?.deadLetter).toBe(false);
  });

  it('lets the next owner repeat a dispatch whose lease expired mid-flight', async () => {
    const logs: unknown[] = [];
    const source = fakeSource([row()], { dispatchSucceeds: false });
    const relay = relayOver(source, [consumer(() => Promise.resolve())], logs);

    const report = await relay.dispatchOnce();

    // The side effect stands and the row stays claimable. Redelivery is safe
    // because consumers deduplicate on the event's immutable identity.
    expect(report.retried).toBe(1);
    expect(report.dispatched).toBe(0);
    expect(source.failures).toEqual([]);
  });

  it('hands the consumer the producer that published the fact', async () => {
    const seen: OutboxEvent[] = [];
    const source = fakeSource([row()]);
    const relay = relayOver(source, [
      consumer((event) => {
        seen.push(event);
        return Promise.resolve();
      }),
    ]);

    await relay.dispatchOnce();

    expect(seen[0]?.producer).toBe('messaging');
    expect(seen[0]?.id).toBe('11111111-1111-4111-8111-111111111111');
  });
});
