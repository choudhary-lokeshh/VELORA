import type { Executor } from '../database/executor.js';
import { isCurrencyCode } from '@velora/validation';

import { money } from '../money/money.js';
import type { CommercePolicy } from './commerce-policy.js';
import type { BillingInterval } from './offer-policy.js';
import type { OfferRepository } from './offer-repository.js';
import type { DisputeRepository } from './dispute-repository.js';
import type { PaymentRepository, PaymentRow } from './payment-repository.js';
import type { PaymentProviderPort } from './provider.js';
import type { CommercialConsumerPort } from './ports.js';

/**
 * Turning an intention to buy into a durable operation, and only then asking a
 * provider for anything.
 *
 * The ordering is the design, and it is the rule
 * [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * states as prepare, commit, call, record:
 *
 * 1. one transaction establishes the operation and reserves its idempotency
 *    identity, and commits;
 * 2. the provider is called *outside* any transaction, with a platform-
 *    generated key so a retry cannot create a second charge;
 * 3. a second transaction records what came back.
 *
 * A process that dies between two and three leaves a committed operation with
 * no provider reference, which is exactly what reconciliation exists to
 * resolve. The reverse ordering — call first, record after — leaves a charge
 * that Velora has no record of at all, and no amount of retrying finds it.
 *
 * Nothing here treats a redirect as evidence. The return URL reaches a route
 * that reads this state and renders it; there is no path from a browser
 * navigation to a state transition.
 */

export type CheckoutRefusal =
  | 'conflict'
  | 'not_eligible'
  | 'provider_unavailable'
  | 'surface_not_permitted'
  | 'unavailable';

export interface CheckoutStarted {
  readonly kind: 'started';
  readonly payment: PaymentRow;
  /**
   * The provider-hosted page to send the consumer to, when this call is what
   * created it.
   *
   * Absent on a replay. A repeated request returns the operation's current
   * state rather than a fresh redirect, because the provider object already
   * exists and re-issuing a link is the provider's business, not a fact Velora
   * should invent.
   */
  readonly redirectUrl?: string;
}

export type CheckoutOutcome =
  | CheckoutStarted
  | { readonly kind: 'refused'; readonly reason: CheckoutRefusal };

export interface CheckoutServiceDependencies {
  readonly consumers: CommercialConsumerPort;
  readonly disputes: DisputeRepository;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly payments: PaymentRepository;
  readonly policy: CommercePolicy;
  readonly provider: PaymentProviderPort;
  /** Where the provider returns a consumer. Consumer Web, from configuration. */
  readonly returnOrigin: string | undefined;
}

function refused(reason: CheckoutRefusal): CheckoutOutcome {
  return { kind: 'refused', reason };
}

export class CheckoutService {
  constructor(private readonly dependencies: CheckoutServiceDependencies) {}

  /**
   * Starts, or resumes, one purchase.
   *
   * Everything that could refuse is checked before the provider is contacted,
   * and re-read inside the transaction that writes: an offer retired a moment
   * ago, a price withdrawn, a consumer restricted since they loaded the page.
   * The alternative — checking, then calling a provider, then writing — is a
   * charge collected against terms that no longer applied.
   */
  async start(input: {
    readonly consumerId: string;
    readonly correlationId: string;
    readonly currency: string;
    readonly idempotencyKey: string;
    readonly offerId: string;
  }): Promise<CheckoutOutcome> {
    const { payments, policy, provider } = this.dependencies;
    if (policy.currencies().length === 0) return refused('unavailable');
    if (provider.provider === 'unavailable') {
      return refused('provider_unavailable');
    }
    if (this.dependencies.returnOrigin === undefined) {
      // A provider needs somewhere to send the consumer back to. Without a
      // configured browser origin there is nowhere, and inventing one would
      // send somebody to a host nobody approved.
      return refused('provider_unavailable');
    }
    const now = this.dependencies.now();

    const prepared = await payments.transaction(async (executor) =>
      this.prepare(executor, { ...input, now }),
    );
    if (prepared.kind === 'refused') return prepared;
    const operation = prepared.payment;

    // Already past the provider call. A replay answers with current state and
    // asks for nothing new.
    if (operation.state !== 'created') {
      return { kind: 'started', payment: operation };
    }

    // Claim the instruction before sending it.
    //
    // Fifty simultaneous submissions all converge on one operation, but without
    // this they would all find it in `created` and all call the provider. The
    // provider idempotency key means that is not a double charge, and it is
    // still fifty identical instructions where one was meant. The claim is a
    // conditional update, so exactly one caller wins and the rest read the
    // state the winner wrote.
    //
    // A row in `provider_pending` with no provider reference is therefore the
    // honest description of "an instruction is in flight". If this process dies
    // here, that is what reconciliation finds, and it resolves it from the
    // provider's own record under the same key.
    const claimed = await payments.transaction(async (executor) =>
      payments.transition(executor, {
        from: ['created'],
        now: this.dependencies.now(),
        paymentId: operation.id,
        to: 'provider_pending',
      }),
    );
    if (claimed === undefined) {
      const current = await payments.findOwnPayment(payments.transactionless, {
        consumerId: input.consumerId,
        paymentId: operation.id,
      });
      return { kind: 'started', payment: current ?? operation };
    }

    let session;
    try {
      // Outside every transaction, deliberately. `docs/engineering/03-jobs-idempotency-concurrency.md`
      // forbids holding one open across work this process does not own, and a
      // provider that takes thirty seconds would otherwise hold a connection
      // and a row lock for thirty seconds.
      session = await provider.createCheckout({
        amount: money(operation.amountMinor, operation.currency),
        cancelUrl: `${this.dependencies.returnOrigin}/checkout/cancelled?payment=${operation.id}`,
        consumerReference: operation.consumerId,
        correlationId: input.correlationId,
        ...(prepared.interval === undefined
          ? {}
          : { interval: prepared.interval }),
        idempotencyKey: operation.providerIdempotencyKey,
        mode: prepared.interval === undefined ? 'payment' : 'subscription',
        operationReference: operation.id,
        returnUrl: `${this.dependencies.returnOrigin}/checkout/return?payment=${operation.id}`,
      });
    } catch {
      // The provider may or may not have acted. That is not a failure and it is
      // certainly not a success: the operation waits for reconciliation to read
      // the provider's own record, and no second instruction is sent under a
      // new key.
      const pending = await payments.transaction(async (executor) =>
        payments.transition(executor, {
          from: ['provider_pending'],
          now: this.dependencies.now(),
          paymentId: operation.id,
          to: 'reconciliation_pending',
        }),
      );
      return { kind: 'started', payment: pending ?? claimed };
    }

    const recorded = await payments.transaction(async (executor) =>
      payments.transition(executor, {
        from: ['provider_pending'],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        paymentId: operation.id,
        providerReference: session.providerReference,
        to:
          session.status === 'requires_action'
            ? 'requires_action'
            : session.status === 'failed'
              ? 'failed'
              : 'provider_pending',
      }),
    );
    return {
      kind: 'started',
      payment: recorded ?? claimed,
      redirectUrl: session.redirectUrl,
    };
  }

