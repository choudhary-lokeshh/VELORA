import type { SafeLogger } from '@velora/observability/server';

/**
 * What a durable drain cycle did, said out loud when it is worth saying.
 *
 * Three loops in this platform claim rows, attempt an external effect, and
 * retire what has failed too often: the outbox relay that turns every committed
 * domain fact into a delivered notification, the billing drain that applies a
 * provider's verified confirmations, and the identity drain that applies
 * assurance results. Each returns a count of what it retired, and nothing read
 * those counts.
 *
 * That gap was specific rather than general. `Poller` logs a cycle that
 * *throws*, and a dead letter does not throw — it is the ordinary, documented
 * outcome of a row that has exhausted its bounded retry budget. So the most
 * consequential thing these loops can produce was the only thing they did
 * silently: a fact committed and never delivered anywhere, a settled payment's
 * confirmation never applied, an assurance result never recorded. Each of those
 * needs an operator, and none of them said so.
 *
 * Three levels, because the three outcomes want different reactions:
 *
 * - **Silence** when the cycle claimed nothing. That is the ordinary case and
 *   would otherwise be a line every few seconds saying nothing happened, which
 *   is how a log stops being read.
 * - **`warn`** when something was deferred. A provider having a moment is
 *   usually this, and it usually resolves itself on the next attempt.
 * - **`error`** when something was retired. That is permanent: no later cycle
 *   will pick it up, and nothing else in the platform is watching for it.
 *
 * Counts only, and never an identifier. What an operator needs is how much is
 * stuck and whether it is falling; whose payment it was belongs to the audit
 * trail, not to a line in a log that a wider audience reads.
 */
export interface DrainCycleReport {
  readonly claimed: number;
  readonly deadLettered: number;
  readonly retried: number;
}

export function reportDrainCycle(
  logger: SafeLogger,
  drain: string,
  report: DrainCycleReport,
): void {
  if (report.claimed === 0) return;
  const cycle = {
    claimed: report.claimed,
    deadLettered: report.deadLettered,
    drain,
    retried: report.retried,
  };
  if (report.deadLettered > 0) {
    logger.error(cycle, 'durable work retired without being delivered');
    return;
  }
  if (report.retried > 0) {
    logger.warn(cycle, 'durable work deferred for another attempt');
    return;
  }
  logger.info(cycle, 'durable work drained');
}
