import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DeliveryDestination } from './destinations.js';
import {
  providerFeedbackTypes,
  type DeliveryFailureClass,
  type NotificationChannel,
  type ProviderFeedbackType,
} from './policy.js';

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

/**
 * What a provider told this platform, after its signature checked out.
 *
 * Normalized by the adapter into this domain's vocabulary. Nothing downstream
 * ever sees the vendor's own event names, so a vendor that renames them
 * changes one adapter.
 */
export interface VerifiedProviderFeedback {
  readonly eventId: string;
  readonly feedbackType: ProviderFeedbackType;
  readonly occurredAt: Date;
  /** The receipt this is about, when the provider names one. */
  readonly providerReference?: string | undefined;
  /** The device this is about, when the provider names one. */
  readonly tokenFingerprint?: string | undefined;
}

export class NotificationProviderUnavailableError extends Error {
  constructor() {
    super('No approved notification delivery provider is configured');
    this.name = 'NotificationProviderUnavailableError';
  }
}

export interface NotificationChannelPort {
  /** The adapter's own name. `unavailable` means nothing may call in. */
  readonly provider: string;
  /** Which provider account and environment this adapter speaks for. */
  readonly account: string;
  readonly environment: string;
  deliver(request: NotificationDeliveryRequest): Promise<NotificationReceipt>;
  /**
   * Authenticates the exact bytes that arrived.
   *
   * Takes raw octets rather than a parsed object on purpose: a signature
   * covers what was sent, and a body checked after a round trip through JSON
   * authenticates a different document than the one that was signed. Throwing
   * is the only failure mode, so a caller cannot accidentally treat a
   * verification failure as a value.
   */
  verifyFeedback(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedProviderFeedback>;
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
  readonly account = 'unavailable';
  readonly environment = 'unavailable';
  readonly provider = 'unavailable';

  deliver(): Promise<NotificationReceipt> {
    return Promise.resolve({ kind: 'unavailable' });
  }

  /**
   * Refuses every callback, because nothing is entitled to make one.
   *
   * There is no approved provider, so any request arriving at the feedback
   * endpoint is either a misconfiguration or a forgery. Both get the same
   * answer.
   */
  verifyFeedback(): Promise<VerifiedProviderFeedback> {
    return Promise.reject(new NotificationProviderUnavailableError());
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
  readonly account = 'local-test-account';
  readonly environment = 'local-test';
  readonly provider = 'local-test';
  /**
   * The shared secret a callback is signed with.
   *
   * Deterministic and public, because this adapter exists only where nothing
   * real is at stake: configuration refuses it outside local and test. What it
   * is for is exercising the verification path with a signature that actually
   * has to be computed, rather than a stub that accepts anything — a test
   * against an adapter that never rejects proves nothing about the adapter
   * that will.
   */
  static readonly signingSecret = 'local-test-notification-callback-secret';

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

  /**
   * Authenticates a callback the way a real adapter would.
   *
   * HMAC-SHA256 over the exact octets received, compared in constant time. The
   * signature is checked before anything parses the body, so an unverifiable
   * request never reaches the parser and never creates a row.
   */
  verifyFeedback(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedProviderFeedback> {
    const presented = input.headers.get('x-velora-notification-signature');
    if (presented === null) {
      return Promise.reject(new Error('notification callback is unsigned'));
    }
    const expected = createHmac(
      'sha256',
      LocalTestNotificationChannel.signingSecret,
    )
      .update(input.rawBody)
      .digest('hex');
    const presentedBytes = Buffer.from(presented, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (
      presentedBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(presentedBytes, expectedBytes)
    ) {
      return Promise.reject(
        new Error('notification callback signature failed'),
      );
    }

    // Only after the bytes authenticated.
    const parsed: unknown = JSON.parse(
      Buffer.from(input.rawBody).toString('utf8'),
    );
    return Promise.resolve(normalizeLocalTestFeedback(parsed));
  }
}

function normalizeLocalTestFeedback(parsed: unknown): VerifiedProviderFeedback {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('notification callback is not an object');
  }
  const body = parsed as Record<string, unknown>;
  const eventId = body.eventId;
  const feedbackType = body.feedbackType;
  const occurredAt = body.occurredAt;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    throw new Error('notification callback names no event');
  }
  if (
    typeof feedbackType !== 'string' ||
    !(providerFeedbackTypes as readonly string[]).includes(feedbackType)
  ) {
    // An event type this domain has no vocabulary for is refused rather than
    // stored. Storing one would mean a row nothing downstream can act on.
    throw new Error('notification callback names an unknown feedback type');
  }
  if (typeof occurredAt !== 'string') {
    throw new Error('notification callback names no instant');
  }
  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) {
    throw new Error('notification callback instant is not a date');
  }
  return {
    eventId,
    feedbackType: feedbackType as ProviderFeedbackType,
    occurredAt: occurred,
    ...(typeof body.providerReference === 'string'
      ? { providerReference: body.providerReference }
      : {}),
    ...(typeof body.tokenFingerprint === 'string'
      ? { tokenFingerprint: body.tokenFingerprint }
      : {}),
  };
}
