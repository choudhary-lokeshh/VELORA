import { createHash, timingSafeEqual } from 'node:crypto';

import { money, type Money } from '../money/money.js';
import type {
  PaymentProviderPort,
  ProviderCheckoutRequest,
  ProviderCheckoutSession,
  ProviderDisputeEvidence,
  ProviderDisputeReason,
  ProviderDisputeStatus,
  ProviderEventEnvelope,
  ProviderPaymentSnapshot,
  ProviderPaymentStatus,
  ProviderRefundRequest,
  ProviderRefundSnapshot,
} from './provider.js';
import { providerDisputeReasons, providerDisputeStatuses } from './provider.js';

/**
 * A deterministic payment provider for development and tests.
 *
 * It moves no money, opens no socket, and holds everything in process memory.
 * What it exists for is the orchestration around a provider: the idempotency
 * key that makes a retry return the same object, the ambiguous outcome that
 * leaves an operation to reconcile, the state a webhook later confirms. None of
 * that can be exercised against a provider that refuses, and none of it should
 * wait for one to be approved.
 *
 * It is named `local-test` so no passing test using it can be read as evidence
 * about a real provider, and configuration refuses it outside the local and
 * test application environments. There is no request field, header, or query
 * parameter that selects it: the composition root reads one configuration value
 * and the value is rejected at startup in staging and production.
 *
 * The signing secret is a fixed development string for the same reason the
 * local AUTH signer uses development key material — a test that had to
 * provision a secret would grow a way to provision one, and that is the shape
 * that eventually reaches an environment nobody meant it to.
 */
export const localTestWebhookSecret = 'velora-local-test-webhook-secret';
export const localTestSignatureHeader = 'x-velora-test-signature';

/**
 * Where this adapter's hosted page is served.
 *
 * Outside `/v1` deliberately: it is not a product route and it is not part of
 * the published contract. It carries no session and no CSRF token, because a
 * payment provider's own page has neither.
 */
export const localTestCheckoutPath = '/local-test/checkout';

interface Recorded {
  readonly amount: Money;
  /** Where the provider was told to send an abandoned consumer. */
  readonly cancelUrl: string;
  readonly operationReference: string;
  /** Where the provider was told to send a consumer who finished. */
  readonly returnUrl: string;
  status: ProviderPaymentStatus;
}

/**
 * Reads a money value out of a test payload, or refuses.
 *
 * It refuses rather than defaulting, exactly as a real adapter must: a dispute
 * event whose amount could not be read is not a dispute for zero, and the whole
 * point of carrying the amount past the port is to be able to check it against
 * Velora's own record.
 */
function amountOf(amountMinor: unknown, currency: unknown): Money | undefined {
  if (amountMinor === undefined && currency === undefined) return undefined;
  if (typeof amountMinor !== 'string' || typeof currency !== 'string') {
    throw new Error('local-test: amount is malformed');
  }
  return money(BigInt(amountMinor), currency);
}

function disputeOf(value: unknown): ProviderDisputeEvidence | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new Error('local-test: dispute is malformed');
  }
  const body = value as Readonly<Record<string, unknown>>;
  const amount = amountOf(body.amountMinor, body.currency);
  const reference = body.providerDisputeReference;
  const reason = body.reason;
  const status = body.status;
  if (
    amount === undefined ||
    typeof reference !== 'string' ||
    typeof reason !== 'string' ||
    typeof status !== 'string' ||
    !(providerDisputeReasons as readonly string[]).includes(reason) ||
    !(providerDisputeStatuses as readonly string[]).includes(status)
  ) {
    throw new Error('local-test: dispute is malformed');
  }
  const openedAt = body.openedAt;
  const evidenceDueAt = body.evidenceDueAt;
  return {
    amount,
    ...(typeof evidenceDueAt === 'string'
      ? { evidenceDueAt: new Date(evidenceDueAt) }
      : {}),
    openedAt: typeof openedAt === 'string' ? new Date(openedAt) : new Date(0),
    providerDisputeReference: reference,
    reason: reason as ProviderDisputeReason,
    status: status as ProviderDisputeStatus,
  };
}

/**
 * How the adapter is asked to behave.
 *
 * `pending` is the ordinary case for a reversal at several real providers: the
 * instruction is accepted, an object is created, and whether the money actually
 * moved is confirmed by a webhook later. It is a separate behaviour from
 * `ambiguous` because the two differ in exactly the way that matters — a
 * pending answer names the object, and an ambiguous one names nothing.
 */
export type LocalTestBehaviour =
  'ambiguous' | 'declined' | 'normal' | 'pending';

export class LocalTestPaymentProvider implements PaymentProviderPort {
  readonly provider = 'local-test';

