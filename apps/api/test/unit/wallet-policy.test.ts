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
import {
  coinPackCoins,
  coinPackIdentifiers,
} from '../../src/wallet/catalogue.js';
import { CoinLedger, CoinLedgerError } from '../../src/wallet/ledger.js';
import {
  livePreferenceEntitlementCoins,
  livePreferenceEntitlementDurationMilliseconds,
  livePreferenceSweepIntervalMilliseconds,
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
  it('publishes one price, one duration, and one supported attribute', () => {
    expect(Number(livePreferenceEntitlementCoins)).toBeGreaterThan(0);
    expect(livePreferenceEntitlementDurationMilliseconds).toBeGreaterThan(0);
    // The sweep that returns an unspent reservation runs far more often than
    // the window it settles, so coins are never held long after they stop
    // being useful.
    expect(livePreferenceSweepIntervalMilliseconds).toBeLessThan(
      livePreferenceEntitlementDurationMilliseconds,
    );
    // One supported premium attribute, and it is a declared profile field.
    // A gender preference has no column anywhere in USERS and is an owner
    // decision rather than an implementation gap; this list is what makes that
    // checkable rather than asserted in prose.
    expect([...livePremiumPreferenceKinds]).toEqual(['region']);
  });

  it('accepts only a declared two-letter region, and nothing sensitive', () => {
    expect(
      activateLivePreferenceRequestSchema.safeParse({ region: 'ES' }).success,
    ).toBe(true);
    expect(
      activateLivePreferenceRequestSchema.safeParse({ region: 'es' }).success,
    ).toBe(false);
    // The shape cannot express any of these, which is the point: a contract
    // that could hold one is a contract somebody eventually fills in.
    for (const smuggled of [
      { gender: 'women', region: 'ES' },
      { age: 25, region: 'ES' },
      { region: 'ES', regions: ['ES', 'FR'] },
    ]) {
      expect(
        activateLivePreferenceRequestSchema.safeParse(smuggled).success,
      ).toBe(false);
    }
    expect(new RegExp(regionCodePattern, 'u').test('ES')).toBe(true);
    expect(new RegExp(regionCodePattern, 'u').test('ESP')).toBe(false);
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
      livePreferenceOffer: { coins: '25', durationSeconds: 900 },
    });
    expect(parsed.success).toBe(true);
    // No count of matching people, no estimated wait, no probability: none of
    // those is a number this platform has, so none is expressible.
    expect(
      walletStateResponseSchema.safeParse({
        acquisition: { android: 'unavailable', web: 'unavailable' },
        enabled: true,
        livePreferenceOffer: { coins: '25', durationSeconds: 900 },
        matchingNow: 12,
      }).success,
    ).toBe(false);
  });

  it('has a refusal that says only that the balance will not cover it', () => {
    expect(productErrorCodes.insufficientFunds).toBe('INSUFFICIENT_FUNDS');
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
