import { randomUUID } from 'node:crypto';

import type { WalletActivityKind } from '@velora/validation';

import type { Executor, TransactionHandle } from '../database/executor.js';
import type { CoinBalance, CoinLedger, CoinPosting } from './ledger.js';
import {
  livePreferenceActivationCoins,
  livePreferenceEntitlementDurationMilliseconds,
  livePreferenceSweepBatchSize,
  livePremiumGenderValues,
  livePremiumPreferenceKinds,
  languageCodePattern,
  maximumLivePreferenceActivationsPerWindow,
  maximumWalletOperationCoins,
  regionCodePattern,
  walletAbuseWindowMilliseconds,
  type LivePremiumGenderValue,
  type LivePremiumPreferenceKind,
} from './policy.js';
import type { WalletTransactionReason } from './policy.js';
import type {
  LivePreferenceEntitlementRow,
  WalletRepository,
} from './repository.js';

/**
 * One selection of premium preferences, as everything here passes it around.
 *
 * A record of optional values rather than a list of kind/value pairs, because
 * every consumer of it asks "what is the gender narrowing" rather than "iterate
 * the narrowings" — and because a list can hold the same kind twice, which is a
 * state nothing downstream has an answer for.
 */
export interface LivePreferenceSelection {
  readonly gender?: LivePremiumGenderValue | undefined;
  readonly language?: string | undefined;
  readonly region?: string | undefined;
}

/**
 * What the matcher needs to know about somebody's paid narrowing, and nothing
 * else.
 *
 * Deliberately not the entitlement row. LIVE has no business knowing what
 * anything cost, when it was reserved, or which ledger transaction holds the
 * coins — it needs the predicates and the identity of the window that bought
 * them, so it can ask for that window to be captured when it produces an
 * encounter.
 *
 * `charged` is here so the matcher can skip a capture it knows will be refused.
 * It is not a permission and grants nothing: a window that has been charged
 * narrows exactly as one that has not.
 */
export interface ActiveLivePreference extends LivePreferenceSelection {
  readonly charged: boolean;
  readonly entitlementId: string;
  readonly expiresAt: Date;
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
 * One line of somebody's own coin history, in the product's own words.
 *
 * Deliberately not a ledger row and deliberately not the repository's row
 * either: it carries a product reason, an instant, a magnitude, and the window
 * a line belongs to. There is no account, no direction, and no transaction
 * identifier anywhere in it.
 */
export interface WalletActivityEntry {
  readonly coins: bigint;
  readonly id: string;
  readonly kind: WalletActivityKind;
  readonly occurredAt: Date;
  readonly preference: LivePreferenceSelection | undefined;
}

/**
 * What one sweep cycle did. Counts only, on the same rule the RTC reconciler
 * follows: naming the people would put somebody's spending in a log line.
 *
 * `released` and `closed` are separate because they are different facts about
 * the product. A release returned coins to somebody who found nobody; a close
 * ended a window that had already been paid for and used. One number covering
 * both would make "how often does a paid window find nobody" unanswerable.
 */
export interface WalletSweepReport {
  readonly closed: number;
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
  /**
   * USERS' answer to "what does this person say they speak".
   *
   * The narrowest possible read, and it is about the *buyer* rather than about
   * anybody else. A language preference means "the other person must also speak
   * this", so asking for one the buyer does not speak is meaningless — and
   * selling it would be selling a filter that the matcher would then have to
   * either honour into an empty pool or silently drop. Refusing at activation
   * is the only version where nobody is charged for either.
   *
   * Absent in a composition with no USERS to ask, in which case a language
   * preference is refused rather than sold unverified.
   */
  readonly profiles?: WalletProfilePort;
  readonly repository: WalletRepository;
}

/** The slice of USERS this domain is allowed to use, and the whole of it. */
export interface WalletProfilePort {
  languagesOf(userId: string): Promise<readonly string[]>;
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
    const row = await this.dependencies.repository.findOpenEntitlement(
      executor,
      userId,
    );
    return this.inForce(row);
  }