  /**
   * When this adapter says an event happened.
   *
   * A real provider stamps its own events and Velora takes that instant as
   * authoritative — a journal entry is dated by when the money moved, and a
   * subscription period starts when the provider says the charge settled. A
   * fixed epoch here was deterministic and wrong in exactly one place that
   * matters: every subscription would begin in 1970 and be over before anybody
   * read it. Tests that need an exact instant put one in the event body.
   */
  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Where this adapter's own hosted page lives.
   *
   * A real provider's page is on the provider's origin. This one has no origin
   * of its own, so it borrows the API's — the same arrangement the local-test
   * media transport uses, and for the same reason: a development flow that
   * cannot be walked in a browser is a flow nobody walks.
   *
   * Absent leaves the redirect at an unreachable address, which is what a test
   * that only drives the adapter directly wants.
   */
  private checkoutOrigin: string | undefined;

  /** Keyed by idempotency key, which is what makes a retry return the same object. */
  private readonly byIdempotencyKey = new Map<string, string>();

  private readonly payments = new Map<string, Recorded>();

  private readonly refunds = new Map<string, ProviderRefundSnapshot>();

  private behaviour: LocalTestBehaviour = 'normal';

  private refundBehaviour: LocalTestBehaviour = 'normal';

  /** Test-only control. Not reachable from any request path. */
  behaveAs(behaviour: LocalTestBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Composition-time only. Where the adapter's hosted page is served from. */
  hostCheckoutAt(origin: string): void {
    this.checkoutOrigin = origin.replace(/\/+$/u, '');
  }

  /** What the adapter holds against a reference, for its own hosted page. */
  sessionFor(providerReference: string):
    | {
        readonly amount: Money;
        readonly cancelUrl: string;
        readonly returnUrl: string;
        readonly status: ProviderPaymentStatus;
      }
    | undefined {
    const recorded = this.payments.get(providerReference);
    if (recorded === undefined) return undefined;
    return {
      amount: money(recorded.amount.amountMinor, recorded.amount.currency),
      cancelUrl: recorded.cancelUrl,
      returnUrl: recorded.returnUrl,
      status: recorded.status,
    };
  }

  /** The adapter's own record moves to cancelled, as a provider's would. */
  markCancelled(providerReference: string): void {
    const recorded = this.payments.get(providerReference);
    if (recorded !== undefined) recorded.status = 'cancelled';
  }

  /**
   * Test-only control over reversals, separate from checkout.
   *
   * Separate because the interesting cases are combinations: a charge that
   * settled normally and a refund whose answer was then lost is exactly the
   * shape reconciliation exists for, and one shared switch could not express it.
   */
  refundBehaveAs(behaviour: LocalTestBehaviour): void {
    this.refundBehaviour = behaviour;
  }

  createCheckout(
    request: ProviderCheckoutRequest,
  ): Promise<ProviderCheckoutSession> {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing !== undefined) {
      const recorded = this.payments.get(existing);
      if (recorded !== undefined) {
        return Promise.resolve({
          providerReference: existing,
          redirectUrl: this.redirectFor(existing),
          status: recorded.status,
        });
      }
    }
    if (this.behaviour === 'ambiguous') {
      // The worst real outcome: the provider acted, and the answer was lost. A
      // reference is recorded here so reconciliation can find it, and the caller
      // gets nothing.
      const reference = this.reference(request.idempotencyKey);
      this.byIdempotencyKey.set(request.idempotencyKey, reference);
      this.payments.set(reference, {
        amount: request.amount,
        cancelUrl: request.cancelUrl,
        operationReference: request.operationReference,
        returnUrl: request.returnUrl,
        status: 'pending',
      });
      return Promise.reject(
        new Error('local-test: ambiguous provider outcome'),
      );
    }
    const reference = this.reference(request.idempotencyKey);
    const status: ProviderPaymentStatus =
      this.behaviour === 'declined' ? 'failed' : 'pending';
    this.byIdempotencyKey.set(request.idempotencyKey, reference);
    this.payments.set(reference, {
      amount: request.amount,
      cancelUrl: request.cancelUrl,
      operationReference: request.operationReference,
      returnUrl: request.returnUrl,
      status,
    });
    return Promise.resolve({
      providerReference: reference,
      redirectUrl: this.redirectFor(reference),
      status,
    });
  }

