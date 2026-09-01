import type { SafeLogger } from '@velora/observability/server';

import type { OutboxConsumer, OutboxEvent } from '../events/relay.js';
import { coinPackCoins } from './catalogue.js';
import type { WalletService } from './service.js';

/**
 * WALLET reading BILLING's commercial facts.
 *
 * The receiving half of the seam ADR-0011 requires between money and
 * entitlement, and the same one PRIVATE CLUBS already uses. BILLING publishes
 * that a purchase settled or a payment came back; this decides what that means
 * for a balance, using its own rules, against its own tables. Neither domain
 * reads the other's storage and neither calls the other synchronously.
 *
 * That seam is why Web acquisition needs no wallet-specific payment code at
 * all: a coin pack is an ordinary offer, checkout is ordinary checkout, and the
 * only thing this domain adds is what to do when one settles.
 *
 * Delivery is at-least-once, so both handlers are idempotent by construction
 * rather than by checking first: crediting collides on the acquisition row's
 * unique index over channel and reference, and reversing collides on the
 * ledger's own business identity. A redelivered grant credits nothing extra; a
 * redelivered reversal removes nothing extra.
 *
 * **A fact naming a resource type this domain does not own is ignored, not
 * failed.** Treating somebody else's event as an error here would make every
 * future resource type an outage in this consumer.
 */
interface CommercialFact {
  readonly commercialReference?: unknown;
  readonly consumerId?: unknown;
  readonly resourceId?: unknown;
  readonly resourceType?: unknown;
}

/** The resource type a coin pack is sold as. Anything else is somebody else's. */
export const coinsResourceType = 'coins';

function coinFact(payload: unknown):
  | {
      readonly coins: bigint;
      readonly commercialReference: string;
      readonly consumerId: string;
    }
  | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fact = payload as CommercialFact;
  if (fact.resourceType !== coinsResourceType) return undefined;
  if (typeof fact.resourceId !== 'string') return undefined;
  if (typeof fact.consumerId !== 'string') return undefined;
  if (typeof fact.commercialReference !== 'string') return undefined;
  // What the pack is worth comes from this domain's own catalogue keyed by the
  // resource BILLING named, never from the payload. A price is not an input to
  // how many coins something is: an offer whose price changed must not
  // retroactively change what an earlier purchase was worth, and a payload that
  // could carry a coin count would be a way to mint them.
  const coins = coinPackCoins(fact.resourceId);
  if (coins === undefined) return undefined;
  return {
    coins,
    commercialReference: fact.commercialReference,
    consumerId: fact.consumerId,
  };
}

export class WalletEntitlementIntake implements OutboxConsumer {
  constructor(
    readonly eventName: string,
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly mode: 'grant' | 'revoke';
      readonly wallet: WalletService;
    },
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const fact = coinFact(event.payload);
    if (fact === undefined) return;
    const { logger, mode, wallet } = this.dependencies;
    if (!wallet.enabled) {
      // No ledger in this environment. The money is real and BILLING has
      // recorded it; there is simply nowhere for coins to live, which is a
      // configuration this environment chose and not a failure to report.
      logger.info(
        { eventId: event.id },
        'commercial coin fact arrived with no coin ledger configured',
      );
      return;
    }

    if (mode === 'grant') {
      const credited = await wallet.creditPurchase({
        channel: 'web',
        coins: fact.coins,
        purchaseReference: fact.commercialReference,
        userId: fact.consumerId,
      });
      if (credited.kind === 'credited' && credited.alreadyCredited) {
        logger.info(
          { eventId: event.id },
          'commercial coin purchase already credited',
        );
      }
      return;
    }
    await wallet.reversePurchase({
      channel: 'web',
      purchaseReference: fact.commercialReference,
    });
  }
}

/** The two facts this domain consumes, built together so neither is forgotten. */
export function walletEntitlementIntakes(dependencies: {
  readonly grantedEvent: string;
  readonly logger: SafeLogger;
  readonly revokedEvent: string;
  readonly wallet: WalletService;
}): readonly OutboxConsumer[] {
  return [
    new WalletEntitlementIntake(dependencies.grantedEvent, {
      logger: dependencies.logger,
      mode: 'grant',
      wallet: dependencies.wallet,
    }),
    new WalletEntitlementIntake(dependencies.revokedEvent, {
      logger: dependencies.logger,
      mode: 'revoke',
      wallet: dependencies.wallet,
    }),
  ];
}
