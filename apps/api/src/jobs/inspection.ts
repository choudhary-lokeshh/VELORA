import type { ServerConfig } from '@velora/config/server';
import { Queue } from 'bullmq';

import { bullMqConnectionFromUrl } from './connection.js';

/**
 * What a queue is doing, or the honest admission that nobody asked it.
 *
 * `unknown` is a first-class answer rather than a zero. A console that showed
 * "0 failed" for a queue it never reached would be reporting health it has no
 * evidence for, which is the exact failure §61 of the operator brief names: do
 * not say healthy merely because configuration exists.
 */
export interface JobQueueState {
  readonly active: number | undefined;
  readonly completed: number | undefined;
  readonly delayed: number | undefined;
  readonly failed: number | undefined;
  readonly name: string;
  readonly reachable: boolean;
  readonly waiting: number | undefined;
}

export interface JobQueueInspectionPort {
  inspect(): Promise<readonly JobQueueState[]>;
}

/**
 * Reads BullMQ's own counters over the queues this platform registers.
 *
 * Counts only. It never reads a job's payload, never lists jobs, and offers no
 * way to reach one — a notification job's payload names a recipient and an
 * intent, and an operator diagnosing a backlog needs the size of it, not the
 * contents. `docs/domains/operations.md` records that boundary; this class is
 * where it is kept.
 */
export class BullMqJobQueueInspector implements JobQueueInspectionPort {
  private readonly queues: readonly Queue[];

  /**
   * Whether the broker answered, on the shape the application's own dependency
   * list expects.
   *
   * It is on that list for one reason: these clients hold Redis connections,
   * and a connection nobody closes keeps the process alive after `SIGTERM`. A
   * shutdown that hangs is the failure this method exists to prevent, not a
   * health check somebody wanted.
   */
  async isReady(): Promise<boolean> {
    const states = await this.inspect();
    return states.every((state) => state.reachable);
  }

  constructor(config: ServerConfig, names: readonly string[]) {
    // One connection description per queue rather than one shared object. A
    // spread would flatten an `ioredis` instance into a plain object; building
    // the description afresh keeps whatever shape the helper returns.
    this.queues = names.map(
      (name) =>
        new Queue(name, {
          connection: bullMqConnectionFromUrl(config.QUEUE_REDIS_URL),
        }),
    );
  }

  async inspect(): Promise<readonly JobQueueState[]> {
    return Promise.all(
      this.queues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts(
            'active',
            'completed',
            'delayed',
            'failed',
            'waiting',
          );
          return {
            active: counts.active,
            completed: counts.completed,
            delayed: counts.delayed,
            failed: counts.failed,
            name: queue.name,
            reachable: true,
            waiting: counts.waiting,
          };
        } catch {
          // Redis is unreachable or the queue does not answer. That is itself
          // the operational fact worth showing, and it is shown as absence
          // rather than as zeroes.
          return {
            active: undefined,
            completed: undefined,
            delayed: undefined,
            failed: undefined,
            name: queue.name,
            reachable: false,
            waiting: undefined,
          };
        }
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}

/**
 * The inspector for a process that holds no queue client.
 *
 * Every integration harness in this repository injects its Redis dependencies
 * rather than opening them, and a default that connected anyway would make a
 * suite depend on a broker it never asked for. It answers with nothing, which
 * the console renders as "not observed here" rather than as a healthy queue.
 */
export class UnobservedJobQueues implements JobQueueInspectionPort {
  inspect(): Promise<readonly JobQueueState[]> {
    return Promise.resolve([]);
  }
}
