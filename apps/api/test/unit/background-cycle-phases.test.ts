import { describe, expect, it } from 'bun:test';

import { outboxRelayIntervalMilliseconds } from '../../src/events/relay.js';
import { identityReconciliationIntervalMilliseconds } from '../../src/identity/policy.js';
import {
  mediaInspectionIntervalMilliseconds,
  mediaProcessingIntervalMilliseconds,
  mediaReconciliationIntervalMilliseconds,
  mediaRemovalIntervalMilliseconds,
  mediaUploadSweepIntervalMilliseconds,
} from '../../src/media/policy.js';
import { deliverySweepIntervalMilliseconds } from '../../src/notifications/policy.js';
import {
  rtcObligationDrainIntervalMilliseconds,
  rtcSweepIntervalMilliseconds,
} from '../../src/realtime/policy.js';
import { profileMediaReadinessIntervalMilliseconds } from '../../src/users/profile-policy.js';
import {
  backgroundCyclePhaseMilliseconds,
  financialReconciliationIntervalMilliseconds,
  safetyDeadlineSweepIntervalMilliseconds,
} from '../../src/worker.js';

/**
 * Background cycles must not arrive together.
 *
 * They used to. Every poller was started in one synchronous loop and every
 * interval was a multiple of five seconds, so their timers aligned and stayed
 * aligned: eight cycles every five seconds, sixteen every sixty, all demanding
 * a database permit in the same millisecond from a bound of eight. The bound
 * refused the excess and an idle developer machine produced a stream of
 * `Database admission capacity is exhausted` at high severity.
 *
 * The property below is what replaced it, and it is arithmetic rather than
 * timing: two cycles started `phase` apart can only ever coincide when that
 * difference is a whole number of `gcd(interval, interval)` — so if no pair's
 * phase difference divides evenly into their shared period, no pair ever fires
 * in the same millisecond, for the life of the process.
 *
 * This is deliberately written against the real interval constants. A poller
 * added later with an interval that breaks the property fails here, at the one
 * moment somebody can still choose a different number.
 */

/** Every interval the worker actually schedules a cycle on. */
const workerCycleIntervals = [
  // Three cycles share the relay interval: the outbox relay itself, and the
  // billing and identity provider-event drains.
  outboxRelayIntervalMilliseconds,
  outboxRelayIntervalMilliseconds,
  outboxRelayIntervalMilliseconds,
  identityReconciliationIntervalMilliseconds,
  financialReconciliationIntervalMilliseconds,
  rtcObligationDrainIntervalMilliseconds,
  rtcSweepIntervalMilliseconds,
  safetyDeadlineSweepIntervalMilliseconds,
  mediaUploadSweepIntervalMilliseconds,
  mediaInspectionIntervalMilliseconds,
  mediaProcessingIntervalMilliseconds,
  profileMediaReadinessIntervalMilliseconds,
  mediaRemovalIntervalMilliseconds,
  mediaReconciliationIntervalMilliseconds,
  // Two cycles share the delivery interval: the delivery sweep and the
  // provider-feedback sweep.
  deliverySweepIntervalMilliseconds,
  deliverySweepIntervalMilliseconds,
];

function greatestCommonDivisor(first: number, second: number): number {
  let a = first;
  let b = second;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

describe('background cycles never arrive together', () => {
  it('gives every cycle a phase no other cycle can ever share', () => {
    const phases = workerCycleIntervals.map(
      (_, index) => index * backgroundCyclePhaseMilliseconds,
    );

    for (let i = 0; i < workerCycleIntervals.length; i += 1) {
      for (let j = i + 1; j < workerCycleIntervals.length; j += 1) {
        const period = greatestCommonDivisor(
          workerCycleIntervals[i] ?? 0,
          workerCycleIntervals[j] ?? 0,
        );
        const separation = Math.abs((phases[i] ?? 0) - (phases[j] ?? 0));
        expect(
          separation % period,
          `cycles ${String(i)} and ${String(j)} coincide every ${String(period)}ms`,
        ).not.toBe(0);
      }
    }
  });

  it('spreads every cycle inside the shortest interval', () => {
    // A spread wider than the shortest interval would push a cycle past its
    // own first firing, which is a different schedule rather than a phase.
    const span =
      (workerCycleIntervals.length - 1) * backgroundCyclePhaseMilliseconds;
    expect(span).toBeLessThan(Math.min(...workerCycleIntervals));
  });
});
