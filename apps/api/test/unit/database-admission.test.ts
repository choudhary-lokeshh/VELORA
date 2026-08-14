import { describe, expect, it } from 'bun:test';

import {
  DatabaseAdmission,
  DatabaseSaturatedError,
  databaseAdmissionLimit,
  databaseAdmissionWaitMilliseconds,
  type AdmissionTimers,
} from '../../src/database/admission.js';

/**
 * The bound that keeps this process from queueing for a pooled connection.
 *
 * The properties below are the ones the pool depends on, and each of them is a
 * way the bound could fail open: more work in flight than permitted, a permit
 * lost to a throw, a waiter that never leaves the queue, or a wait that never
 * ends. Time is injected rather than slept, so none of these is a race against
 * a real clock.
 */

/**
 * A clock nothing advances by itself.
 *
 * `advance` runs the timers that have come due, in scheduled order, which is
 * what makes "the bounded wait expired" an assertion rather than a sleep.
 */
function fakeTimers(): AdmissionTimers & {
  advance(milliseconds: number): void;
  pending(): number;
} {
  let current = 0;
  let nextId = 1;
  const scheduled = new Map<
    number,
    { readonly callback: () => void; readonly dueAt: number }
  >();
  return {
    advance(milliseconds) {
      current += milliseconds;
      const due = [...scheduled.entries()]
        .filter(([, entry]) => entry.dueAt <= current)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [id, entry] of due) {
        scheduled.delete(id);
        entry.callback();
      }
    },
    clearTimeout(handle) {
      scheduled.delete(handle as number);
    },
    now() {
      return current;
    },
    pending() {
      return scheduled.size;
    },
    setTimeout(callback, milliseconds) {
      const id = nextId;
      nextId += 1;
      scheduled.set(id, { callback, dueAt: current + milliseconds });
      return id;
    },
  };
}

/** A unit of work the test finishes when it chooses to. */
function deferred(): {
  readonly promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolveInner, rejectInner) => {
    resolve = resolveInner;
    reject = rejectInner;
  });
  return { promise, reject, resolve };
}

/** Lets every already-scheduled microtask run before asserting on counters. */
async function settle(): Promise<void> {
  for (let remaining = 4; remaining > 0; remaining -= 1) {
    await Promise.resolve();
  }
}

/** The repository's idiom for a rejection: catch it, then assert on it. */
async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A unit of work that finishes immediately, typed as the runner expects. */
function immediate(effect: () => void = () => undefined): () => Promise<void> {
  return () => {
    effect();
    return Promise.resolve();
  };
}

