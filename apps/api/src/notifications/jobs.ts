import type { Queue } from 'bullmq';

import type { JobRegistry } from '../jobs/registry.js';
import type { NotificationDeliveryService } from './delivery.js';

/**
 * The queue seam.
 *
 * BullMQ carries a wake-up and nothing else. `docs/domains/notifications.md` is
 * explicit that "queue completion does not define notification truth", and this
 * module is where that rule is kept honest: the job payload is one identifier,
 * the handler re-reads PostgreSQL, and a queue that loses every job costs
 * latency rather than a notice — the sweeper in the worker delivers from the
 * same durable rows.
 */

export const notificationsQueueName = 'notifications';
export const notificationDeliveryJobName = 'notifications.deliver.v1';

export interface NotificationDeliveryPayload {
  readonly intentId: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Job data crosses a process boundary and comes back as `unknown`, so it is
 * parsed rather than cast — the same rule a request body follows.
 */
export const notificationDeliveryPayload = {
  parse(input: unknown): NotificationDeliveryPayload {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Notification delivery payload must be an object');
    }
    const intentId = (input as Record<string, unknown>).intentId;
    if (typeof intentId !== 'string' || !uuidPattern.test(intentId)) {
      throw new Error('Notification delivery payload requires an intent id');
    }
    return { intentId };
  },
};

/**
 * @param admit Bounds how many handlers may touch the connection pool at once.
 *   BullMQ's own concurrency governs how many jobs run; this governs how many of
 *   them are inside the pool, which is a different resource and the one the
 *   worker can exhaust. Defaults to running the handler directly, for callers
 *   that own no pool.
 */
export function registerNotificationJobs(
  registry: JobRegistry,
  delivery: NotificationDeliveryService,
  admit: <T>(work: () => Promise<T>) => Promise<T> = async (work) => work(),
): void {
  registry.register<NotificationDeliveryPayload>({
    handler: async (payload) => {
      await admit(async () => delivery.deliver(payload.intentId));
    },
    name: notificationDeliveryJobName,
    queue: notificationsQueueName,
    // A short budget, because this job is not the durability mechanism. Its
    // failure leaves the notice exactly where it was: queued in PostgreSQL,
    // due, and picked up by the next sweep.
    retry: { attempts: 3, backoffMilliseconds: 15_000 },
    validate: notificationDeliveryPayload,
    version: 1,
  });
}

/**
 * Enqueues the low-latency wake-up for one notice.
 *
 * The job identifier is the intent identifier, so a notice that is woken twice
 * — by a relay redelivery, say — occupies one job rather than two racing
 * copies. Failure here is not propagated by the caller: the notice is already
 * durable, and the sweeper is the guarantee.
 */
export function createNotificationWake(
  queue: Queue,
): (intentId: string) => Promise<void> {
  return async (intentId: string) => {
    await queue.add(
      notificationDeliveryJobName,
      { intentId },
      { jobId: intentId },
    );
  };
}