  /**
   * What happened to this person's coins, newest first.
   *
   * The reasons are translated here rather than at the boundary, because the
   * ledger's vocabulary and the product's are two different things that
   * currently mostly coincide — `capture` is a posting and `spend` is what
   * somebody reads — and the day they stop coinciding, the translation should
   * already exist rather than be invented in a route.
   *
   * One extra row is asked for beyond the page, which is how the answer knows
   * whether there is another page without counting a history that grows for as
   * long as an account is active.
   */
  async activity(input: {
    readonly before?: number | undefined;
    readonly limit: number;
    readonly userId: string;
  }): Promise<
    | {
        readonly entries: readonly WalletActivityEntry[];
        readonly nextBefore: number | undefined;
      }
    | undefined
  > {
    if (!this.dependencies.enabled) return undefined;
    const rows = await this.dependencies.repository.listActivity(
      this.dependencies.repository.transactionless,
      {
        before: input.before,
        limit: input.limit + 1,
        userId: input.userId,
      },
    );
    const page = rows.slice(0, input.limit);
    return {
      entries: page.map((row) => ({
        coins: row.coins,
        id: row.id,
        kind: activityKindOf(row.reason),
        occurredAt: row.occurredAt,
        // Present only on the lines that belong to a window, and built from
        // the columns rather than cast: the stored values passed the database's
        // own vocabulary check, and this is the type system catching up with
        // that rather than a second rule.
        preference:
          row.gender === null && row.language === null && row.region === null
            ? undefined
            : {
                gender: livePremiumGenderValues.find(
                  (value) => value === row.gender,
                ),
                language: row.language ?? undefined,
                region: row.region ?? undefined,
              },
      })),
      nextBefore: rows.length > input.limit ? page.at(-1)?.sequence : undefined,
    };
  }

