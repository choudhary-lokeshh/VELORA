/**
 * Bounded admission to the PostgreSQL connection pool.
 *
 * This is resource protection, not business correctness. PostgreSQL remains the
 * only authority on whether two people may be introduced, blocked, or messaged;
 * a process-local permit decides nothing except how many units of work this
 * process may have touching the pool at one moment. Two replicas therefore have
 * two independent bounds and that is intended — see the multi-instance note in
 * `docs/engineering/03-jobs-idempotency-concurrency.md`.
 *
 * It exists because of a measured Bun.SQL defect. When a pool has to queue a
 * caller for a connection while it is also serving `begin()` transactions and
 * autocommit queries, it can permanently lose a connection: the backend is left
 * `idle in transaction` server-side and never returns to the pool, so the
 * instance degrades toward zero connections and stops answering. Reproduced on
 * Bun 1.3.14 with no VELORA code and no advisory lock involved. Keeping the
 * number of in-flight units below the pool size means the pool never has to
 * queue, which is the condition the defect needs.
 *
 * The wait is bounded so a saturated instance answers rather than hangs. A
 * caller that waits out the bound has not started its business action, which is
 * what makes the resulting 503 safe to retry.
 */

/** Units of work that may touch the pool at once, per process. */
export const databaseAdmissionLimit = 8;

/** How long a unit waits for a permit before the instance says it is full. */
export const databaseAdmissionWaitMilliseconds = 250;

/**
 * The instance is at its database admission limit and the bounded wait expired.
 *
 * The business action has not begun. Nothing was written, no transaction was
 * opened, and no external effect was attempted, so the caller may retry.
 */
export class DatabaseSaturatedError extends Error {
  constructor() {
    super('Database admission capacity is exhausted');
    this.name = 'DatabaseSaturatedError';
  }
}

/**
 * Clock and timer seam, so tests drive waiting deterministically rather than
 * sleeping. Production passes the platform's.
 */
export interface AdmissionTimers {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
}

const platformTimers: AdmissionTimers = {
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  now() {
    return performance.now();
  },
  setTimeout(callback, milliseconds) {
    return setTimeout(callback, milliseconds);
  },
};

export interface DatabaseAdmissionOptions {
  readonly limit?: number;
  readonly timers?: AdmissionTimers;
  readonly waitMilliseconds?: number;
}

/** Operational counters. Safe to log: no identifiers, no payloads. */
export interface DatabaseAdmissionSnapshot {
  /** Permits handed out since start, including those handed to waiters. */
  readonly granted: number;
  readonly inFlight: number;
  readonly limit: number;
  /** Deepest the waiter queue has ever been. */
  readonly maxWaiting: number;
  /** Units refused because the bounded wait expired. */
  readonly saturated: number;
  readonly waitMilliseconds: number;
  readonly waitMillisecondsMax: number;
  readonly waitMillisecondsTotal: number;
  readonly waiting: number;
}

interface Waiter {
  readonly enqueuedAt: number;
  readonly reject: (error: unknown) => void;
  readonly resolve: () => void;
  detachAbort?: (() => void) | undefined;
  settled: boolean;
  timer: unknown;
}

export class DatabaseAdmission {
  private readonly limit: number;
  private readonly timers: AdmissionTimers;
  private readonly waitMilliseconds: number;

  private grantedCount = 0;
  private inFlightCount = 0;
  private maxWaitingObserved = 0;
  private saturatedCount = 0;
  private waitMax = 0;
  private waitTotal = 0;
  /** FIFO. Every entry leaves within `waitMilliseconds`, by construction. */
  private readonly waiters: Waiter[] = [];

  constructor(options: DatabaseAdmissionOptions = {}) {
    this.limit = options.limit ?? databaseAdmissionLimit;
    this.timers = options.timers ?? platformTimers;
    this.waitMilliseconds =
      options.waitMilliseconds ?? databaseAdmissionWaitMilliseconds;
    if (this.limit < 1) throw new Error('Admission limit must be at least one');
  }

  /**
   * Runs one unit of work under one permit.
   *
   * The permit is released in `finally`, so a throw releases exactly as a
   * return does, and it is acquired exactly once per call — work that reaches
   * further database calls through the executor it was given is already inside
   * this unit and must not admit itself again.
   */
  async run<T>(
    work: () => Promise<T>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<T> {
    await this.acquire(options.signal);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  snapshot(): DatabaseAdmissionSnapshot {
    return {
      granted: this.grantedCount,
      inFlight: this.inFlightCount,
      limit: this.limit,
      maxWaiting: this.maxWaitingObserved,
      saturated: this.saturatedCount,
      waitMilliseconds: this.waitMilliseconds,
      waitMillisecondsMax: this.waitMax,
      waitMillisecondsTotal: this.waitTotal,
      waiting: this.waiters.length,
    };
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.inFlightCount < this.limit) {
      this.inFlightCount += 1;
      this.grantedCount += 1;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        enqueuedAt: this.timers.now(),
        reject,
        resolve,
        settled: false,
        timer: undefined,
      };
      waiter.timer = this.timers.setTimeout(() => {
        if (waiter.settled) return;
        this.remove(waiter);
        this.saturatedCount += 1;
        reject(new DatabaseSaturatedError());
      }, this.waitMilliseconds);
      if (signal !== undefined) {
        const onAbort = () => {
          if (waiter.settled) return;
          this.remove(waiter);
          // The caller's own reason when it gave one, so an aborted request is
          // distinguishable from a saturated instance.
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Database admission wait was aborted'),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.detachAbort = () => {
          signal.removeEventListener('abort', onAbort);
        };
      }
      this.waiters.push(waiter);
      if (this.waiters.length > this.maxWaitingObserved) {
        this.maxWaitingObserved = this.waiters.length;
      }
    });
  }

  /**
   * Hands the permit to the next waiter rather than returning it to the count.
   *
   * That is what keeps the bound exact under load: there is no window in which
   * the count has dropped and a newly arriving unit could overtake a caller
   * that has already been waiting.
   */
  private release(): void {
    const next = this.waiters.shift();
    if (next === undefined) {
      this.inFlightCount -= 1;
      return;
    }
    const waited = this.timers.now() - next.enqueuedAt;
    this.waitTotal += waited;
    if (waited > this.waitMax) this.waitMax = waited;
    this.settle(next);
    this.grantedCount += 1;
    next.resolve();
  }

  private remove(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index !== -1) this.waiters.splice(index, 1);
    this.settle(waiter);
  }

  /** Idempotent. Marks the waiter finished and drops what could still fire. */
  private settle(waiter: Waiter): void {
    waiter.settled = true;
    if (waiter.timer !== undefined) {
      this.timers.clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    waiter.detachAbort?.();
    waiter.detachAbort = undefined;
  }
}
