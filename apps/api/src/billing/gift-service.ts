import type { TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type { JournalStore } from '../money/journal.js';
import { money, zeroMoney, type Money } from '../money/money.js';
import type { SafetyDirectoryPort } from '../safety/directory.js';
import { creatorPayableAccount } from './revenue-entries.js';
import type { CheckoutService } from './checkout-service.js';
import type {
  GiftCatalogOfferRow,
  GiftHistoryRow,
  GiftRepository,
} from './gift-repository.js';
import { maximumGiftHistoryPageSize } from './gift-policy.js';
import {
  LocalTestPaymentProvider,
  localTestSignatureHeader,
} from './local-test-provider.js';
import type { CommercialConsumerPort, CommercialCreatorPort } from './ports.js';
import type { PaymentProviderPort } from './provider.js';
import type { WebhookService } from './webhook-service.js';

export type GiftRefusal =
  'conflict' | 'not_eligible' | 'not_found' | 'unavailable';

export interface GiftRecipient {
  readonly creatorId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly userId: string;
}

export type GiftCatalogOutcome =
  | {
      readonly enabled: boolean;
      readonly items: readonly GiftCatalogOfferRow[];
      readonly kind: 'catalog';
      readonly recipient: GiftRecipient;
    }
  | { readonly kind: 'refused'; readonly reason: GiftRefusal };

export type SendGiftOutcome =
  | { readonly gift: GiftHistoryRow; readonly kind: 'recorded' }
  | { readonly kind: 'refused'; readonly reason: GiftRefusal };

export interface GiftServiceDependencies {
  readonly checkout: CheckoutService;
  readonly consumers: CommercialConsumerPort;
  readonly creators: CommercialCreatorPort;
  readonly gifts: GiftRepository;
  readonly journal: JournalStore;
  readonly now: () => Date;
  readonly provider: PaymentProviderPort;
  readonly safety?: SafetyDirectoryPort;
  readonly webhooks: WebhookService;
}

export class GiftService {
  constructor(private readonly dependencies: GiftServiceDependencies) {}

  async catalog(input: {
    readonly currency: string;
    readonly handle: string;
    readonly senderUserId: string;
  }): Promise<GiftCatalogOutcome> {
    if (!this.available()) return { kind: 'refused', reason: 'unavailable' };
    const { consumers, creators, gifts, safety } = this.dependencies;
    const giftRecipientFor = creators.publishedGiftRecipientFor?.bind(creators);
    if (safety === undefined || giftRecipientFor === undefined) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    return gifts.transaction(async (executor) => {
      const now = this.dependencies.now();
      /*
       * One at a time, because these share one connection.
       *
       * `executor` is a transaction, which is a single PostgreSQL connection,
       * and a connection carries one statement at a time. Reading the sender's
       * standing and resolving the recipient are independent, so they were
       * started together — but issuing both at once hands the same connection
       * two conversations, and the driver has to serialise or interleave them.
       * On a slower machine that ended with the connection left `idle in
       * transaction` after the sender's account read, the request never
       * returning, and every later `TRUNCATE` in the suite blocking behind it.
       *
       * Where the same pair genuinely may run at once — `membership-service`
       * asking the same two questions — the executor is the pool, and each
       * query takes its own connection. That is the distinction, and it is why
       * this reads sequentially rather than moving off the transaction.
       */
      const standing = await consumers.standingForUser({
        executor,
        now,
        userId: input.senderUserId,
      });
      const recipient = await giftRecipientFor({
        executor,
        handle: input.handle,
        now,
      });
      if (recipient === undefined)
        return { kind: 'refused', reason: 'not_found' };
      if (
        standing?.inGoodStanding !== true ||
        recipient.userId === input.senderUserId ||
        !(await safety.mayInteract({
          executor,
          first: input.senderUserId,
          now,
          second: recipient.userId,
        }))
      ) {
        return { kind: 'refused', reason: 'not_eligible' };
      }
      const items = await gifts.catalogForCreator(executor, {
        creatorId: recipient.creatorId,
        currency: input.currency,
      });
      return {
        enabled: items.length > 0,
        items,
        kind: 'catalog',
        recipient,
      } as const;
    });
  }

  async send(input: {
    readonly correlationId: string;
    readonly currency: string;
    readonly giftItemId: string;
    readonly handle: string;
    readonly idempotencyKey: string;
    readonly senderUserId: string;
  }): Promise<SendGiftOutcome> {
    const catalog = await this.catalog(input);
    if (catalog.kind === 'refused') return catalog;
    const item = catalog.items.find(
      (candidate) => candidate.catalog.id === input.giftItemId,
    );
    if (item === undefined) return { kind: 'refused', reason: 'not_found' };
    const safety = this.dependencies.safety;
    const giftRecipientFor =
      this.dependencies.creators.publishedGiftRecipientFor?.bind(
        this.dependencies.creators,
      );
    if (safety === undefined || giftRecipientFor === undefined) {
      return { kind: 'refused', reason: 'unavailable' };
    }

    const prepared = await this.dependencies.gifts.transaction(
      async (executor) => {
        const existing = await this.dependencies.gifts.findBySenderKey(
          executor,
          input,
        );
        if (existing !== undefined) {
          if (
            existing.catalogItemId !== input.giftItemId ||
            existing.recipientCreatorId !== catalog.recipient.creatorId ||
            existing.offerId !== item.offerId
          ) {
            return { kind: 'refused', reason: 'conflict' } as const;
          }
          return { gift: existing, kind: 'prepared' } as const;
        }
        await lockPair(
          executor as TransactionHandle,
          input.senderUserId,
          catalog.recipient.userId,
        );
        const now = this.dependencies.now();
        // Sequential for the reason the catalog read is: this executor is one
        // connection, and it is already holding the pair lock taken above.
        const mayInteract = await safety.mayInteract({
          executor,
          first: input.senderUserId,
          now,
          second: catalog.recipient.userId,
        });
        const currentRecipient = await giftRecipientFor({
          executor,
          handle: input.handle,
          now,
        });
        if (
          !mayInteract ||
          currentRecipient?.creatorId !== catalog.recipient.creatorId ||
          currentRecipient.userId !== catalog.recipient.userId
        ) {
          return { kind: 'refused', reason: 'not_eligible' } as const;
        }
        const inserted = await this.dependencies.gifts.insert(executor, {
          catalogItemId: input.giftItemId,
          contextType: 'creator_profile',
          idempotencyKey: input.idempotencyKey,
          now,
          offerId: item.offerId,
          recipientCreatorId: catalog.recipient.creatorId,
          recipientDisplayName: catalog.recipient.displayName,
          recipientHandle: catalog.recipient.handle,
          recipientUserId: catalog.recipient.userId,
          senderUserId: input.senderUserId,
        });
        if (inserted !== undefined)
          return { gift: inserted, kind: 'prepared' } as const;
        const winner = await this.dependencies.gifts.findBySenderKey(
          executor,
          input,
        );
        return winner === undefined
          ? ({ kind: 'refused', reason: 'conflict' } as const)
          : ({ gift: winner, kind: 'prepared' } as const);
      },
    );
    if (prepared.kind === 'refused') return prepared;

    const checkout = await this.dependencies.checkout.start({
      consumerId: input.senderUserId,
      correlationId: input.correlationId,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      offerId: item.offerId,
    });
    if (checkout.kind === 'refused') {
      return {
        kind: 'refused',
        reason: checkout.reason === 'conflict' ? 'conflict' : 'not_eligible',
      };
    }
    await this.dependencies.gifts.transaction(async (executor) =>
      this.dependencies.gifts.linkPayment(executor, {
        giftId: prepared.gift.id,
        now: this.dependencies.now(),
        paymentId: checkout.payment.id,
      }),
    );

    if (
      checkout.payment.state === 'failed' ||
      checkout.payment.state === 'cancelled'
    ) {
      await this.dependencies.gifts.transaction(async (executor) =>
        this.dependencies.gifts.transitionByPayment(executor, {
          from: ['pending'],
          now: this.dependencies.now(),
          paymentId: checkout.payment.id,
          to: 'failed',
        }),
      );
    }

    if (
      this.dependencies.provider instanceof LocalTestPaymentProvider &&
      checkout.payment.providerReference !== null &&
      checkout.payment.state === 'provider_pending'
    ) {
      this.dependencies.provider.markSucceeded(
        checkout.payment.providerReference,
      );
      const rawBody = JSON.stringify({
        amountMinor: checkout.payment.amountMinor.toString(),
        currency: checkout.payment.currency,
        eventId: `gift-${prepared.gift.id}`,
        eventType: 'payment.succeeded',
        providerPaymentReference: checkout.payment.providerReference,
        status: 'succeeded',
      });
      const headers = new Headers({
        [localTestSignatureHeader]:
          LocalTestPaymentProvider.signatureFor(rawBody),
      });
      const received = await this.dependencies.webhooks.receive({
        correlationId: input.correlationId,
        headers,
        rawBody,
      });
      if (received.kind !== 'accepted')
        return { kind: 'refused', reason: 'unavailable' };
      await this.dependencies.webhooks.processOnce();
    }

    const gift = await this.dependencies.gifts.findOwnHistory(
      this.dependencies.gifts.transactionless,
      { giftId: prepared.gift.id, senderUserId: input.senderUserId },
    );
    return gift === undefined
      ? { kind: 'refused', reason: 'unavailable' }
      : { gift, kind: 'recorded' };
  }

  listSent(senderUserId: string): Promise<GiftHistoryRow[]> {
    return this.dependencies.gifts.listSent(
      this.dependencies.gifts.transactionless,
      senderUserId,
      maximumGiftHistoryPageSize,
    );
  }

  async provisionLocalCatalog(creatorId: string): Promise<number | undefined> {
    if (!this.available()) return undefined;
    return this.dependencies.gifts.transaction(async (executor) => {
      if (
        !(await this.dependencies.creators.mayOperate({ creatorId, executor }))
      ) {
        return undefined;
      }
      return this.dependencies.gifts.provisionLocalCatalog(executor, {
        creatorId,
        now: this.dependencies.now(),
      });
    });
  }

  async listReceived(
    creatorId: string,
  ): Promise<readonly (GiftHistoryRow & { readonly earning: Money })[]> {
    const rows = await this.dependencies.gifts.listReceived(
      this.dependencies.gifts.transactionless,
      creatorId,
      maximumGiftHistoryPageSize,
    );
    const byCurrency = new Map<string, GiftHistoryRow[]>();
    for (const row of rows) {
      const group = byCurrency.get(row.currency) ?? [];
      group.push(row);
      byCurrency.set(row.currency, group);
    }
    const earnings = new Map<string, bigint>();
    await Promise.all(
      [...byCurrency].map(async ([currency, currencyRows]) => {
        const paymentIds = currencyRows.flatMap((row) =>
          row.paymentId === null ? [] : [row.paymentId],
        );
        const accountId = this.dependencies.journal.accountId(
          currency,
          creatorPayableAccount(creatorId),
        );
        const values = await this.dependencies.gifts.creatorEarningsForPayments(
          this.dependencies.gifts.transactionless,
          { accountId, currency, paymentIds },
        );
        for (const [paymentId, amountMinor] of values) {
          earnings.set(paymentId, amountMinor);
        }
      }),
    );
    return rows.map((row) => ({
      ...row,
      earning:
        row.paymentId === null
          ? zeroMoney(row.currency)
          : money(earnings.get(row.paymentId) ?? 0n, row.currency),
    }));
  }

  private available(): boolean {
    return this.dependencies.provider.provider === 'local-test';
  }
}
