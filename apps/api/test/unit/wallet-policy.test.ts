import { describe, expect, it } from 'bun:test';

import {
  enabledCoinLedger,
  loadServerConfig,
  localTestCoinAcquisition,
  redactServerConfig,
  unavailableCoinAcquisition,
  unavailableCoinLedger,
} from '@velora/config/server';
import {
  activateLivePreferenceRequestSchema,
  androidCoinPurchaseRequestSchema,
  coinAmountSchema,
  coinGrantRequestSchema,
  matchableGenderValues,
  productErrorCodes,
  walletStateResponseSchema,
} from '@velora/validation';

import {
  LocalTestCoinAcquisition,
  UnavailableCoinAcquisition,
  localTestCoinProduct,
  localTestCoinProductCoins,
  type CoinAcquisitionPort,
} from '../../src/wallet/acquisition.js';
import * as usersPolicy from '../../src/users/profile-policy.js';
import {
  coinPackCoins,
  coinPackIdentifiers,
} from '../../src/wallet/catalogue.js';
import { CoinLedger, CoinLedgerError } from '../../src/wallet/ledger.js';
import {
  languageCodePattern,
  livePreferenceActivationCoins,
  livePreferenceEntitlementDurationMilliseconds,
  livePreferenceEntitlementOpenStates,
  livePreferenceEntitlementReservedState,
  livePreferenceEntitlementStates,
  livePreferenceSweepIntervalMilliseconds,
  livePremiumGenderValues,
  livePremiumPreferenceCatalogue,
  livePremiumPreferenceKinds,
  maximumWalletOperationCoins,
  regionCodePattern,
  walletAccountCategories,
} from '../../src/wallet/policy.js';

const baseEnvironment = {
  AUTH_BROWSER_ORIGINS_CONSUMER_WEB: 'http://127.0.0.1:3000',
  AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: 'http://127.0.0.1:3001',
  AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: 'http://127.0.0.1:3002',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:1/velora',
  EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:1/0',
  QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
};

