import { createHash } from 'node:crypto';

import { isCurrencyCode } from '@velora/validation';

import type { Executor, TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type { SafetyDirectoryPort } from '../safety/directory.js';

import { money, type Money } from '../money/money.js';
import type { CommercePolicy } from './commerce-policy.js';
import type { BillingInterval } from './offer-policy.js';
import type { OfferRepository } from './offer-repository.js';
import type { CommerceEligibility } from './commerce-eligibility.js';
import type { DisputeRepository } from './dispute-repository.js';
import type { PaymentRepository, PaymentRow } from './payment-repository.js';
import type { PaymentProviderPort } from './provider.js';
import type { CommercialConsumerPort, CommercialCreatorPort } from './ports.js';
import type { TaxAssessment, TaxAuthorityPort } from './tax.js';
import type { GiftRepository } from './gift-repository.js';

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
  /** A country, currency, tax, or capability gate is shut for this pairing. */
  | 'not_available_here'
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
  /** The country, currency, and capability authority. Refuses everything in production. */
  readonly eligibility: CommerceEligibility;
  readonly creators: CommercialCreatorPort;
  readonly disputes: DisputeRepository;
  readonly gifts?: GiftRepository;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly payments: PaymentRepository;
  readonly policy: CommercePolicy;
  readonly provider: PaymentProviderPort;
  readonly safety?: SafetyDirectoryPort;
  /** Where the provider returns a consumer. Consumer Web, from configuration. */
  readonly returnOrigin: string | undefined;
  /** The tax authority. Assesses nothing in production, which blocks commerce. */
  readonly tax: TaxAuthorityPort;
}

function refused(reason: CheckoutRefusal): CheckoutOutcome {
  return { kind: 'refused', reason };
}

/**
 * The key Velora sends a provider for one purchase.
 *
 * Derived from the operation's own identity rather than random, so the key a
 * retry sends is the key the first attempt sent even if this process never
 * learned what happened to it — which is what makes a repeat safe to send.
 *
 * A digest rather than the identity spelled out. The column is bounded at 200
 * characters and an idempotency key may be 128, so writing the two identifiers
 * and the key in full overruns that bound and has to be truncated — and a
 * truncated key is no longer one key per purchase. Two submissions differing
 * only past the cut would derive the same provider key, collide on the index
 * that exists to keep instructions distinct, and fail as a duplicate of a
 * purchase they are not. A fixed-width digest of the whole identity cannot
 * overrun, so the mapping stays one-to-one whatever the caller sends.
 */
