import { createHash, timingSafeEqual } from 'node:crypto';

import { money, type Money } from '../money/money.js';
import type {
  PaymentProviderPort,
  ProviderCheckoutRequest,
  ProviderCheckoutSession,
  ProviderEventEnvelope,
  ProviderPaymentSnapshot,
  ProviderPaymentStatus,
  ProviderRefundRequest,
  ProviderRefundSnapshot,
} from './provider.js';

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

interface Recorded {
  readonly amount: Money;
  readonly operationReference: string;
  status: ProviderPaymentStatus;
}

/** How the adapter is asked to behave, encoded in the operation itself. */
export type LocalTestBehaviour = 'ambiguous' | 'declined' | 'normal';

export class LocalTestPaymentProvider implements PaymentProviderPort {
  readonly provider = 'local-test';

  /** Keyed by idempotency key, which is what makes a retry return the same object. */
  private readonly byIdempotencyKey = new Map<string, string>();

  private readonly payments = new Map<string, Recorded>();

  private readonly refunds = new Map<string, ProviderRefundSnapshot>();

  private behaviour: LocalTestBehaviour = 'normal';

  /** Test-only control. Not reachable from any request path. */
  behaveAs(behaviour: LocalTestBehaviour): void {
    this.behaviour = behaviour;
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
        operationReference: request.operationReference,
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
      operationReference: request.operationReference,
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
    const existing = this.refunds.get(request.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    const snapshot: ProviderRefundSnapshot = {
      amount: request.amount,
      providerReference: this.reference(request.idempotencyKey),
      status: 'succeeded',
    };
    this.refunds.set(request.idempotencyKey, snapshot);
    return Promise.resolve(snapshot);
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
      readonly eventId?: unknown;
      readonly eventType?: unknown;
      readonly providerPaymentReference?: unknown;
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
    return Promise.resolve({
      eventId,
      eventType,
      occurredAt: new Date(0),
      ...(typeof reference === 'string'
        ? { providerPaymentReference: reference }
        : {}),
      ...(typeof status === 'string'
        ? { status: status as ProviderPaymentStatus }
        : {}),
    });
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
    return `https://local-test.provider.invalid/checkout/${reference}`;
  }

  private reference(idempotencyKey: string): string {
    return `lt_${createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 24)}`;
  }
}
