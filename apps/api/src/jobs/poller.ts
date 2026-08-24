import type { SafeLogger } from '@velora/observability/server';

/**
 * A recurring, non-overlapping background cycle.
 *
 * Three things here are load-bearing. Cycles never overlap: a slow drain must
 * not accumulate concurrent copies of itself, because each one would re-claim
 * the same rows the moment their leases expired. A throwing cycle is logged
 * rather than propagated: a poll that fails because PostgreSQL was briefly
 * unreachable must not tear down the worker that will succeed on the next one.
 * And a cycle can be given a starting phase, which is what stops sixteen of
 * these from asking the database for a connection in the same millisecond.
 *
 * Both timers are unreferenced, so they never by themselves keep a process
 * alive. What keeps the worker alive is the worker.
 */
export class Poller {
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private phaseTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly dependencies: {
      readonly cycle: () => Promise<unknown>;
      readonly intervalMilliseconds: number;
      readonly logger: SafeLogger;
      readonly name: string;
    },
  ) {}

  /** Whether the recurring timer is running. A cycle in flight is not this. */
  get scheduling(): boolean {
    return this.timer !== undefined || this.phaseTimer !== undefined;
  }

  /**
   * Begins the recurring cycle, optionally a fixed offset into its interval.
   *
   * `phaseMilliseconds` moves this cycle's whole schedule rather than delaying
   * one run: every later firing is offset by it too. That is the point. A
   * caller starting many pollers at once gives each a different phase so their
   * intervals never coincide, and the interval itself is untouched — nothing
   * about how often work is looked for changes.
   */
  start(phaseMilliseconds = 0): void {
    if (this.scheduling || this.stopped) return;
    if (phaseMilliseconds <= 0) {
      this.schedule();
      return;
    }
    // The phase shifts the schedule; it does not add a run. The first cycle
    // still lands one interval after the phase, exactly as it landed one
    // interval after `start()` before phases existed.
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = undefined;
      if (this.stopped) return;
      this.schedule();
    }, phaseMilliseconds);
    this.phaseTimer.unref();
  }

  private schedule(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.dependencies.intervalMilliseconds);
    this.timer.unref();
  }

  /** Runs one cycle now, skipping if one is already in flight. */
  async runOnce(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.inFlight = (async () => {
      try {
        await this.dependencies.cycle();
      } catch (error) {
        this.dependencies.logger.error(
          { error, poller: this.dependencies.name },
          'background cycle failed',
        );
      } finally {
        this.running = false;
      }
    })();
    await this.inFlight;
  }

  /** Stops scheduling and waits for a cycle already in flight to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.phaseTimer !== undefined) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = undefined;
    }
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }
}
