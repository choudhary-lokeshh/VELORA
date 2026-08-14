import type { Job } from 'bullmq';

export interface JobPayloadValidator<Payload> {
  parse(input: unknown): Payload;
}

export interface JobRegistration<Payload = unknown> {
  readonly handler: (payload: Payload, job: Job) => Promise<void>;
  readonly name: `${string}.v${number}`;
  readonly queue: string;
  readonly retry: {
    readonly attempts: number;
    readonly backoffMilliseconds: number;
  };
  readonly validate: JobPayloadValidator<Payload>;
  readonly version: number;
}

export const defaultJobRetryPolicy = {
  attempts: 5,
  backoffMilliseconds: 30_000,
} as const;

const maximumQueueCount = 8;
const maximumRetryAttempts = 10;
const maximumRetryBackoffMilliseconds = 3_600_000;
const allowedQueueName = /^[a-z][a-z0-9-]{2,63}$/u;

export class JobRegistry {
  private readonly registrations = new Map<string, JobRegistration>();

  register<Payload>(registration: JobRegistration<Payload>): void {
    if (!allowedQueueName.test(registration.queue)) {
      throw new Error(`Invalid queue name: ${registration.queue}`);
    }
    if (this.registrations.has(registration.name)) {
      throw new Error(`Duplicate job registration: ${registration.name}`);
    }
    if (!registration.name.endsWith(`.v${String(registration.version)}`)) {
      throw new Error('Job name and version must match');
    }
    if (
      !Number.isInteger(registration.retry.attempts) ||
      registration.retry.attempts < 1 ||
      registration.retry.attempts > maximumRetryAttempts
    ) {
      throw new Error('Job retry attempts are outside allowed range');
    }
    if (
      !Number.isInteger(registration.retry.backoffMilliseconds) ||
      registration.retry.backoffMilliseconds < 1 ||
      registration.retry.backoffMilliseconds > maximumRetryBackoffMilliseconds
    ) {
      throw new Error('Job retry backoff is outside allowed range');
    }

    const queues = new Set([
      ...this.list().map((item) => item.queue),
      registration.queue,
    ]);
    if (queues.size > maximumQueueCount) {
      throw new Error('Queue registry exceeds bounded queue count');
    }

    this.registrations.set(registration.name, registration as JobRegistration);
  }

  get(name: string): JobRegistration | undefined {
    return this.registrations.get(name);
  }

  list(): readonly JobRegistration[] {
    return [...this.registrations.values()];
  }

  queueNames(): readonly string[] {
    return [...new Set(this.list().map((registration) => registration.queue))];
  }
}

/**
 * Product and domain jobs are registered by the composition root that owns the
 * contract behind them; `src/worker.ts` is the one that does it today. There is
 * deliberately no shared module-level registry: a singleton would let any
 * import decide what a worker runs, and this list is meant to be bounded and
 * reviewed.
 */
