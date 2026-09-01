import { randomUUID } from 'node:crypto';

import type { Executor, TransactionHandle } from '../database/executor.js';
import type { CoinBalance, CoinLedger, CoinPosting } from './ledger.js';
import {
  livePreferenceEntitlementCoins,
  livePreferenceEntitlementDurationMilliseconds,
  livePreferenceSweepBatchSize,
  maximumLivePreferenceActivationsPerWindow,
  maximumWalletOperationCoins,
  regionCodePattern,
  walletAbuseWindowMilliseconds,
} from './policy.js';
import type {
  LivePreferenceEntitlementRow,
  WalletRepository,
} from './repository.js';

/**
 * What the matcher needs to know about somebody's paid narrowing, and nothing
 * else.
 *
 * Deliberately not the entitlement row. LIVE has no business knowing what
 * anything cost, when it was reserved, or which ledger transaction holds the
 * coins — it needs the predicate and the identity of the window that bought it,
 * so it can ask for that window to be captured when it produces an encounter.
 */
export interface ActiveLivePreference {
  readonly entitlementId: string;
  readonly expiresAt: Date;
  /** ISO 3166-1 alpha-2. The declared region the pool is narrowed to. */
  readonly region: string;
}

export type WalletRefusal =
  /** No coin ledger exists in this environment. */
  | 'unavailable'
  /** The balance will not cover it. Says only that. */
  | 'insufficient_balance'
  /** A window is already open, or one just closed under this caller. */
  | 'conflict'
  /** Too many activations in the window. */
  | 'rate_limited'
  /** The request could never be honoured — an unsupported preference. */
  | 'not_supported';

export type ActivateLivePreferenceOutcome =
  | {
      readonly kind: 'activated';
      readonly entitlement: LivePreferenceEntitlementRow;
    }
  | { readonly kind: 'refused'; readonly reason: WalletRefusal };

export type CreditOutcome =
  | { readonly alreadyCredited: boolean; readonly kind: 'credited' }
  | { readonly kind: 'refused'; readonly reason: WalletRefusal };

/**
 * What one sweep cycle did. Counts only, on the same rule the RTC reconciler
 * follows: naming the people would put somebody's spending in a log line.
 */
export interface WalletSweepReport {
  readonly examined: number;
  readonly released: number;
}

export interface WalletServiceDependencies {
  /**
   * Whether coins exist at all in this environment.
   *
   * Read from configuration once, at composition, and never from a request.
   * When it is `unavailable` every operation here refuses — including the
   * reads, because a balance of zero and "no wallet exists" are different
   * answers and a surface that could not tell them apart would offer somebody
   * a purchase that could never complete.
   */
  readonly enabled: boolean;
  readonly ledger: CoinLedger;
  readonly now: () => Date;
  readonly repository: WalletRepository;
}

/**
 * Coins, and the one thing they currently buy.
 *
 * Every rule that makes a virtual balance safe lives here, and each is a thing
 * that goes wrong when it is left to a caller.
 *
 * **The server is the balance.** No request field, header, or client value
 * contributes to what somebody holds or what anything costs. A client's copy of
 * a balance is a rendering hint that this service never reads.
 *
 * **Every mutation is a balanced ledger posting with a business identity.** A
 * retry, a redelivered event, and two concurrent taps all collide on that
 * identity and produce one movement. There is no path here that writes a
 * balance without writing the entries that justify it, in the same transaction.
 *
 * **Spending takes the row lock first.** Two activations racing on the same
 * wallet serialize on the balance row, and the database's own non-negativity
 * constraint is the backstop — so an overspend is refused by PostgreSQL rather
 * than by whichever read happened to run first.
 *
 * **Paying narrows a search and authorizes nothing.** An active window is an
 * input to the matcher's candidate query and to nothing else. Eligibility,
 * standing, blocks, enforcement, and RTC admission are asked identically and in
 * the same order whether or not anybody paid, and any one of them refusing
 * produces no encounter. That is why this module has no method a safety
 * decision has to consult.
 */
export class WalletService {
  constructor(private readonly dependencies: WalletServiceDependencies) {}

  /** Whether this environment has a wallet at all. */
  get enabled(): boolean {
    return this.dependencies.enabled;
  }

  /**
   * What somebody holds and what is committed.
   *
   * `undefined` when no ledger exists, which is not zero: a surface reading
   * zero would offer a purchase, and a surface reading nothing says the feature
   * is not available here.
   */
  async balance(userId: string): Promise<CoinBalance | undefined> {
    if (!this.dependencies.enabled) return undefined;
    return this.dependencies.ledger.balanceOf(
      this.dependencies.repository.transactionless,
      userId,
    );
  }