function providerKeyFor(identity: {
  readonly consumerId: string;
  readonly idempotencyKey: string;
  readonly offerId: string;
}): string {
  // A separator PostgreSQL cannot store in a text column, so no key a caller
  // sent can contain one and no two distinct identities can join to the same
  // string. A digest is one-to-one only if what it digests is.
  const identityString = [
    identity.consumerId,
    identity.offerId,
    identity.idempotencyKey,
  ].join('\u0000');
  const digest = createHash('sha256')
    .update(identityString, 'utf8')
    .digest('hex');
  return `velora-${digest}`;
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

    // A replay is answered before anything else happens.
    //
    // It comes first for two reasons. A repeated submission must resolve to the
    // operation it already created whatever the gates say today — a country
    // withdrawn after somebody started paying does not un-start their payment.
    // And a replay must not reach a tax engine: asking somebody else's service
    // about a sale that was already assessed would bill Velora for the question
    // and put a duplicate in their records.
    const replay = await payments.findByIdempotency(payments.transactionless, {
      consumerId: input.consumerId,
      idempotencyKey: input.idempotencyKey,
      offerId: input.offerId,
    });
    if (replay !== undefined && replay.currency !== input.currency) {
      // The same key against a different currency is not a replay; it is a
      // different purchase wearing a used key, and answering it with the old
      // operation would charge for the wrong thing.
      return refused('conflict');
    }

    let operation = replay;
    let interval: BillingInterval | undefined;
    if (operation === undefined) {
      // Everything the eligibility gate and the tax authority need, read before
      // the write transaction opens. Both are re-checked inside it against the
      // same values, so a country, a price, or a policy that changed in between
      // refuses rather than being charged against stale facts.
      const context = await payments.transaction(async (executor) =>
        this.context(executor, { ...input, now }),
      );
      if (context.kind === 'refused') return context;

      let assessment;
      try {
        // Outside every transaction. A tax engine is somebody else's network
        // service, and holding a PostgreSQL transaction across one is forbidden
        // for the same reason holding one across a payment provider is.
        assessment = await this.dependencies.tax.assess({
          consumerCountry: context.consumerCountry,
          creatorCountry: context.creatorCountry,
          gross: context.gross,
        });
      } catch {
        return refused('not_available_here');
      }
      // No authority, no sale. An assumed zero is how a platform accrues an
      // unremitted tax liability without anybody deciding to.
      if (assessment === undefined) return refused('not_available_here');

      const prepared = await payments.transaction(async (executor) =>
        this.prepare(executor, { ...input, assessment, now }),
      );
      if (prepared.kind === 'refused') return prepared;
      operation = prepared.payment;
      interval = prepared.interval;
    }

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
        ...(interval === undefined ? {} : { interval }),
        idempotencyKey: operation.providerIdempotencyKey,
        mode: interval === undefined ? 'payment' : 'subscription',
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
   * What the tax authority has to be asked about, read before it is asked.
   *
   * A short read rather than a held transaction: the eligibility gate and the
   * assessment both need the amount, the currency, and both countries, and a
   * transaction held open across a tax engine's network call is exactly what
   * `docs/engineering/03-jobs-idempotency-concurrency.md` forbids. Everything
   * read here is read again inside the write, so this is an input to a question
   * rather than a decision.
   */
  private async context(
    executor: Executor,
    input: {
      readonly consumerId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly offerId: string;
    },
  ): Promise<
    | { readonly kind: 'refused'; readonly reason: CheckoutRefusal }
    | {
        readonly consumerCountry: string | undefined;
        readonly creatorCountry: string | undefined;
        readonly gross: Money;
        readonly kind: 'context';
      }
  > {
    const { consumers, creators, offers } = this.dependencies;
    const standing = await consumers.standingForUser({
      executor,
      now: input.now,
      userId: input.consumerId,
    });
    if (standing?.inGoodStanding !== true) {
      return { kind: 'refused', reason: 'not_eligible' };
    }
    const offer = await offers.findOfferForPurchase(executor, input.offerId);
    if (offer?.state !== 'active') {
      return { kind: 'refused', reason: 'not_eligible' };
    }
    if (
      !(await this.giftPurchasePermitted(executor, {
        consumerId: input.consumerId,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        offer,
      }))
    ) {
      return { kind: 'refused', reason: 'not_eligible' };
    }
    const prices = await offers.livePricesFor(executor, offer.id);
    const price = prices.find((row) => row.currency === input.currency);
    if (price === undefined) return { kind: 'refused', reason: 'not_eligible' };
    if (!isCurrencyCode(price.currency)) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    const creatorCountry = await creators.operatingCountryFor({
      creatorId: offer.creatorId,
      executor,
      now: input.now,
    });
    // The gate first, so a pairing nobody approved never reaches a tax engine
    // and never appears in anybody's assessment logs.
    const verdict = this.dependencies.eligibility.evaluate({
      consumerCountry: standing.region,
      creatorCountry,
      currency: price.currency,
    });
    if (verdict.kind === 'refused') {
      return { kind: 'refused', reason: 'not_available_here' };
    }
    return {
      consumerCountry: standing.region,
      creatorCountry,
      gross: money(price.amountMinor, price.currency),
      kind: 'context',
    };
  }

  /**
   * The transactional half: eligibility, the price snapshot, and the operation.
   *
   * Everything it reads, it reads inside the transaction that writes, so a
   * concurrent retirement or restriction either loses to this or wins over it —
   * never lands in between.
   */
  private async prepare(
    executor: TransactionHandle,
    input: {
      readonly assessment: TaxAssessment;
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
    if (
      !(await this.giftPurchasePermitted(executor, {
        consumerId: input.consumerId,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        offer,
      }))
    ) {
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

    // The gate, re-evaluated inside the transaction that writes. A launch
    // country withdrawn, a currency pairing closed, or a creator who moved
    // between the first read and this one refuses here rather than being
    // charged against an answer that was true a moment ago.
    const verdict = this.dependencies.eligibility.evaluate({
      consumerCountry: standing.region,
      creatorCountry: await this.dependencies.creators.operatingCountryFor({
        creatorId: offer.creatorId,
        executor,
        now: input.now,
      }),
      currency: price.currency,
    });
    if (verdict.kind === 'refused') {
      return { kind: 'refused', reason: 'not_available_here' };
    }
    // The assessment was made against this exact amount and currency. If either
    // moved while the authority was being asked, the answer describes a
    // different sale.
    if (
      input.assessment.amount.currency !== price.currency ||
      input.assessment.amount.amountMinor > price.amountMinor
    ) {
      return { kind: 'refused', reason: 'conflict' };
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
      providerIdempotencyKey: providerKeyFor({
        consumerId: input.consumerId,
        idempotencyKey: input.idempotencyKey,
        offerId: offer.id,
      }),
      taxAuthority: input.assessment.authority,
      taxMinor: input.assessment.amount.amountMinor,
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

  private async giftPurchasePermitted(
    executor: Executor,
    input: {
      readonly consumerId: string;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly offer: Awaited<
        ReturnType<OfferRepository['findOfferForPurchase']>
      > & {};
    },
  ): Promise<boolean> {
    if (input.offer.resourceType !== 'gift') return true;
    const { gifts, safety } = this.dependencies;
    if (gifts === undefined || safety === undefined) return false;
    const gift = await gifts.findBySenderKey(executor, {
      idempotencyKey: input.idempotencyKey,
      senderUserId: input.consumerId,
    });
    if (
      gift?.offerId !== input.offer.id ||
      gift.recipientCreatorId !== input.offer.creatorId ||
      gift.state !== 'pending'
    ) {
      return false;
    }
    await lockPair(
      executor as TransactionHandle,
      gift.senderUserId,
      gift.recipientUserId,
    );
    const giftRecipientFor =
      this.dependencies.creators.publishedGiftRecipientFor?.bind(
        this.dependencies.creators,
      );
    if (giftRecipientFor === undefined) return false;
    const [mayInteract, recipient] = await Promise.all([
      safety.mayInteract({
        executor,
        first: gift.senderUserId,
        now: input.now,
        second: gift.recipientUserId,
      }),
      giftRecipientFor({
        executor,
        handle: gift.recipientHandle,
        now: input.now,
      }),
    ]);
    return (
      mayInteract &&
      recipient?.creatorId === gift.recipientCreatorId &&
      recipient.userId === gift.recipientUserId
    );
  }
}