function refusal(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function asyncRefusal(run: () => unknown): Promise<string> {
  try {
    await run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('coins are an entitlement unit and never money', () => {
  it('carries whole counts on the wire, never a JSON number', () => {
    expect(coinAmountSchema.safeParse('0').success).toBe(true);
    expect(coinAmountSchema.safeParse('100').success).toBe(true);
    // A fractional coin, a negative one, and a leading zero are all shapes that
    // would mean something this product does not have.
    expect(coinAmountSchema.safeParse('1.5').success).toBe(false);
    expect(coinAmountSchema.safeParse('-1').success).toBe(false);
    expect(coinAmountSchema.safeParse('007').success).toBe(false);
    // The only currency-shaped thing about a coin is that it is not one.
    expect(coinAmountSchema.safeParse('GBP').success).toBe(false);
  });

  it('keeps four positions and no more', () => {
    expect([...walletAccountCategories]).toEqual([
      'consumer_balance',
      'consumer_reserved',
      'platform_issuance',
      'platform_revenue',
    ]);
  });
});

describe('the ledger refuses a posting that could not mean anything', () => {
  const ledger = new CoinLedger(() => new Date('2026-09-01T10:00:00.000Z'));
  const executor = {} as never;

  it('refuses an unbalanced posting before it reaches the database', async () => {
    const message = await asyncRefusal(() =>
      ledger.post(executor, {
        businessReference: 'x',
        businessType: 'wallet.grant',
        entries: [
          {
            account: { category: 'platform_issuance' },
            amount: 10n,
            direction: 'debit',
          },
          {
            account: { category: 'consumer_balance', subjectId: 'u' },
            amount: 9n,
            direction: 'credit',
          },
        ],
        occurredAt: new Date(),
        reason: 'grant',
      }),
    );
    expect(message).toContain('must balance');
  });

  it('refuses a negative or zero entry, because direction carries the sign', async () => {
    for (const amount of [0n, -5n]) {
      const message = await asyncRefusal(() =>
        ledger.post(executor, {
          businessReference: 'x',
          businessType: 'wallet.grant',
          entries: [
            {
              account: { category: 'platform_issuance' },
              amount,
              direction: 'debit',
            },
            {
              account: { category: 'consumer_balance', subjectId: 'u' },
              amount,
              direction: 'credit',
            },
          ],
          occurredAt: new Date(),
          reason: 'grant',
        }),
      );
      expect(message).toContain('strictly positive');
    }
  });

  it('refuses an amount larger than one operation may move', async () => {
    const message = await asyncRefusal(() =>
      ledger.post(executor, {
        businessReference: 'x',
        businessType: 'wallet.grant',
        entries: [
          {
            account: { category: 'platform_issuance' },
            amount: maximumWalletOperationCoins + 1n,
            direction: 'debit',
          },
          {
            account: { category: 'consumer_balance', subjectId: 'u' },
            amount: maximumWalletOperationCoins + 1n,
            direction: 'credit',
          },
        ],
        occurredAt: new Date(),
        reason: 'grant',
      }),
    );
    expect(message).toContain('exceeds what one operation may move');
  });

  it('refuses a consumer position with no subject, and a platform one with one', async () => {
    expect(
      await asyncRefusal(() =>
        ledger.post(executor, {
          businessReference: 'x',
          businessType: 'wallet.grant',
          entries: [
            {
              account: { category: 'platform_issuance' },
              amount: 1n,
              direction: 'debit',
            },
            {
              account: { category: 'consumer_balance' },
              amount: 1n,
              direction: 'credit',
            },
          ],
          occurredAt: new Date(),
          reason: 'grant',
        }),
      ),
    ).toContain('must name a consumer');
    expect(
      await asyncRefusal(() =>
        ledger.post(executor, {
          businessReference: 'x',
          businessType: 'wallet.grant',
          entries: [
            {
              account: { category: 'platform_issuance', subjectId: 'u' },
              amount: 1n,
              direction: 'debit',
            },
            {
              account: { category: 'consumer_balance', subjectId: 'u' },
              amount: 1n,
              direction: 'credit',
            },
          ],
          occurredAt: new Date(),
          reason: 'grant',
        }),
      ),
    ).toContain('must not name a subject');
  });

  it('refuses a single-entry posting, which would balance vacuously', async () => {
    const message = await asyncRefusal(() =>
      ledger.post(executor, {
        businessReference: 'x',
        businessType: 'wallet.grant',
        entries: [],
        occurredAt: new Date(),
        reason: 'grant',
      }),
    );
    expect(message).toContain('at least two entries');
    expect(new CoinLedgerError('x').name).toBe('CoinLedgerError');
  });
});

describe('what a paid preference costs is a server constant', () => {
  it('prices every supported preference, and every one is a declared field', () => {
    expect(livePreferenceEntitlementDurationMilliseconds).toBeGreaterThan(0);
    // The sweep that returns an unspent reservation runs far more often than
    // the window it settles, so coins are never held long after they stop
    // being useful.
    expect(livePreferenceSweepIntervalMilliseconds).toBeLessThan(
      livePreferenceEntitlementDurationMilliseconds,
    );
    // Three, and each is something a person set about themselves. Nothing here
    // is computed, and the list is what makes that checkable rather than
    // asserted in prose.
    expect([...livePremiumPreferenceKinds]).toEqual([
      'gender',
      'region',
      'language',
    ]);
    // Every published kind has a price. A kind the catalogue does not price
    // would be a control a surface could render and the server could not sell.
    for (const kind of livePremiumPreferenceKinds) {
      expect(
        Number(livePremiumPreferenceCatalogue[kind].coins),
      ).toBeGreaterThan(0);
    }
  });

  it('charges a selection as the sum of what is in it, and nothing for nothing', () => {
    const gender = livePremiumPreferenceCatalogue.gender.coins;
    const region = livePremiumPreferenceCatalogue.region.coins;
    const language = livePremiumPreferenceCatalogue.language.coins;
    expect(livePreferenceActivationCoins({ gender: 'woman' })).toBe(gender);
    expect(
      livePreferenceActivationCoins({ gender: 'woman', region: 'FR' }),
    ).toBe(gender + region);
    expect(
      livePreferenceActivationCoins({
        gender: 'woman',
        language: 'fr',
        region: 'FR',
      }),
    ).toBe(gender + region + language);
    // `Everyone` is free, so a window that narrows nothing is not a thing this
    // product can sell — and the price of one is not zero, it is absent.
    expect(livePreferenceActivationCoins({})).toBeUndefined();
  });

  it('accepts only declared preferences, and nothing sensitive', () => {
    for (const supported of [
      { region: 'ES' },
      { gender: 'woman' },
      { language: 'fr' },
      { gender: 'non_binary', language: 'fr', region: 'FR' },
    ]) {
      expect(
        activateLivePreferenceRequestSchema.safeParse(supported).success,
      ).toBe(true);
    }
    // The shape cannot express any of these, which is the point: a contract
    // that could hold one is a contract somebody eventually fills in.
    for (const smuggled of [
      // An empty selection would be somebody charged for `Everyone`, which is
      // free.
      {},
      { region: 'es' },
      { gender: 'women' },
      // Declining to say is not a category anybody may filter for. Its absence
      // from this enum is what stops "prefer not to say" becoming an answer
      // with consequences.
      { gender: 'undisclosed' },
      { age: 25, region: 'ES' },
      { region: 'ES', regions: ['ES', 'FR'] },
      { orientation: 'straight' },
      { nearestTo: 'ES' },
    ]) {
      expect(
        activateLivePreferenceRequestSchema.safeParse(smuggled).success,
      ).toBe(false);
    }
    expect(new RegExp(regionCodePattern, 'u').test('ES')).toBe(true);
    expect(new RegExp(regionCodePattern, 'u').test('ESP')).toBe(false);
    expect(new RegExp(languageCodePattern, 'u').test('fr')).toBe(true);
    expect(new RegExp(languageCodePattern, 'u').test('FR')).toBe(false);
  });

  it('keeps a charged window open and tells released and expired apart', () => {
    // Both open states, because a charged window is still a window: the
    // narrowing runs to expiry and every further match inside it is free.
    expect([...livePreferenceEntitlementOpenStates]).toEqual([
      'active',
      'captured',
    ]);
    // Only one of them still holds coins, which is what makes "charged once"
    // enforceable rather than conventional.
    expect(livePreferenceEntitlementReservedState).toBe('active');
    // `released` is a window nobody was charged for; `expired` is one somebody
    // paid for and used. Collapsing them would make "how often does a paid
    // window find nobody" unanswerable.
    expect([...livePreferenceEntitlementStates]).toEqual([
      'active',
      'captured',
      'expired',
      'released',
      'cancelled',
    ]);
  });

  it('gives a client no way to say what anything is worth', () => {
    // No coin amount on a purchase, because a request that could carry one
    // would be a request that mints currency.
    expect(
      androidCoinPurchaseRequestSchema.safeParse({
        coins: '10000',
        productReference: 'p',
        purchaseToken: 't',
      }).success,
    ).toBe(false);
    expect(
      androidCoinPurchaseRequestSchema.safeParse({
        productReference: 'p',
        purchaseToken: 't',
      }).success,
    ).toBe(true);
    // A grant does carry one — it is the development path and refused outside
    // local and test — and it still cannot carry a fractional or negative
    // amount.
    expect(
      coinGrantRequestSchema.safeParse({ coins: '-1', reference: 'abcdefgh' })
        .success,
    ).toBe(false);
  });

  it('publishes a balance and a price a surface can render without arithmetic', () => {
    const parsed = walletStateResponseSchema.safeParse({
      acquisition: { android: 'unavailable', web: 'unavailable' },
      balance: { available: '75', reserved: '25' },
      enabled: true,
      livePreferenceCatalogue: {
        durationSeconds: 900,
        preferences: [{ coins: '25', kind: 'gender' }],
      },
    });
    expect(parsed.success).toBe(true);
    // No count of matching people, no estimated wait, no probability: none of
    // those is a number this platform has, so none is expressible.
    expect(
      walletStateResponseSchema.safeParse({
        acquisition: { android: 'unavailable', web: 'unavailable' },
        enabled: true,
        livePreferenceCatalogue: {
          durationSeconds: 900,
          preferences: [{ coins: '25', kind: 'gender' }],
        },
        matchingNow: 12,
      }).success,
    ).toBe(false);
  });

  it('has a refusal that says only that the balance will not cover it', () => {
    expect(productErrorCodes.insufficientFunds).toBe('INSUFFICIENT_FUNDS');
  });

  it('narrows to the same categories USERS collects, restated once', () => {
    // Three lists, one vocabulary. WALLET restates it because a schema module
    // cannot import the contract package; USERS restates it for the same
    // reason. A difference between any two of them would mean a preference
    // somebody could buy and nobody could satisfy — or, far worse, one that
    // silently matched the wrong people.
    expect([...livePremiumGenderValues]).toEqual([...matchableGenderValues]);
    expect([...livePremiumGenderValues]).toEqual([
      ...usersPolicy.matchableGenderValues,
    ]);
    // And every one of them is something a person can actually declare.
    for (const value of livePremiumGenderValues) {
      expect(usersPolicy.matchingGenderValues).toContain(value);
    }
  });
});

describe('a purchase is proved by a store, never by a client', () => {
  it('refuses every acquisition where no channel is configured', async () => {
    const channel: CoinAcquisitionPort = new UnavailableCoinAcquisition();
    expect(channel.channel).toBe('unavailable');
    expect(
      await asyncRefusal(() =>
        channel.verifyPurchase({
          productReference: 'p',
          purchaseToken: 't',
          userId: 'u',
        }),
      ),
    ).toContain('No coin acquisition channel is configured');
    expect(
      await asyncRefusal(() =>
        channel.acknowledgePurchase({
          productReference: 'p',
          purchaseToken: 't',
        }),
      ),
    ).toContain('No coin acquisition channel is configured');
  });

  it('derives the coin amount from the catalogue rather than from the request', async () => {
    const channel = new LocalTestCoinAcquisition();
    const verified = await channel.verifyPurchase({
      productReference: localTestCoinProduct,
      purchaseToken: 'local-test-purchase-abcdef01',
      userId: 'u',
    });
    expect(verified.coins).toBe(localTestCoinProductCoins);
    expect(verified.status).toBe('purchased');
    // A product this platform does not sell, and a token it did not shape, are
    // both refused — the two properties a real adapter must have.
    expect(
      await asyncRefusal(() =>
        channel.verifyPurchase({
          productReference: 'velora.coins.enormous',
          purchaseToken: 'local-test-purchase-abcdef01',
          userId: 'u',
        }),
      ),
    ).toContain('Unknown local-test coin product');
    expect(
      await asyncRefusal(() =>
        channel.verifyPurchase({
          productReference: localTestCoinProduct,
          purchaseToken: 'anything-i-like',
          userId: 'u',
        }),
      ),
    ).toContain('Malformed local-test purchase token');
  });

  it('keeps the web coin catalogue closed and derived from the pack, not a price', () => {
    expect(coinPackIdentifiers.length).toBeGreaterThan(0);
    for (const pack of coinPackIdentifiers) {
      expect((coinPackCoins(pack) ?? 0n) > 0n).toBe(true);
    }
    // A resource this domain does not sell produces nothing rather than a
    // default, so a commercial fact about somebody else's product credits
    // nobody.
    expect(coinPackCoins('some.club.uuid')).toBeUndefined();
  });
});

describe('configuration gates coins, and refuses them where they are undecided', () => {
  it('defaults to no ledger at all', () => {
    const config = loadServerConfig(baseEnvironment);
    expect(config.WALLET_COIN_LEDGER).toBe(unavailableCoinLedger);
    expect(config.WALLET_ANDROID_ACQUISITION).toBe(unavailableCoinAcquisition);
  });

  it('refuses an acquisition channel with no ledger behind it', () => {
    const message = refusal(() =>
      loadServerConfig({
        ...baseEnvironment,
        WALLET_ANDROID_ACQUISITION: localTestCoinAcquisition,
      }),
    );
    expect(message).toContain('WALLET_ANDROID_ACQUISITION');
    expect(message).toContain('WALLET_COIN_LEDGER');
  });

  it('refuses a ledger in staging and production', () => {
    for (const environment of ['staging', 'production'] as const) {
      const message = refusal(() =>
        loadServerConfig({
          ...baseEnvironment,
          APP_ENV: environment,
          WALLET_COIN_LEDGER: enabledCoinLedger,
        }),
      );
      expect(message).toContain('WALLET_COIN_LEDGER');
      expect(message).toContain('undecided');
    }
  });

  it('reports both gates in the redacted configuration', () => {
    const redacted = redactServerConfig(
      loadServerConfig({
        ...baseEnvironment,
        WALLET_ANDROID_ACQUISITION: localTestCoinAcquisition,
        WALLET_COIN_LEDGER: enabledCoinLedger,
      }),
    );
    expect(redacted.walletCoinLedger).toBe(enabledCoinLedger);
    expect(redacted.walletAndroidAcquisition).toBe(localTestCoinAcquisition);
  });
});
