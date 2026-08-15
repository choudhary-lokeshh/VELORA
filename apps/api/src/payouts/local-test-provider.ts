import { createHash } from 'node:crypto';

import type { Money } from '../money/money.js';
import type { RecipientStatus } from './policy.js';
import type {
  PayoutInstructionRequest,
  PayoutOnboardingSession,
  PayoutProviderPort,
  PayoutRecipientSnapshot,
  PayoutSnapshot,
  PayoutStatus,
} from './provider.js';

/**
 * A deterministic payout provider for development and tests.
 *
 * It moves no money, opens no socket, and holds everything in process memory.
 * What it exists for is the orchestration around a payout provider: the
 * reservation that has to be durable before the call, the idempotency key that
 * makes a retry return the same object, the ambiguous answer that leaves an
 * instruction to reconcile, and the recipient who is not ready yet.
 *
 * It collects nothing. `startOnboarding` returns a link, exactly as a real
 * provider's hosted flow would, and there is no method on it that accepts a
 * bank detail or an identity document — because there is no such method on the
 * port, and there is nowhere in Velora for the answer to go.
 *
 * It is named `local-test` so no passing test using it can be read as evidence
 * about a real provider, and configuration refuses it outside the local and
 * test application environments.
 */
export type LocalTestPayoutBehaviour = 'ambiguous' | 'declined' | 'normal';

interface RecordedPayout {
  readonly amount: Money;
  readonly providerReference: string;
  status: PayoutStatus;
}

export class LocalTestPayoutProvider implements PayoutProviderPort {
  readonly provider = 'local-test';

  private behaviour: LocalTestPayoutBehaviour = 'normal';

  /** Keyed by idempotency key: what makes a retry return the same object. */
  private readonly payouts = new Map<string, RecordedPayout>();

  private readonly recipients = new Map<string, RecipientStatus>();

  /** Test-only control. Not reachable from any request path. */
  behaveAs(behaviour: LocalTestPayoutBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Test-only: what the provider decided about a recipient's readiness. */
  markRecipient(providerReference: string, status: RecipientStatus): void {
    this.recipients.set(providerReference, status);
  }

  retrievePayout(providerReference: string): Promise<PayoutSnapshot> {
    for (const recorded of this.payouts.values()) {
      if (recorded.providerReference === providerReference) {
        return Promise.resolve({
          amount: recorded.amount,
          providerReference,
          status: recorded.status,
        });
      }
    }
    return Promise.reject(new Error('local-test: unknown payout'));
  }

  retrieveRecipient(
    providerReference: string,
  ): Promise<PayoutRecipientSnapshot> {
    return Promise.resolve({
      providerReference,
      status: this.recipients.get(providerReference) ?? 'onboarding',
    });
  }

  sendPayout(request: PayoutInstructionRequest): Promise<PayoutSnapshot> {
    const existing = this.payouts.get(request.idempotencyKey);
    if (existing !== undefined) {
      return Promise.resolve({
        amount: existing.amount,
        providerReference: existing.providerReference,
        status: existing.status,
      });
    }
    const providerReference = this.reference(request.idempotencyKey);
    if (this.behaviour === 'ambiguous') {
      // The worst real outcome: the provider acted and the answer was lost. The
      // record is kept so reconciliation can find it under the same key.
      this.payouts.set(request.idempotencyKey, {
        amount: request.amount,
        providerReference,
        status: 'paid',
      });
      return Promise.reject(new Error('local-test: ambiguous payout outcome'));
    }
    const status: PayoutStatus =
      this.behaviour === 'declined' ? 'failed' : 'paid';
    this.payouts.set(request.idempotencyKey, {
      amount: request.amount,
      providerReference,
      status,
    });
    return Promise.resolve({
      amount: request.amount,
      providerReference,
      status,
    });
  }

  startOnboarding(input: {
    readonly creatorReference: string;
    readonly returnUrl: string;
  }): Promise<PayoutOnboardingSession> {
    const providerReference = this.reference(input.creatorReference);
    if (!this.recipients.has(providerReference)) {
      this.recipients.set(providerReference, 'onboarding');
    }
    return Promise.resolve({
      onboardingUrl: `https://local-test.payouts.invalid/onboarding/${providerReference}`,
      providerReference,
    });
  }

  /** Test-only: the reference this adapter derives for a creator. */
  referenceFor(creatorReference: string): string {
    return this.reference(creatorReference);
  }

  /** Test-only: what the provider believes about an instruction it was sent. */
  payoutFor(idempotencyKey: string): PayoutSnapshot | undefined {
    const recorded = this.payouts.get(idempotencyKey);
    return recorded === undefined
      ? undefined
      : {
          amount: recorded.amount,
          providerReference: recorded.providerReference,
          status: recorded.status,
        };
  }

  private reference(seed: string): string {
    return `lp_${createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 24)}`;
  }
}