  /**
   * The narrowing this person has paid for and still holds, if any.
   *
   * Read on the caller's own executor, because the caller is the matcher and it
   * is already inside the transaction that will allocate an encounter. An
   * expired window is treated as absent here as well as being swept, so a
   * matcher never applies a narrowing whose time is up even if the worker is
   * behind.
   */
  async activeLivePreference(
    executor: Executor,
    userId: string,
  ): Promise<ActiveLivePreference | undefined> {
    if (!this.dependencies.enabled) return undefined;
    const row = await this.dependencies.repository.findActiveEntitlement(
      executor,
      userId,
    );
    if (row === undefined) return undefined;
    if (row.expiresAt.getTime() <= this.dependencies.now().getTime()) {
      return undefined;
    }
    // The database guarantees a region-kind window names a region; this is the
    // type system catching up with the constraint rather than a second rule.
    if (row.preferenceRegion === null) return undefined;
    return {
      entitlementId: row.id,
      expiresAt: row.expiresAt,
      region: row.preferenceRegion,
    };
  }

  /**
   * The same window, with what it cost, for a surface that renders it.
   *
   * Separate from {@link activeLivePreference} because the two have different
   * audiences and must carry different things. The matcher gets the predicate
   * and the identity, and no price — LIVE has no business knowing what anything
   * cost. A wallet surface gets the price, because that is what it is for.
   */
  async activeLivePreferenceFor(
    userId: string,
  ): Promise<(ActiveLivePreference & { readonly coins: bigint }) | undefined> {
    if (!this.dependencies.enabled) return undefined;
    const executor = this.dependencies.repository.transactionless;
    const row = await this.dependencies.repository.findActiveEntitlement(
      executor,
      userId,
    );
    if (row?.preferenceRegion == null) return undefined;
    if (row.expiresAt.getTime() <= this.dependencies.now().getTime()) {
      return undefined;
    }
    return {
      coins: row.coins,
      entitlementId: row.id,
      expiresAt: row.expiresAt,
      region: row.preferenceRegion,
    };
  }

  /**
   * Opens a paid, bounded window of narrowed matching, and reserves the coins
   * it costs.
   *
   * The coins leave the spendable balance now and are *not* spent: they move to
   * a reserved position, which is what makes "a second activation cannot be
   * funded by money committed to the first" true at the database rather than by
   * convention. They are captured when the window produces an encounter and
   * released in full when it does not.
   */
  async activateLivePreference(input: {
    readonly region: string;
    readonly userId: string;
  }): Promise<ActivateLivePreferenceOutcome> {
    if (!this.dependencies.enabled) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    // The one preference this product supports, checked against the declared
    // shape rather than against a list of countries. A caller asking to filter
    // on anything else is refused here, before a balance is read, so an
    // unsupported attribute can never become a charge.
    if (!new RegExp(regionCodePattern, 'u').test(input.region)) {
      return { kind: 'refused', reason: 'not_supported' };
    }

    const { ledger, now, repository } = this.dependencies;
    const at = now();
    return repository
      .transaction(async (executor) => {
        await repository.lockWallet(executor, input.userId);

        // Before the money, and counted over the same window every other bound in
        // this repository uses. It bounds activating and cancelling in a loop,
        // which costs nothing and produces a ledger transaction pair every time.
        if (
          (await repository.countActivationsSince(executor, {
            since: new Date(at.getTime() - walletAbuseWindowMilliseconds),
            userId: input.userId,
          })) >= maximumLivePreferenceActivationsPerWindow
        ) {
          return { kind: 'refused', reason: 'rate_limited' } as const;
        }

        const held = await repository.lockActiveEntitlement(
          executor,
          input.userId,
        );
        if (held !== undefined) {
          // One open window per person. A caller who already has one is told so
          // rather than being charged again, and the surface renders the window
          // it already holds.
          return { kind: 'refused', reason: 'conflict' } as const;
        }

        const balance = await ledger.lockBalance(executor, input.userId);
        if (balance.available < livePreferenceEntitlementCoins) {
          // Says only that the balance will not cover it. How much is missing,
          // and how much is held, are not part of a refusal: a refusal that
          // reported them would be a way to read somebody's balance from a
          // sequence of failed attempts.
          return { kind: 'refused', reason: 'insufficient_balance' } as const;
        }

        const entitlementId = randomUUID();
        const posting = await ledger.post(executor, {
          // The window's own identifier is the business reference, so a retry
          // that generated a new one cannot double-reserve and a replay of this
          // one cannot either.
          businessReference: entitlementId,
          businessType: 'wallet.live_preference.reserve',
          entries: [
            {
              account: {
                category: 'consumer_balance',
                subjectId: input.userId,
              },
              amount: livePreferenceEntitlementCoins,
              direction: 'debit',
            },
            {
              account: {
                category: 'consumer_reserved',
                subjectId: input.userId,
              },
              amount: livePreferenceEntitlementCoins,
              direction: 'credit',
            },
          ],
          occurredAt: at,
          reason: 'reservation',
        } satisfies CoinPosting);

        await ledger.applyBalanceDelta(executor, {
          availableDelta: -livePreferenceEntitlementCoins,
          reservedDelta: livePreferenceEntitlementCoins,
          userId: input.userId,
        });

        const entitlement = await repository.insertEntitlement(executor, {
          coins: livePreferenceEntitlementCoins,
          expiresAt: new Date(
            at.getTime() + livePreferenceEntitlementDurationMilliseconds,
          ),
          id: entitlementId,
          now: at,
          preferenceKind: 'region',
          preferenceRegion: input.region,
          reservationTransactionId: posting.transactionId,
          userId: input.userId,
        });
        if (entitlement === undefined) {
          // The partial unique index refused: somebody else's transaction opened
          // a window for this person between the lock and here. Rolling back is
          // the correct answer, because the reservation above belongs to a window
          // that does not exist.
          throw new WalletConflict();
        }
        return { entitlement, kind: 'activated' } as const;
      })
      .catch((error: unknown) => {
        if (error instanceof WalletConflict) {
          return { kind: 'refused', reason: 'conflict' } as const;
        }
        throw error;
      });
  }

