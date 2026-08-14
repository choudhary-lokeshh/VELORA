import type { SafeLogger } from '@velora/observability/server';

/**
 * A recurring, non-overlapping background cycle.
 *
 * Two things here are load-bearing. Cycles never overlap: a slow drain must not
 * accumulate concurrent copies of itself, because each one would re-claim the
 * same rows the moment their leases expired. And a throwing cycle is logged
 * rather than propagated: a poll that fails because PostgreSQL was briefly
 * unreachable must not tear down the worker that will succeed on the next one.
 *
 * The timer is unreferenced, so it never by itself keeps a process alive. What
 * keeps the worker alive is the worker.
 */
export class Poller {
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly dependencies: {
      readonly cycle: () => Promise<unknown>;
      readonly intervalMilliseconds: number;
      readonly logger: SafeLogger;
      readonly name: string;
    },
  ) {}

  start(): void {
    if (this.timer !== undefined || this.stopped) return;
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
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }
}