describe('database admission', () => {
  it('admits exactly the configured number of units at once', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ timers });
    const work = Array.from({ length: databaseAdmissionLimit + 1 }, () =>
      deferred(),
    );
    const running = work.map((unit) => admission.run(() => unit.promise));

    await settle();

    // The ninth is waiting, not running. The pool it protects is ten, so the
    // gap is what leaves a readiness probe and a migration a connection.
    expect(admission.snapshot().inFlight).toBe(databaseAdmissionLimit);
    expect(admission.snapshot().waiting).toBe(1);

    for (const unit of work) unit.resolve();
    await Promise.all(running);
    expect(admission.snapshot().inFlight).toBe(0);
    expect(admission.snapshot().waiting).toBe(0);
  });

  it('hands a released permit to the waiter that has waited longest', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const held = deferred();
    const order: string[] = [];

    const first = admission.run(async () => {
      order.push('first');
      await held.promise;
    });
    await settle();
    const second = admission.run(
      immediate(() => {
        order.push('second');
      }),
    );
    const third = admission.run(
      immediate(() => {
        order.push('third');
      }),
    );
    await settle();

    expect(order).toEqual(['first']);
    held.resolve();
    await Promise.all([first, second, third]);
    // FIFO, so a burst cannot starve the caller that arrived before it.
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('releases the permit when the work throws', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });

    const failure = await rejection(
      admission.run(() => Promise.reject(new Error('query failed'))),
    );
    expect(failure).toBeInstanceOf(Error);

    expect(admission.snapshot().inFlight).toBe(0);
    // And the next unit is admitted immediately rather than waiting.
    await admission.run(immediate());
    expect(admission.snapshot().inFlight).toBe(0);
    expect(admission.snapshot().waiting).toBe(0);
  });

  it('releases exactly one permit per unit, whatever the outcome', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 2, timers });

    await admission.run(immediate());
    expect(
      await rejection(
        admission.run(() => Promise.reject(new Error('query failed'))),
      ),
    ).toBeInstanceOf(Error);
    await admission.run(immediate());

    // A double release would show here as a negative count, and would let the
    // bound drift upward for the rest of the process's life.
    expect(admission.snapshot().inFlight).toBe(0);

    const held = [deferred(), deferred()];
    const running = held.map((unit) => admission.run(() => unit.promise));
    await settle();
    expect(admission.snapshot().inFlight).toBe(2);
    for (const unit of held) unit.resolve();
    await Promise.all(running);
    expect(admission.snapshot().inFlight).toBe(0);
  });

  it('refuses a unit that waits out the bound, without starting it', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const held = deferred();
    let started = false;

    const first = admission.run(() => held.promise);
    await settle();
    const refused = rejection(
      admission.run(
        immediate(() => {
          started = true;
        }),
      ),
    );
    await settle();

    timers.advance(databaseAdmissionWaitMilliseconds - 1);
    await settle();
    expect(admission.snapshot().waiting).toBe(1);

    timers.advance(1);
    expect(await refused).toBeInstanceOf(DatabaseSaturatedError);
    // The refusal is safe to retry precisely because the work never ran: no
    // transaction was opened and nothing external was attempted.
    expect(started).toBe(false);
    expect(admission.snapshot().saturated).toBe(1);
    expect(admission.snapshot().waiting).toBe(0);

    held.resolve();
    await first;
    expect(admission.snapshot().inFlight).toBe(0);
  });

  it('leaves nothing scheduled or queued once every unit has settled', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const held = deferred();

    const first = admission.run(() => held.promise);
    await settle();
    const queued = admission.run(immediate());
    await settle();
    expect(timers.pending()).toBe(1);

    held.resolve();
    await Promise.all([first, queued]);

    // A waiter's timer that outlived it would fire against a settled promise
    // and, worse, keep the queue entry alive. Both are checked here.
    expect(timers.pending()).toBe(0);
    expect(admission.snapshot().waiting).toBe(0);
    expect(admission.snapshot().inFlight).toBe(0);
  });

  it('drops a waiter whose caller went away, and admits the next one', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const held = deferred();
    const controller = new AbortController();
    let abandonedStarted = false;
    let followerStarted = false;

    const first = admission.run(() => held.promise);
    await settle();
    const abandoned = rejection(
      admission.run(
        immediate(() => {
          abandonedStarted = true;
        }),
        { signal: controller.signal },
      ),
    );
    const follower = admission.run(
      immediate(() => {
        followerStarted = true;
      }),
    );
    await settle();
    expect(admission.snapshot().waiting).toBe(2);

    controller.abort();
    expect(await abandoned).toBeDefined();
    expect(abandonedStarted).toBe(false);
    // Cancelling releases the queue slot rather than holding it until the
    // bound expires, so the caller behind it is not delayed by a departure.
    expect(admission.snapshot().waiting).toBe(1);
    expect(timers.pending()).toBe(1);

    held.resolve();
    await Promise.all([first, follower]);
    expect(followerStarted).toBe(true);
    expect(admission.snapshot().inFlight).toBe(0);
    expect(timers.pending()).toBe(0);
  });

  it('refuses a caller that was already cancelled before it asked', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const controller = new AbortController();
    controller.abort();
    let started = false;

    expect(
      await rejection(
        admission.run(
          immediate(() => {
            started = true;
          }),
          { signal: controller.signal },
        ),
      ),
    ).toBeDefined();

    expect(started).toBe(false);
    expect(admission.snapshot().inFlight).toBe(0);
  });

  it('reports what an operator needs and nothing about a caller', async () => {
    const timers = fakeTimers();
    const admission = new DatabaseAdmission({ limit: 1, timers });
    const held = deferred();

    const first = admission.run(() => held.promise);
    await settle();
    const queued = admission.run(immediate());
    await settle();
    timers.advance(40);
    held.resolve();
    await Promise.all([first, queued]);

    const snapshot = admission.snapshot();
    expect(snapshot.limit).toBe(1);
    expect(snapshot.granted).toBe(2);
    expect(snapshot.maxWaiting).toBe(1);
    expect(snapshot.waitMillisecondsMax).toBe(40);
    expect(snapshot.waitMillisecondsTotal).toBe(40);
    expect(snapshot.waitMilliseconds).toBe(databaseAdmissionWaitMilliseconds);
    expect(snapshot.saturated).toBe(0);
    // Counters only. Nothing here identifies a caller, a pair, or a payload,
    // which is what makes it safe to log on every saturation.
    expect(
      Object.values(snapshot).every((value) => typeof value === 'number'),
    ).toBe(true);
  });
});