  /**
   * Charges an open window, because it produced the thing it was bought for.
   *
   * Takes the caller's executor and runs inside the caller's transaction on
   * purpose. The encounter and the capture have to commit together: a captured
   * reservation with no encounter would be a charge for nothing, and an
   * encounter with an uncaptured reservation would be a narrowed match somebody
   * was never charged for.
   *
   * Idempotent by the guarded update. A second capture of the same window
   * changes nothing and answers `false`, which is what makes it safe for the
   * matcher to call without first checking.
   */
  async captureLivePreference(
    executor: TransactionHandle,
    input: {
      readonly encounterId: string;
      readonly entitlementId: string;
      readonly userId: string;
    },
  ): Promise<boolean> {
    if (!this.dependencies.enabled) return false;
    const { ledger, now, repository } = this.dependencies;
    const held = await repository.lockActiveEntitlement(executor, input.userId);
    if (held?.id !== input.entitlementId) return false;

    const at = now();
    const posting = await ledger.post(executor, {
      businessReference: held.id,
      businessType: 'wallet.live_preference.capture',
      entries: [
        {
          account: { category: 'consumer_reserved', subjectId: input.userId },
          amount: held.coins,
          direction: 'debit',
        },
        {
          account: { category: 'platform_revenue' },
          amount: held.coins,
          direction: 'credit',
        },
      ],
      occurredAt: at,
      reason: 'capture',
    } satisfies CoinPosting);

    const settled = await repository.settleEntitlement(executor, {
      encounterId: input.encounterId,
      id: held.id,
      now: at,
      settlementTransactionId: posting.transactionId,
      state: 'captured',
    });
    if (settled === undefined) return false;

    await ledger.lockBalance(executor, input.userId);
    await ledger.applyBalanceDelta(executor, {
      availableDelta: 0n,
      reservedDelta: -held.coins,
      userId: input.userId,
    });
    return true;
  }

  /**
   * Closes an open window at the person's request and returns the coins in
   * full.
   *
   * Somebody who decides they would rather meet anybody has not consumed what
   * they bought, and charging them for changing their mind inside the window
   * would make the control something people avoid touching.
   */
  async cancelLivePreference(userId: string): Promise<boolean> {
    if (!this.dependencies.enabled) return false;
    return this.dependencies.repository.transaction(async (executor) => {
      await this.dependencies.repository.lockWallet(executor, userId);
      const held = await this.dependencies.repository.lockActiveEntitlement(
        executor,
        userId,
      );
      if (held === undefined) return false;
      return this.release(executor, held, 'cancelled');
    });
  }