  /** One of the caller's own payments, or nothing. */
  async read(input: {
    readonly consumerId: string;
    readonly paymentId: string;
  }): Promise<PaymentRow | undefined> {
    const { payments } = this.dependencies;
    return payments.findOwnPayment(payments.transactionless, input);
  }

  /**
   * The transactional half: eligibility, the price snapshot, and the operation.
   *
   * Everything it reads, it reads inside the transaction that writes, so a
   * concurrent retirement or restriction either loses to this or wins over it —
   * never lands in between.
   */
  private async prepare(
    executor: Executor,
    input: {
      readonly consumerId: string;
      readonly correlationId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly offerId: string;
    },
  ): Promise<
    | { readonly kind: 'refused'; readonly reason: CheckoutRefusal }
    | {
        readonly interval: BillingInterval | undefined;
        readonly kind: 'prepared';
        readonly payment: PaymentRow;
      }
  > {
    const { consumers, offers, payments, policy, provider } = this.dependencies;

    const existing = await payments.findByIdempotency(executor, {
      consumerId: input.consumerId,
      idempotencyKey: input.idempotencyKey,
      offerId: input.offerId,
    });
    if (existing !== undefined) {
      // The same key against a different amount or currency is not a replay,
      // it is a different purchase wearing a used key, and answering it with
      // the old operation would charge for the wrong thing.
      if (existing.currency !== input.currency) {
        return { kind: 'refused', reason: 'conflict' };
      }
      return {
        interval: undefined,
        kind: 'prepared',
        payment: existing,
      };
    }

    const standing = await consumers.standingForUser({
      executor,
      now: input.now,
      userId: input.consumerId,
    });
    if (standing?.inGoodStanding !== true) {
      return { kind: 'refused', reason: 'not_eligible' };
    }

    // A live cardholder claim stops *new* commerce and nothing else.
    //
    // Whether somebody keeps what they already bought while a dispute is open
    // is unresolved commercial policy, recorded in
    // `docs/decisions/DECISIONS_REQUIRED.md`, and inventing either answer would
    // be inventing a commercial term. Refusing to take more money from the same
    // person while their bank is reversing the last payment withdraws nothing
    // they hold and is the fail-closed reading of the question that *is* open.
    const disputed = await this.dependencies.disputes.hasOpenDisputeFor(
      executor,
      { consumerId: input.consumerId },
    );
    if (disputed) return { kind: 'refused', reason: 'not_eligible' };

    const offer = await offers.findOfferForPurchase(executor, input.offerId);
    if (offer?.state !== 'active') {
      return { kind: 'refused', reason: 'not_eligible' };
    }
    const prices = await offers.livePricesFor(executor, offer.id);
    const price = prices.find((row) => row.currency === input.currency);
    if (price === undefined) return { kind: 'refused', reason: 'not_eligible' };
    if (
      !isCurrencyCode(price.currency) ||
      policy.boundsFor(price.currency) === undefined
    ) {
      return { kind: 'refused', reason: 'unavailable' };
    }

    const inserted = await payments.insertOperation(executor, {
      amountMinor: price.amountMinor,
      consumerId: input.consumerId,
      correlationId: input.correlationId,
      currency: price.currency,
      idempotencyKey: input.idempotencyKey,
      now: input.now,
      offerId: offer.id,
      priceId: price.id,
      provider: provider.provider,
      // Derived from the operation's own identity rather than random, so the
      // key a retry sends is the key the first attempt sent even if this
      // process never learned what happened to it.
      providerIdempotencyKey:
        `velora-${input.consumerId}-${offer.id}-${input.idempotencyKey}`.slice(
          0,
          200,
        ),
    });
    if (inserted === undefined) {
      // Another request for the same key won between the read above and this
      // insert. Read the winner rather than failing: this is the double-click.
      const winner = await payments.findByIdempotency(executor, {
        consumerId: input.consumerId,
        idempotencyKey: input.idempotencyKey,
        offerId: input.offerId,
      });
      if (winner === undefined) return { kind: 'refused', reason: 'conflict' };
      return { interval: undefined, kind: 'prepared', payment: winner };
    }
    return {
      interval: price.billingInterval ?? undefined,
      kind: 'prepared',
      payment: inserted,
    };
  }
}
