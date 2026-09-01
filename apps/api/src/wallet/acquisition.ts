/**
 * How coins are acquired on Android, declared in full before any adapter
 * exists.
 *
 * Two channels, deliberately separate, because Google Play requires digital
 * goods consumed inside a Play-distributed application to be sold through Play
 * Billing and because the *proof* is different on each side. On the Web a
 * purchase is proved by BILLING settling a payment through its own provider and
 * publishing an entitlement fact; that path already exists and this file is not
 * part of it. On Android a purchase is proved by verifying a purchase token
 * against Google's own API from a server holding a service-account credential.
 *
 * The one rule both channels share, and the one this port exists to make
 * unbreakable: **a client saying a purchase succeeded never mints anything.**
 * The value a wallet credits comes from a verification this platform performed,
 * against a party that is not the buyer's device.
 *
 * Written as a port with no `google-play` adapter rather than as a stub that
 * pretends. No Play Console project, product identifier, application signing
 * key, or service-account credential exists, so an adapter could not verify
 * anything — and a channel that could be selected and could not verify would be
 * a channel that mints currency on a client's word.
 */

/**
 * What a store says about one purchase, in VELORA's terms.
 *
 * Deliberately small and deliberately not a mirror of any store's vocabulary. A
 * store that publishes a dozen states maps them onto these inside its adapter,
 * so a new state at a vendor is an adapter change rather than a domain
 * migration.
 *
 * There is no `unknown`. A store that cannot say has given an absent answer
 * rather than a state, and the adapter throws so the acquisition stays
 * unrecorded and retryable rather than being resolved by a guess.
 */
export const coinPurchaseStatuses = [
  'purchased',
  'pending',
  'cancelled',
] as const;
export type CoinPurchaseStatus = (typeof coinPurchaseStatuses)[number];

export interface CoinPurchaseVerificationRequest {
  /**
   * The store's own identifier for the product that was bought.
   *
   * Carried so the adapter can check that the token it is verifying names the
   * product the caller claims. A verification that accepted any product for any
   * price would let the cheapest purchase in the catalogue buy the largest
   * coin pack.
   */
  readonly productReference: string;
  /** The opaque token the store issued. Never logged, never stored. */
  readonly purchaseToken: string;
  /** The VELORA account the coins would be credited to. */
  readonly userId: string;
}

/**
 * What a verified purchase is worth, decided by this platform and never by the
 * client.
 *
 * `coins` comes from the platform's own catalogue keyed by the product the
 * store confirmed, so a client that asked for a small pack and claimed a large
 * one is credited what it actually bought.
 */
export interface VerifiedCoinPurchase {
  readonly coins: bigint;
  /**
   * The identity this purchase is idempotent on, within its channel.
   *
   * A store's own order identifier where it publishes one, so a redelivered
   * acknowledgement, a reinstall, and a support-triggered replay all collide on
   * one row and credit once.
   */
  readonly purchaseReference: string;
  readonly status: CoinPurchaseStatus;
}

export class CoinAcquisitionUnavailableError extends Error {
  constructor() {
    super('No coin acquisition channel is configured for this platform');
    this.name = 'CoinAcquisitionUnavailableError';
  }
}

export interface CoinAcquisitionPort {
  /** Adapter name, recorded on every acquisition for audit and routing. */
  readonly channel: string;
  /**
   * Verifies a purchase with the party that sold it, or refuses.
   *
   * Never called inside a database transaction: verification is a network call
   * to a store, and a pooled connection held across somebody else's network is
   * a connection the admission bound cannot account for.
   */
  verifyPurchase(
    request: CoinPurchaseVerificationRequest,
  ): Promise<VerifiedCoinPurchase>;
  /**
   * Tells the store the purchase has been delivered, where the store requires
   * it.
   *
   * Separate from verification because it is a different obligation with a
   * different failure mode: Play refunds an unacknowledged purchase after three
   * days, and acknowledging before the coins are durably credited would
   * acknowledge a delivery that had not happened. It runs after the ledger
   * commits, and a failure defers rather than reverses.
   */
  acknowledgePurchase(input: {
    readonly productReference: string;
    readonly purchaseToken: string;
  }): Promise<void>;
}

/**
 * The channel every deployed environment gets.
 *
 * It refuses rather than returning `pending`, because a pending acquisition
 * nobody can settle is worse than a refusal: it would be a durable record of an
 * intention to credit somebody through a store that does not exist.
 */
export class UnavailableCoinAcquisition implements CoinAcquisitionPort {
  readonly channel = 'unavailable';

  acknowledgePurchase(): Promise<void> {
    return Promise.reject(new CoinAcquisitionUnavailableError());
  }

  verifyPurchase(): Promise<VerifiedCoinPurchase> {
    return Promise.reject(new CoinAcquisitionUnavailableError());
  }
}

/**
 * How many coins the one local product is worth.
 *
 * A single pack, because the point of this adapter is to make the wallet, the
 * entitlement, and the matching that depends on them walkable on a device — not
 * to model a catalogue nobody has priced. What a pack costs in money is
 * undecided and is not represented here at all, which is the honest shape for a
 * channel that takes no money.
 */
export const localTestCoinProduct = 'velora.coins.local_test';
export const localTestCoinProductCoins = 100n;

/**
 * A deterministic, network-free acquisition channel.
 *
 * It exists so the server-side path — verify, then credit idempotently, then
 * acknowledge — is exercisable end to end before a store account exists, and it
 * is named `local-test` so no passing test can be read as evidence about a real
 * purchase. Configuration refuses it outside local and test, so there is no
 * route, header, request field, or environment string that reaches it in a
 * deployed environment.
 *
 * It still refuses a token it did not shape, and it still derives the coin
 * amount from the platform's own catalogue rather than from the request. Those
 * are not decoration: they are the two properties a real adapter must have, and
 * a fixture that skipped them would let the code above it be written wrongly
 * and pass.
 */
export class LocalTestCoinAcquisition implements CoinAcquisitionPort {
  readonly channel = 'local-test';

  acknowledgePurchase(): Promise<void> {
    return Promise.resolve();
  }

  verifyPurchase(
    request: CoinPurchaseVerificationRequest,
  ): Promise<VerifiedCoinPurchase> {
    if (request.productReference !== localTestCoinProduct) {
      return Promise.reject(
        new Error(
          `Unknown local-test coin product ${request.productReference}`,
        ),
      );
    }
    // The token has a shape this fixture issues, so a caller cannot invent one.
    // A real adapter's equivalent is the store rejecting a token it never
    // minted, which is the property being stood in for.
    if (!/^local-test-purchase-[0-9a-f-]{8,64}$/u.test(request.purchaseToken)) {
      return Promise.reject(new Error('Malformed local-test purchase token'));
    }
    return Promise.resolve({
      // From the catalogue, keyed by the product. Never from the request.
      coins: localTestCoinProductCoins,
      purchaseReference: request.purchaseToken,
      status: 'purchased',
    });
  }
}
