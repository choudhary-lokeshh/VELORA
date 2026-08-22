import type { DeliveryDestination } from './destinations.js';
import type { DeliveryFailureClass, NotificationChannel } from './policy.js';

/**
 * The external delivery seam.
 *
 * Everything on the other side of this interface is somebody else's network.
 * That is why it is the last thing that happens in a delivery and why no
 * database transaction is ever open across it: a call that hangs must not hold
 * a row lock, and a call whose outcome is unknown must be resolvable from
 * durable state afterwards.
 *
 * The request carries an idempotency key that is stable for the life of the
 * intent rather than unique per attempt. A provider that honours it turns this
 * side's at-least-once retries into at-most-one send, which is the only place
 * duplicate suppression can actually be enforced.
 */
export interface NotificationDeliveryRequest {
  readonly channel: NotificationChannel;
  /**
   * Where this notice can actually arrive, resolved in the claiming
   * transaction. Never empty: delivery suppresses a notice with no destination
   * rather than handing one to an adapter, so no adapter ever has to decide
   * what "sent to nobody" should mean.
   */
  readonly destinations: readonly DeliveryDestination[];
  /** Stable across every attempt for this notice. The intent's identifier. */
  readonly idempotencyKey: string;
  /** Minimized template fields. Never a message body or a display name. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recipientId: string;
  readonly templateKey: string;
}

/**
 * `unavailable` is not a failure. It says no attempt was made, so it consumes
 * no attempt budget and produces no attempt record: the notice stays owed and
 * becomes deliverable the day a provider is approved. A failure means the
 * provider was asked and said no.
 */
export type NotificationReceipt =
  | { readonly kind: 'delivered'; readonly providerReference: string }
  | {
      readonly kind: 'failed';
      /**
       * What kind of failure this was, decided by the adapter. The retry
       * policy reads this and nothing else, so a provider that invents a new
       * error string cannot invent a new retry behaviour with it.
       */
      readonly failureClass: DeliveryFailureClass;
      /** A redacted code. Never a provider message or an address. */
      readonly reason: string;
    }
  | { readonly kind: 'unavailable' };

export interface NotificationChannelPort {
  deliver(request: NotificationDeliveryRequest): Promise<NotificationReceipt>;
}

/**
 * Sends nothing, and says so.
 *
 * The behaviour every deployed environment has. No email, push, or SMS provider
 * is approved — `docs/decisions/DECISIONS_REQUIRED.md` lists all three as
 * pending country, consent, deliverability, and privacy review — so there is
 * nothing to send through and no default worth guessing.
 *
 * It reports `unavailable` rather than failing, which is the difference between
 * a queue that quietly bleeds notices and one that holds them. Intents
 * accumulate in `queued`, keep their safety recheck, and are delivered or
 * suppressed once a provider exists.
 */
export class UnavailableNotificationChannel implements NotificationChannelPort {
  deliver(): Promise<NotificationReceipt> {
    return Promise.resolve({ kind: 'unavailable' });
  }
}

export interface RecordedNotification extends NotificationDeliveryRequest {
  readonly providerReference: string;
}

/** Every device one recorded delivery was aimed at. */
export function reachedDeviceIds(
  record: RecordedNotification,
): readonly string[] {
  return record.destinations.map((destination) => destination.deviceId);
}

/**
 * Keeps deliveries in process memory.
 *
 * For development and tests only; configuration refuses it outside local and
 * test environments. It exists so the delivered path — including everything
 * that must happen before it — is exercisable, and so a test can assert the
 * thing that matters most here: that a suppressed notice never reached this
 * class at all.
 */
export class LocalTestNotificationChannel implements NotificationChannelPort {
  private readonly sent: RecordedNotification[] = [];
  private failure: string | undefined;
  private failureClass: DeliveryFailureClass = 'transport';

  /**
   * Makes the next deliveries fail, so retry and retirement are testable. The
   * class defaults to the retryable one, because that is the path with more
   * behaviour to get wrong; a terminal class is asked for explicitly.
   */
  failWith(
    reason: string | undefined,
    failureClass: DeliveryFailureClass = 'transport',
  ): void {
    this.failure = reason;
    this.failureClass = failureClass;
  }

  deliver(request: NotificationDeliveryRequest): Promise<NotificationReceipt> {
    if (this.failure !== undefined) {
      return Promise.resolve({
        failureClass: this.failureClass,
        kind: 'failed',
        reason: this.failure,
      });
    }
    // The key is stable per intent, so a repeated attempt is answered with the
    // receipt the first one produced rather than sending twice. That is what a
    // provider honouring an idempotency key does, and modelling it here keeps
    // the recovery path honest.
    const existing = this.sent.find(
      (item) => item.idempotencyKey === request.idempotencyKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        kind: 'delivered',
        providerReference: existing.providerReference,
      });
    }
    const providerReference = `local-test-${request.idempotencyKey}`;
    this.sent.push({ ...request, providerReference });
    return Promise.resolve({ kind: 'delivered', providerReference });
  }

  get delivered(): readonly RecordedNotification[] {
    return this.sent;
  }

  deliveredTo(recipientId: string): readonly RecordedNotification[] {
    return this.sent.filter((item) => item.recipientId === recipientId);
  }

  reset(): void {
    this.sent.length = 0;
    this.failure = undefined;
    this.failureClass = 'transport';
  }
}
