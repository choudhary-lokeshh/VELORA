import {
  activateLivePreferenceRequestSchema,
  androidCoinPurchaseRequestSchema,
  broadenLivePreferenceRequestSchema,
  coinGrantRequestSchema,
  productErrorCodes,
  walletStateResponseSchema,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from '../users/context.js';
import type { CoinAcquisitionPort } from './acquisition.js';
import {
  livePreferenceEntitlementDurationMilliseconds,
  livePremiumPreferenceCatalogue,
  livePremiumPreferenceKinds,
} from './policy.js';
import type { WalletService, WalletRefusal } from './service.js';

export interface WalletRoutesDependencies {
  /** How Android acquires coins in this environment. */
  readonly acquisition: CoinAcquisitionPort;
  readonly consumerContext: ConsumerContextResolver;
  /**
   * Whether a development grant may be made at all.
   *
   * Composed from the environment once, never read from a request. It is the
   * one operation here whose availability depends on where the process is
   * running rather than on what is configured, because a grant is the only path
   * that creates coins nobody paid for.
   */
  readonly grantsPermitted: boolean;
  /** Whether the Web may currently acquire coins. Follows BILLING's provider. */
  readonly webAcquisition: 'local-test' | 'unavailable';
  readonly wallet: WalletService;
}

/**
 * The coin-wallet surface.
 *
 * Flat paths rather than `/{id}/verb`, matching every other route this
 * repository publishes.
 *
 * Nothing here decides anything financial. The balance, the price, the
 * duration, the idempotency, and every refusal are decided by the domain inside
 * the transaction that writes; these handlers parse a bounded body, hand it to
 * the service, and translate one outcome into one status.
 *
 * Every response is the same authoritative wallet read, whatever the operation
 * was. A client that activated, cancelled, or redeemed does not then have to
 * ask what its balance is — which is what stops a surface rendering a stale
 * number it computed itself from a delta.
 */
export class WalletRoutes {
  constructor(private readonly dependencies: WalletRoutesDependencies) {}

  async getState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    return this.state(resolved.context.account.id);
  }

  async activateLivePreference(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      activateLivePreferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.wallet.activateLivePreference({
      ...parsed.value,
      // From the authenticated principal and never from the body, which is what
      // makes "nobody can spend somebody else's coins" a property of the code
      // rather than of this handler.
      userId: resolved.context.account.id,
    });
    if (outcome.kind === 'refused') {
      return this.refusal(input, outcome.reason);
    }
    return this.state(resolved.context.account.id);
  }

  /**
   * Widens a window that is already running, at no charge.
   *
   * A separate operation from activation rather than an "update", because the
   * two have opposite financial consequences and a single endpoint that
   * sometimes charged would be one whose cost depended on state a client cannot
   * see. Anything that is not strictly a widening is refused here and the
   * surface offers the honest alternative.
   */
  async broadenLivePreference(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      broadenLivePreferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.wallet.broadenLivePreference({
      ...parsed.value,
      userId: resolved.context.account.id,
    });
    if (outcome.kind === 'refused') {
      return this.refusal(input, outcome.reason);
    }
    return this.state(resolved.context.account.id);
  }

  async cancelLivePreference(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    if (!this.dependencies.wallet.enabled) {
      return this.refusal(input, 'unavailable');
    }
    // Cancelling nothing is not an error. Somebody whose window expired a
    // second before they pressed it has had the coins returned already, and
    // telling them the request failed would be describing a problem they do not
    // have.
    await this.dependencies.wallet.cancelLivePreference(
      resolved.context.account.id,
    );
    return this.state(resolved.context.account.id);
  }

  /**
   * Turns an Android store purchase into coins.
   *
   * Verification happens first and outside any database transaction, because it
   * is a network call to a store. Only what the store confirmed reaches the
   * ledger: the coin amount comes from the platform's own catalogue keyed by
   * the product the store named, so nothing a client sent decides what anybody
   * is credited.
   */
  async redeemAndroidPurchase(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(androidCoinPurchaseRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    if (
      !this.dependencies.wallet.enabled ||
      this.dependencies.acquisition.channel === 'unavailable'
    ) {
      return this.refusal(input, 'unavailable');
    }

    let verified;
    try {
      verified = await this.dependencies.acquisition.verifyPurchase({
        productReference: parsed.value.productReference,
        purchaseToken: parsed.value.purchaseToken,
        userId: resolved.context.account.id,
      });
    } catch {
      // Deliberately uniform. A malformed token, a token for another account, a
      // product this platform does not sell, and a store that refused are one
      // answer, because telling them apart would tell somebody which part of a
      // forgery to fix. Nothing was written.
      return routeFailure(
        409,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    if (verified.status !== 'purchased') {
      // A pending or cancelled purchase credits nothing. A pending one may
      // complete later and will be redeemed then, by the same idempotent path.
      return routeFailure(
        409,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }

    const credited = await this.dependencies.wallet.creditPurchase({
      channel: 'android',
      coins: verified.coins,
      purchaseReference: verified.purchaseReference,
      userId: resolved.context.account.id,
    });
    if (credited.kind === 'refused') {
      return this.refusal(input, credited.reason);
    }
    // Acknowledged only after the coins are durably credited. Play refunds an
    // unacknowledged purchase after three days, so acknowledging first would
    // acknowledge a delivery that had not happened; a failure here defers
    // rather than reversing, and the purchase stays redeemable.
    try {
      await this.dependencies.acquisition.acknowledgePurchase({
        productReference: parsed.value.productReference,
        purchaseToken: parsed.value.purchaseToken,
      });
    } catch {
      // Swallowed on purpose. The person has their coins; an unacknowledged
      // purchase is an obligation to the store, not a failure to report to
      // somebody who has already been credited.
    }
    return this.state(resolved.context.account.id);
  }

  /**
   * Credits coins without a purchase, where the environment permits it.
   *
   * Refused with the same status a missing dependency gets, because from a
   * client's point of view that is exactly what it is: this environment has no
   * mechanism that can do this. It never says "you are not allowed", which
   * would invite somebody to look for the environment where they would be.
   */
  async grant(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(coinGrantRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    if (!this.dependencies.grantsPermitted) {
      return this.refusal(input, 'unavailable');
    }
    const outcome = await this.dependencies.wallet.grant({
      coins: BigInt(parsed.value.coins),
      // Scoped to the caller, so two people using the same reference get their
      // own grant rather than one of them silently getting nothing.
      reference: `${resolved.context.account.id}:${parsed.value.reference}`,
      userId: resolved.context.account.id,
    });
    if (outcome.kind === 'refused') return this.refusal(input, outcome.reason);
    return this.state(resolved.context.account.id);
  }

  /**
   * The one authoritative answer, returned by every operation here.
   *
   * Assembled from what the domain actually holds rather than from what the
   * operation intended: a client that activated a window is told the window it
   * has, which is the same thing a fresh read would say.
   */
  private async state(userId: string): Promise<RouteResult> {
    const wallet = this.dependencies.wallet;
    const balance = await wallet.balance(userId);
    const held = wallet.enabled
      ? await wallet.activeLivePreferenceFor(userId)
      : undefined;
    return {
      body: walletStateResponseSchema.parse({
        acquisition: {
          android:
            this.dependencies.acquisition.channel === 'local-test'
              ? 'local-test'
              : 'unavailable',
          web: this.dependencies.webAcquisition,
        },
        ...(balance === undefined
          ? {}
          : {
              balance: {
                available: balance.available.toString(),
                reserved: balance.reserved.toString(),
              },
            }),
        enabled: wallet.enabled,
        ...(held === undefined
          ? {}
          : {
              livePreference: {
                charged: held.charged,
                coins: held.coins.toString(),
                expiresAt: held.expiresAt.toISOString(),
                ...(held.gender === undefined ? {} : { gender: held.gender }),
                id: held.entitlementId,
                ...(held.language === undefined
                  ? {}
                  : { language: held.language }),
                ...(held.region === undefined ? {} : { region: held.region }),
              },
            }),
        // Published from the same table the service charges from, so a surface
        // can never render a price that is not the price. The order is the
        // catalogue's own, so two clients cannot disagree about it without one
        // of them ignoring this answer.
        livePreferenceCatalogue: {
          durationSeconds: Math.floor(
            livePreferenceEntitlementDurationMilliseconds / 1000,
          ),
          preferences: livePremiumPreferenceKinds.map((kind) => ({
            coins: livePremiumPreferenceCatalogue[kind].coins.toString(),
            kind,
          })),
        },
      }),
      status: 200,
    };
  }

  private refusal(input: RouteRequest, reason: WalletRefusal): RouteResult {
    switch (reason) {
      case 'unavailable': {
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      case 'insufficient_balance': {
        // Says only that. How much is missing is not disclosed, because a
        // sequence of refusals would otherwise read somebody's balance.
        return routeFailure(
          409,
          productErrorCodes.insufficientFunds,
          input.correlationId,
        );
      }
      case 'rate_limited': {
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      case 'not_supported': {
        return routeFailure(
          422,
          productErrorCodes.validationFailed,
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.conflict,
          input.correlationId,
        );
      }
    }
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