  /**
   * Settles every window whose time is up, returning the coins in full.
   *
   * The worker's job, and it runs whether or not anybody is watching: a person
   * who closed the tab gets their coins back exactly as one who is still on the
   * screen does. Each row is settled in its own short transaction, so one
   * contended wallet never holds the batch.
   */
  async sweepExpired(
    limit = livePreferenceSweepBatchSize,
  ): Promise<WalletSweepReport> {
    if (!this.dependencies.enabled) return { examined: 0, released: 0 };
    const { now, repository } = this.dependencies;
    const due = await repository.findExpiredEntitlements(
      repository.transactionless,
      { limit, now: now() },
    );
    let released = 0;
    for (const row of due) {
      const settled = await repository.transaction(async (executor) => {
        await repository.lockWallet(executor, row.userId);
        const held = await repository.lockActiveEntitlement(
          executor,
          row.userId,
        );
        // Another worker, or the person themselves, settled it between the read
        // and the lock. The guarded update would refuse anyway; this refuses
        // before writing a posting that would then belong to nothing.
        if (held?.id !== row.id) return false;
        return this.release(executor, held, 'released');
      });
      if (settled) released += 1;
    }
    return { examined: due.length, released };
  }

  /**
   * Turns a purchase this platform has already verified into coins.
   *
   * The verification is the caller's — a settled BILLING payment on the Web, a
   * store-verified purchase token on Android — and this is deliberately unable
   * to perform one. What it owns is that a verified purchase credits exactly
   * once: the acquisition row's unique index over channel and reference is
   * consulted by the insert rather than by a prior read, so a redelivered
   * event, a reinstall replaying a token, and two devices racing all produce
   * one credit.
   */
  async creditPurchase(input: {
    readonly channel: string;
    readonly coins: bigint;
    readonly purchaseReference: string;
    readonly userId: string;
  }): Promise<CreditOutcome> {
    if (!this.dependencies.enabled) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    if (input.coins <= 0n || input.coins > maximumWalletOperationCoins) {
      return { kind: 'refused', reason: 'not_supported' };
    }
    const { ledger, now, repository } = this.dependencies;
    const at = now();
    return repository
      .transaction(async (executor) => {
        await repository.lockWallet(executor, input.userId);
        const existing = await repository.findAcquisition(executor, {
          channel: input.channel,
          purchaseReference: input.purchaseReference,
        });
        if (existing !== undefined) {
          return { alreadyCredited: true, kind: 'credited' } as const;
        }

        const posting = await ledger.post(executor, {
          businessReference: `${input.channel}:${input.purchaseReference}`,
          businessType: 'wallet.acquisition.credit',
          entries: [
            {
              account: { category: 'platform_issuance' },
              amount: input.coins,
              direction: 'debit',
            },
            {
              account: {
                category: 'consumer_balance',
                subjectId: input.userId,
              },
              amount: input.coins,
              direction: 'credit',
            },
          ],
          occurredAt: at,
          reason: 'purchase',
        } satisfies CoinPosting);

        const acquisition = await repository.insertAcquisition(executor, {
          channel: input.channel,
          coins: input.coins,
          id: randomUUID(),
          now: at,
          purchaseReference: input.purchaseReference,
          transactionId: posting.transactionId,
          userId: input.userId,
        });
        if (acquisition === undefined) {
          // Another transaction credited this purchase between the read and the
          // insert. Its posting is the one that counts, so this one must not
          // stand — rolling back is what makes "credited once" true under
          // concurrency rather than only under retry.
          throw new WalletConflict();
        }

        await ledger.lockBalance(executor, input.userId);
        await ledger.applyBalanceDelta(executor, {
          availableDelta: input.coins,
          reservedDelta: 0n,
          userId: input.userId,
        });
        return { alreadyCredited: false, kind: 'credited' } as const;
      })
      .catch((error: unknown) => {
        if (error instanceof WalletConflict) {
          return { alreadyCredited: true, kind: 'credited' } as const;
        }
        throw error;
      });
  }

  /**
   * A development grant, on exactly the same rails as a purchase.
   *
   * It is not a shortcut past the ledger: it posts, it is idempotent on the
   * reference the caller supplies, and it moves the same projection. What makes
   * it a grant rather than a purchase is the reason recorded against the
   * transaction, so the books can always say which coins were bought and which
   * were given.
   *
   * The route that reaches this is refused unless the environment is local or
   * test; see `./routes.js`.
   */
  async grant(input: {
    readonly coins: bigint;
    readonly reference: string;
    readonly userId: string;
  }): Promise<CreditOutcome> {
    if (!this.dependencies.enabled) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    if (input.coins <= 0n || input.coins > maximumWalletOperationCoins) {
      return { kind: 'refused', reason: 'not_supported' };
    }
    const { ledger, now, repository } = this.dependencies;
    const at = now();
    return repository.transaction(async (executor) => {
      await repository.lockWallet(executor, input.userId);
      const posting = await ledger.post(executor, {
        businessReference: input.reference,
        businessType: 'wallet.grant',
        entries: [
          {
            account: { category: 'platform_issuance' },
            amount: input.coins,
            direction: 'debit',
          },
          {
            account: { category: 'consumer_balance', subjectId: input.userId },
            amount: input.coins,
            direction: 'credit',
          },
        ],
        occurredAt: at,
        reason: 'grant',
      } satisfies CoinPosting);
      if (posting.alreadyPosted) {
        return { alreadyCredited: true, kind: 'credited' } as const;
      }
      await ledger.lockBalance(executor, input.userId);
      await ledger.applyBalanceDelta(executor, {
        availableDelta: input.coins,
        reservedDelta: 0n,
        userId: input.userId,
      });
      return { alreadyCredited: false, kind: 'credited' } as const;
    });
  }