  /**
   * The windows held by any of these people, keyed by person.
   *
   * The matcher asks this about the candidates it is already considering, and
   * about nobody else. It is what makes a paid narrowing hold *from both
   * sides*: without it, somebody who bought "only women" would still be handed
   * a man the moment his own search picked them, and the thing they paid for
   * would be a filter that worked in one direction.
   *
   * It carries no price, because LIVE has no business knowing what anything
   * cost, and it is a read over a list the caller chose — never a way to find
   * out who is paying for what.
   */
  async activeLivePreferencesAmong(
    executor: Executor,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ActiveLivePreference>> {
    const held = new Map<string, ActiveLivePreference>();
    if (!this.dependencies.enabled || userIds.length === 0) return held;
    const rows = await this.dependencies.repository.findOpenEntitlementsAmong(
      executor,
      userIds,
    );
    for (const row of rows) {
      const window = this.inForce(row);
      if (window !== undefined) held.set(row.userId, window);
    }
    return held;
  }

  /**
   * The same window, with what it cost, for a surface that renders it.
   *
   * Separate from {@link activeLivePreference} because the two have different
   * audiences and must carry different things. The matcher gets the predicates
   * and the identity, and no price — LIVE has no business knowing what anything
   * cost. A wallet surface gets the price, because that is what it is for.
   */
  async activeLivePreferenceFor(
    userId: string,
  ): Promise<(ActiveLivePreference & { readonly coins: bigint }) | undefined> {
    if (!this.dependencies.enabled) return undefined;
    const executor = this.dependencies.repository.transactionless;
    const row = await this.dependencies.repository.findOpenEntitlement(
      executor,
      userId,
    );
    const held = this.inForce(row);
    if (held === undefined || row === undefined) return undefined;
    return { ...held, coins: row.coins };
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
  async activateLivePreference(
    input: LivePreferenceSelection & { readonly userId: string },
  ): Promise<ActivateLivePreferenceOutcome> {
    if (!this.dependencies.enabled) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    // Everything about the request that can be refused without reading a
    // balance is refused first, so an unsupported preference can never become a
    // charge. Each of these is checked against a declared shape or a declared
    // list rather than against an inventory of real values: whether anybody in
    // France is online right now is not a question this product answers, and
    // refusing an activation because the pool happens to be empty would be
    // selling on availability nobody can promise.
    const selection = await this.supportedSelection(input);
    if (selection === undefined) {
      return { kind: 'refused', reason: 'not_supported' };
    }
    const coins = livePreferenceActivationCoins(selection);
    if (coins === undefined) {
      // A window that narrows nothing. `Everyone` is free and is what somebody
      // gets by not buying anything, so there is nothing here to sell.
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

        const held = await repository.lockOpenEntitlement(
          executor,
          input.userId,
        );
        // A window that is still running, charged or not. A caller who already
        // has one is told so rather than being charged again, and the surface
        // renders the window it already holds. An expired row that the sweep
        // has not reached yet is not a window: settling it here rather than
        // refusing is what stops a person being blocked from buying by a worker
        // that is a few seconds behind.
        if (held !== undefined) {
          if (held.expiresAt.getTime() > at.getTime()) {
            return { kind: 'refused', reason: 'conflict' } as const;
          }
          await this.close(executor, held, 'released');
        }

        const balance = await ledger.lockBalance(executor, input.userId);
        if (balance.available < coins) {
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
              amount: coins,
              direction: 'debit',
            },
            {
              account: {
                category: 'consumer_reserved',
                subjectId: input.userId,
              },
              amount: coins,
              direction: 'credit',
            },
          ],
          occurredAt: at,
          reason: 'reservation',
        } satisfies CoinPosting);

        await ledger.applyBalanceDelta(executor, {
          availableDelta: -coins,
          reservedDelta: coins,
          userId: input.userId,
        });

        const entitlement = await repository.insertEntitlement(executor, {
          coins,
          expiresAt: new Date(
            at.getTime() + livePreferenceEntitlementDurationMilliseconds,
          ),
          id: entitlementId,
          now: at,
          preferenceGender: selection.gender,
          preferenceLanguage: selection.language,
          preferenceRegion: selection.region,
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
   * Idempotent by the guarded update, and charged **once per window** rather
   * than once per match. The second and every later encounter inside the same
   * window finds the row already `captured`, changes nothing, and answers
   * `false` — which is what makes the window a window: after the charge the
   * narrowing keeps running and every further Next inside it is free.
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
    const held = await repository.lockOpenEntitlement(executor, input.userId);
    if (held?.id !== input.entitlementId) return false;
    // Already charged. The window is still narrowing and this encounter is one
    // of the ones it was bought for; there is simply nothing left to pay.
    if (held.state !== 'active') return false;

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
   * Closes an open window at the person's request.
   *
   * **A window that never found anybody returns its coins in full.** Somebody
   * who decides they would rather meet anybody has not consumed what they
   * bought, and charging them for changing their mind inside the window would
   * make the control something people avoid touching — which would be worse for
   * them than the coins.
   *
   * **A window that already found somebody returns nothing, and it does not
   * pretend to.** The charge happened when the narrowing produced the encounter
   * it was bought for; ending the window early gives up the rest of the time,
   * which is a choice, not a refund. The surface says so before the button is
   * pressed rather than afterwards.
   */
  async cancelLivePreference(userId: string): Promise<boolean> {
    if (!this.dependencies.enabled) return false;
    return this.dependencies.repository.transaction(async (executor) => {
      await this.dependencies.repository.lockWallet(executor, userId);
      const held = await this.dependencies.repository.lockOpenEntitlement(
        executor,
        userId,
      );
      if (held === undefined) return false;
      return this.close(executor, held, 'cancelled');
    });
  }

  /**
   * Widens a window that is already running, at no charge and with no refund.
   *
   * The one preference change that can be made inside a window somebody already
   * paid for, and it is allowed precisely because it can only ever ask for
   * *less*. Dropping "in France" from "women in France who speak French" makes
   * the search bigger; there is no version of that which costs more, so there is
   * no version of it that could produce a surprise charge.
   *
   * Everything else is a different window and is sold as one. Adding a
   * preference, or swapping one for another, could cost more than what was paid
   * and would silently redefine what was bought — so it is refused here and the
   * surface offers the honest alternative: end this window and open the one you
   * actually want. Ending an uncharged window returns the coins in full, so
   * changing your mind before anybody is found costs nothing either way.
   *
   * Dropping *everything* is not a broadening, it is going back to `Everyone`,
   * and it is refused here so it goes through cancellation — which is the path
   * that knows whether coins are owed back.
   */
  async broadenLivePreference(
    input: LivePreferenceSelection & { readonly userId: string },
  ): Promise<
    | {
        readonly entitlement: LivePreferenceEntitlementRow;
        readonly kind: 'broadened';
      }
    | { readonly kind: 'refused'; readonly reason: WalletRefusal }
  > {
    if (!this.dependencies.enabled) {
      return { kind: 'refused', reason: 'unavailable' };
    }
    const { now, repository } = this.dependencies;
    const at = now();
    return repository.transaction(async (executor) => {
      await repository.lockWallet(executor, input.userId);
      const held = await repository.lockOpenEntitlement(executor, input.userId);
      if (held === undefined || held.expiresAt.getTime() <= at.getTime()) {
        return { kind: 'refused', reason: 'conflict' } as const;
      }

      const wanted = {
        gender: input.gender,
        language: input.language,
        region: input.region,
      };
      const current = selectionOf(held);
      // A strict subset, kind by kind: every preference the request keeps must
      // be the *same value* the window already holds, and at least one must be
      // gone. Comparing values rather than counting kinds is what stops
      // "France" being swapped for "Japan" at no charge.
      let dropped = 0;
      for (const kind of livePremiumPreferenceKinds) {
        if (wanted[kind] === undefined && current[kind] !== undefined) {
          dropped += 1;
          continue;
        }
        if (wanted[kind] !== current[kind]) {
          return { kind: 'refused', reason: 'not_supported' } as const;
        }
      }
      if (dropped === 0) return { kind: 'refused', reason: 'not_supported' };
      if (livePreferenceActivationCoins(wanted) === undefined) {
        // Nothing left to narrow on. That is `Everyone`, and it is cancellation.
        return { kind: 'refused', reason: 'not_supported' } as const;
      }

      const broadened = await repository.broadenEntitlement(executor, {
        id: held.id,
        now: at,
        preferenceGender: wanted.gender,
        preferenceLanguage: wanted.language,
        preferenceRegion: wanted.region,
      });
      if (broadened === undefined) {
        return { kind: 'refused', reason: 'conflict' } as const;
      }
      return { entitlement: broadened, kind: 'broadened' } as const;
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
    if (!this.dependencies.enabled) {
      return { closed: 0, examined: 0, released: 0 };
    }
    const { now, repository } = this.dependencies;
    const due = await repository.findExpiredEntitlements(
      repository.transactionless,
      { limit, now: now() },
    );
    let closed = 0;
    let released = 0;
    for (const row of due) {
      const settled = await repository.transaction(async (executor) => {
        await repository.lockWallet(executor, row.userId);
        const held = await repository.lockOpenEntitlement(executor, row.userId);
        // Another worker, or the person themselves, settled it between the read
        // and the lock. The guarded update would refuse anyway; this refuses
        // before writing a posting that would then belong to nothing.
        if (held?.id !== row.id) return undefined;
        // Which of the two closures this is depends on the state under the
        // lock, never on what the unlocked read said. A window that was charged
        // in the microseconds between them is closed rather than released,
        // which is the whole of "a captured reservation can never later
        // release".
        const state = held.state === 'active' ? 'released' : 'expired';
        return (await this.close(executor, held, state)) ? state : undefined;
      });
      if (settled === 'released') released += 1;
      if (settled === 'expired') closed += 1;
    }
    return { closed, examined: due.length, released };
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

  /**
   * The one place a window closes, whichever way it closed.
   *
   * Two paths, and which one runs is decided by the state under the lock rather
   * than by the caller's intention. A window still holding coins gives them back
   * in full and lands in the terminal state the caller asked for. A window that
   * was already charged has nothing to give back and simply stops narrowing.
   *
   * Writing it as one method is what makes the two impossible-by-construction
   * mistakes impossible: a caller cannot release a charged window because this
   * never posts for one, and a caller cannot silently keep somebody's coins by
   * closing an uncharged window, because this always posts for one.
   */
  private async close(
    executor: TransactionHandle,
    held: LivePreferenceEntitlementRow,
    state: 'cancelled' | 'expired' | 'released',
  ): Promise<boolean> {
    const { ledger, now, repository } = this.dependencies;
    const at = now();
    if (held.state !== 'active') {
      // Already charged. Nothing moves; the window just ends. The state is
      // forced to `expired` whatever the caller asked for, because "the person
      // cancelled a window they had already paid for and used" and "its time
      // ran out" are the same financial event and `cancelled` is reserved for
      // the one that returns coins.
      return (
        (await repository.expireCapturedEntitlement(executor, {
          id: held.id,
          now: at,
        })) !== undefined
      );
    }
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

    const settled = await repository.settleEntitlement(executor, {
      id: held.id,
      now: at,
      settlementTransactionId: posting.transactionId,
      // `expired` never reaches here: it is what a *charged* window becomes,
      // and a charged window returned above. Narrowing it out is the type
      // system restating the branch rather than a second rule.
      state: state === 'expired' ? 'released' : state,
    });
    if (settled === undefined) return false;

    await ledger.lockBalance(executor, held.userId);
    await ledger.applyBalanceDelta(executor, {
      availableDelta: held.coins,
      reservedDelta: -held.coins,
      userId: held.userId,
    });
    return true;
  }

  /**
   * The window in force, or nothing, with the expiry evaluated on read.
   *
   * The expiry is checked here rather than trusted to the sweep, and that is not
   * belt-and-braces: a sweep that is fifteen seconds behind would otherwise
   * mean a narrowing outliving the window somebody bought, which is a person
   * being filtered by a preference they are no longer paying for.
   */
  private inForce(
    row: LivePreferenceEntitlementRow | undefined,
  ): ActiveLivePreference | undefined {
    if (row === undefined) return undefined;
    if (row.expiresAt.getTime() <= this.dependencies.now().getTime()) {
      return undefined;
    }
    const selection = selectionOf(row);
    // The database guarantees a window narrows something. This is the type
    // system catching up with that constraint rather than a second rule.
    if (livePreferenceActivationCoins(selection) === undefined)
      return undefined;
    return {
      charged: row.state !== 'active',
      entitlementId: row.id,
      expiresAt: row.expiresAt,
      ...selection,
    };
  }

  /**
   * The requested selection, or nothing if any part of it is unsupported.
   *
   * Every arm refuses rather than dropping. A preference silently ignored is
   * the failure that makes a paid control worthless — somebody pays for
   * "women who speak French", gets a filter that only applied half of it, and
   * has no way to find out.
   */
  private async supportedSelection(
    input: LivePreferenceSelection & { readonly userId: string },
  ): Promise<LivePreferenceSelection | undefined> {
    if (
      input.gender !== undefined &&
      !livePremiumGenderValues.includes(input.gender)
    ) {
      return undefined;
    }
    if (
      input.region !== undefined &&
      !new RegExp(regionCodePattern, 'u').test(input.region)
    ) {
      return undefined;
    }
    if (input.language !== undefined) {
      if (!new RegExp(languageCodePattern, 'u').test(input.language)) {
        return undefined;
      }
      // Asking for people who speak a language you do not speak is a search
      // that means nothing, and selling it would be selling a filter the
      // matcher would have to either honour into an empty pool or quietly drop.
      // With no USERS to ask, it is refused rather than sold unverified.
      const spoken = await this.dependencies.profiles?.languagesOf(
        input.userId,
      );
      if (spoken?.includes(input.language) !== true) return undefined;
    }
    return {
      gender: input.gender,
      language: input.language,
      region: input.region,
    };
  }
}

/**
 * The ledger's reason, in the words a person reads.
 *
 * A translation rather than a pass-through, and the one entry that differs is
 * the point: `capture` is a posting that moves coins out of a reserved
 * position, and `spend` is what happened as far as the person who bought
 * something is concerned. Publishing the posting's name would make the product
 * describe itself in the book's vocabulary, and would make renaming a posting a
 * change to what a person is shown.
 */
function activityKindOf(reason: WalletTransactionReason): WalletActivityKind {
  if (reason === 'capture') return 'spend';
  return reason;
}

/** One stored window's preferences, in the shape everything else speaks. */
function selectionOf(row: LivePreferenceEntitlementRow): Record<
  LivePremiumPreferenceKind,
  string | undefined
> & {
  readonly gender: LivePremiumGenderValue | undefined;
} {
  return {
    gender: row.preferenceGender ?? undefined,
    language: row.preferenceLanguage ?? undefined,
    region: row.preferenceRegion ?? undefined,
  };
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