  refundPayment(
    request: ProviderRefundRequest,
  ): Promise<ProviderRefundSnapshot> {
    // The key is what makes a retried instruction return the object the first
    // attempt created rather than reversing the money a second time.
    const existing = this.refunds.get(request.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    const reference = this.reference(request.idempotencyKey);
    if (this.refundBehaviour === 'ambiguous') {
      // The provider acted and the answer was lost. The record is kept so
      // reconciliation can find it under the same key; the caller gets nothing.
      this.refunds.set(request.idempotencyKey, {
        amount: request.amount,
        providerReference: reference,
        status: 'succeeded',
      });
      return Promise.reject(new Error('local-test: ambiguous refund outcome'));
    }
    const snapshot: ProviderRefundSnapshot = {
      amount: request.amount,
      providerReference: reference,
      status:
        this.refundBehaviour === 'declined'
          ? 'failed'
          : this.refundBehaviour === 'pending'
            ? 'pending'
            : 'succeeded',
    };
    this.refunds.set(request.idempotencyKey, snapshot);
    return Promise.resolve(snapshot);
  }

  /** Test-only: what the provider believes about a refund it was asked for. */
  refundFor(idempotencyKey: string): ProviderRefundSnapshot | undefined {
    return this.refunds.get(idempotencyKey);
  }

  retrievePayment(providerReference: string): Promise<ProviderPaymentSnapshot> {
    const recorded = this.payments.get(providerReference);
    if (recorded === undefined) {
      return Promise.reject(new Error('local-test: unknown payment'));
    }
    return Promise.resolve({
      amount: recorded.amount,
      providerReference,
      status: recorded.status,
    });
  }

  /**
   * Verifies a signature over the exact bytes that arrived.
   *
   * A digest of secret and body, compared in constant time. It is not a real
   * provider's scheme and is not meant to be; what it exercises is the shape
   * every real one shares — verify before parse, reject before any business
   * processing, and compare without leaking timing.
   */
  verifyEvent(input: {
    readonly headers: Headers;
    readonly rawBody: string;
  }): Promise<ProviderEventEnvelope> {
    const presented = input.headers.get(localTestSignatureHeader) ?? '';
    const expected = createHash('sha256')
      .update(`${localTestWebhookSecret}.${input.rawBody}`, 'utf8')
      .digest('hex');
    const presentedBytes = Buffer.from(presented, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (
      presentedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(presentedBytes, expectedBytes)
    ) {
      return Promise.reject(new Error('local-test: signature is not valid'));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return Promise.reject(new Error('local-test: body is not JSON'));
    }
    const body = parsed as Readonly<{
      readonly amountMinor?: unknown;
      readonly currency?: unknown;
      readonly dispute?: unknown;
      readonly eventId?: unknown;
      readonly eventType?: unknown;
      readonly occurredAt?: unknown;
      readonly providerPaymentReference?: unknown;
      readonly providerRefundReference?: unknown;
      readonly status?: unknown;
    }>;
    const eventId = body.eventId;
    const eventType = body.eventType;
    if (typeof eventId !== 'string' || typeof eventType !== 'string') {
      return Promise.reject(new Error('local-test: event is malformed'));
    }
    const reference = body.providerPaymentReference;
    const status = body.status;
    const recorded =
      typeof reference === 'string' ? this.payments.get(reference) : undefined;
    if (recorded !== undefined && typeof status === 'string') {
      recorded.status = status as ProviderPaymentStatus;
    }
    let amount: Money | undefined;
    let dispute: ProviderDisputeEvidence | undefined;
    try {
      amount = amountOf(body.amountMinor, body.currency);
      dispute = disputeOf(body.dispute);
    } catch {
      // Malformed after verification is the same answer as unverified, so a
      // caller learns nothing about how close a forged signature was.
      return Promise.reject(new Error('local-test: event is malformed'));
    }
    return Promise.resolve({
      ...(amount === undefined ? {} : { amount }),
      ...(dispute === undefined ? {} : { dispute }),
      eventId,
      eventType,
      occurredAt:
        typeof body.occurredAt === 'string'
          ? new Date(body.occurredAt)
          : this.now(),
      ...(typeof reference === 'string'
        ? { providerPaymentReference: reference }
        : {}),
      ...(typeof body.providerRefundReference === 'string'
        ? { providerRefundReference: body.providerRefundReference }
        : {}),
      ...(typeof status === 'string'
        ? { status: status as ProviderPaymentStatus }
        : {}),
    });
  }

  /**
   * Test-only: the provider now reports this payment as settled.
   *
   * What a real provider does on its own schedule, made deterministic. It moves
   * the adapter's own record, so a reconciliation sweep that reads it learns the
   * same thing a webhook would have told it.
   */
  markSucceeded(providerReference: string): void {
    const recorded = this.payments.get(providerReference);
    if (recorded !== undefined) recorded.status = 'succeeded';
  }

  /** Test-only: the amount a reference was created for. */
  amountFor(providerReference: string): Money | undefined {
    const recorded = this.payments.get(providerReference);
    return recorded === undefined
      ? undefined
      : money(recorded.amount.amountMinor, recorded.amount.currency);
  }

  /** Test-only: the signature a body would need to be accepted. */
  static signatureFor(rawBody: string): string {
    return createHash('sha256')
      .update(`${localTestWebhookSecret}.${rawBody}`, 'utf8')
      .digest('hex');
  }

  private redirectFor(reference: string): string {
    return this.checkoutOrigin === undefined
      ? `https://local-test.provider.invalid/checkout/${reference}`
      : `${this.checkoutOrigin}${localTestCheckoutPath}?reference=${encodeURIComponent(reference)}`;
  }

  private reference(idempotencyKey: string): string {
    return `lt_${createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 24)}`;
  }
}