  /**
   * Takes back coins a reversed payment produced.
   *
   * The mirror of {@link creditPurchase} and deliberately not a second
   * mechanism: the same acquisition row identifies what is being reversed, and
   * the posting sends the issuance back the way it came.
   *
   * It can drive a balance negative, and it is allowed to — refusing would mean
   * somebody who spent charged-back coins keeps them. The database's
   * non-negativity constraint is on `available`, so this clamps the projection
   * at zero and records the whole reversal in the ledger, where the shortfall
   * stays visible as a position rather than being silently forgiven. What the
   * platform then does about a negative position is a commercial decision
   * nobody has made, and it is recorded as one.
   */
  async reversePurchase(input: {
    readonly channel: string;
    readonly purchaseReference: string;
  }): Promise<boolean> {
    if (!this.dependencies.enabled) return false;
    const { ledger, now, repository } = this.dependencies;
    const at = now();
    return repository.transaction(async (executor) => {
      const acquisition = await repository.findAcquisition(executor, {
        channel: input.channel,
        purchaseReference: input.purchaseReference,
      });
      if (acquisition === undefined) return false;
      await repository.lockWallet(executor, acquisition.userId);

      const posting = await ledger.post(executor, {
        businessReference: `${input.channel}:${input.purchaseReference}`,
        businessType: 'wallet.acquisition.reverse',
        entries: [
          {
            account: {
              category: 'consumer_balance',
              subjectId: acquisition.userId,
            },
            amount: acquisition.coins,
            direction: 'debit',
          },
          {
            account: { category: 'platform_issuance' },
            amount: acquisition.coins,
            direction: 'credit',
          },
        ],
        occurredAt: at,
        reason: 'purchase_reversed',
      } satisfies CoinPosting);
      if (posting.alreadyPosted) return false;

      const balance = await ledger.lockBalance(executor, acquisition.userId);
      const removable =
        balance.available < acquisition.coins
          ? balance.available
          : acquisition.coins;
      await ledger.applyBalanceDelta(executor, {
        availableDelta: -removable,
        reservedDelta: 0n,
        userId: acquisition.userId,
      });
      return true;
    });
  }

  /** The one place a reservation goes back, whichever way the window closed. */
  private async release(
    executor: TransactionHandle,
    held: LivePreferenceEntitlementRow,
    state: 'cancelled' | 'released',
  ): Promise<boolean> {
    const { ledger, now } = this.dependencies;
    const at = now();
    const posting = await ledger.post(executor, {
      businessReference: held.id,
      businessType: 'wallet.live_preference.release',
      entries: [
        {
          account: { category: 'consumer_reserved', subjectId: held.userId },
          amount: held.coins,
          direction: 'debit',
        },
        {
          account: { category: 'consumer_balance', subjectId: held.userId },
          amount: held.coins,
          direction: 'credit',
        },
      ],
      occurredAt: at,
      reason: 'release',
    } satisfies CoinPosting);

    const settled = await this.dependencies.repository.settleEntitlement(
      executor,
      {
        id: held.id,
        now: at,
        settlementTransactionId: posting.transactionId,
        state,
      },
    );
    if (settled === undefined) return false;

    await ledger.lockBalance(executor, held.userId);
    await ledger.applyBalanceDelta(executor, {
      availableDelta: held.coins,
      reservedDelta: -held.coins,
      userId: held.userId,
    });
    return true;
  }
}

/**
 * A uniqueness constraint refused inside a transaction that has already posted.
 *
 * Thrown rather than returned so the transaction rolls back: the posting and
 * the row it belongs to have to exist together or not at all, and returning a
 * refusal would commit one without the other.
 */
class WalletConflict extends Error {
  constructor() {
    super('A wallet operation lost a uniqueness race');
    this.name = 'WalletConflict';
  }
}
