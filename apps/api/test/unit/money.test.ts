import { describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  currencyCodePattern as contractCurrencyCodePattern,
  currencyMinorUnitExponent,
  currencyMinorUnitExponents,
  formatMinorUnits,
  minorUnitsSchema,
} from '@velora/validation';

import {
  billingJournalCategories,
  billingJournalPrefix,
  billingJournalReasons,
} from '../../src/billing/policy.js';
import { billingJournalTables } from '../../src/billing/schema.js';
import { journalCorrectionReason } from '../../src/money/journal-table.js';
import {
  JournalError,
  JournalStore,
  journalAccountId,
  type JournalPosting,
} from '../../src/money/journal.js';
import {
  addMoney,
  compareMoney,
  isZeroMoney,
  minorUnitsOf,
  money,
  moneyEquals,
  moneyFromMinorUnits,
  MoneyError,
  negateMoney,
  subtractMoney,
  sumMoney,
} from '../../src/money/money.js';
import {
  currencyCodePattern,
  maximumStorableMinorUnits,
  minimumStorableMinorUnits,
} from '../../src/money/policy.js';

/**
 * The money primitives, and the postings the journal refuses before it writes.
 *
 * Nothing here touches a database. What it proves is the layer above one: that
 * an amount cannot exist without a currency, that two currencies cannot be
 * combined by accident, and that a posting which could never be sound is
 * rejected with an error describing why rather than as a constraint violation
 * at commit. The database enforces all of it again — that is what
 * `test/integration/billing-journal.test.ts` is for — and the duplication is
 * deliberate: these checks exist for the message, those exist for the
 * guarantee.
 */

/**
 * A deterministic pseudo-random source.
 *
 * Property checks below run over generated amounts, and a failing case has to
 * be reproducible. `Math.random()` would make a failure a one-off nobody can
 * re-run, which is the opposite of what a property test is for.
 */
function sequence(seed: number): () => bigint {
  let state = BigInt(seed);
  return () => {
    state =
      (state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) &
      0xffff_ffff_ffff_ffffn;
    // Bounded well inside the storable range so sums in the properties below
    // cannot themselves overflow and mask the property being checked.
    return (state % 2_000_000_001n) - 1_000_000_000n;
  };
}

const posting = (overrides: Partial<JournalPosting> = {}): JournalPosting => ({
  businessReference: crypto.randomUUID(),
  businessType: 'billing.payment',
  entries: [
    {
      account: { category: 'provider_clearing', subjectType: 'platform' },
      amount: money(1_000n, 'USD'),
      direction: 'debit',
    },
    {
      account: { category: 'customer_settlement', subjectType: 'platform' },
      amount: money(1_000n, 'USD'),
      direction: 'credit',
    },
  ],
  occurredAt: new Date('2026-08-15T10:00:00.000Z'),
  reason: 'payment_captured',
  ...overrides,
});

/**
 * A store over a database that throws on any query.
 *
 * Every rejection below has to happen before a statement is prepared, so a
 * mock that cannot answer one is the assertion: if validation ever moved after
 * the first write, these tests would fail with a connection error rather than
 * quietly passing.
 */
function store(): JournalStore {
  return new JournalStore({
    prefix: billingJournalPrefix,
    tables: billingJournalTables,
  });
}

const unreachable = drizzle.mock();

describe('money', () => {
  it('restates the currency pattern the contract package publishes', () => {
    expect(currencyCodePattern).toBe(contractCurrencyCodePattern);
  });

  it('refuses an amount in a currency it holds no metadata for', () => {
    expect(() => money(100n, 'XYZ')).toThrow(MoneyError);
    expect(() => money(100n, 'usd')).toThrow(MoneyError);
    expect(() => currencyMinorUnitExponent('XYZ')).toThrow();
  });

  it('refuses an amount outside the storable range', () => {
    expect(() => money(maximumStorableMinorUnits, 'USD')).not.toThrow();
    expect(() => money(minimumStorableMinorUnits, 'USD')).not.toThrow();
    expect(() => money(maximumStorableMinorUnits + 1n, 'USD')).toThrow(
      MoneyError,
    );
    expect(() => money(minimumStorableMinorUnits - 1n, 'USD')).toThrow(
      MoneyError,
    );
  });

  it('overflows into a refusal rather than a wrapped amount', () => {
    const nearCeiling = money(maximumStorableMinorUnits - 1n, 'USD');
    expect(() => addMoney(nearCeiling, money(2n, 'USD'))).toThrow(MoneyError);
    const nearFloor = money(minimumStorableMinorUnits + 1n, 'USD');
    expect(() => subtractMoney(nearFloor, money(2n, 'USD'))).toThrow(
      MoneyError,
    );
  });

  it('never combines two currencies', () => {
    const dollars = money(100n, 'USD');
    const euros = money(100n, 'EUR');
    expect(() => addMoney(dollars, euros)).toThrow(MoneyError);
    expect(() => subtractMoney(dollars, euros)).toThrow(MoneyError);
    expect(() => compareMoney(dollars, euros)).toThrow(MoneyError);
    expect(moneyEquals(dollars, euros)).toBe(false);
    expect(() => sumMoney([dollars, euros], 'USD')).toThrow(MoneyError);
  });

  it('parses only the canonical minor-unit spelling', () => {
    expect(minorUnitsOf(moneyFromMinorUnits('-4200', 'USD'))).toBe('-4200');
    expect(minorUnitsOf(moneyFromMinorUnits('0', 'JPY'))).toBe('0');
    for (const malformed of ['007', '+1', '-0', '1.5', '', ' 1', '1e3']) {
      expect(() => moneyFromMinorUnits(malformed, 'USD')).toThrow(MoneyError);
      expect(minorUnitsSchema.safeParse(malformed).success).toBe(false);
    }
  });

  it('carries an amount larger than a double can hold, exactly', () => {
    // 2^53 + 1. A JSON number loses this; the string spelling does not.
    const exact = '9007199254740993';
    expect(minorUnitsOf(moneyFromMinorUnits(exact, 'USD'))).toBe(exact);
    expect(Number(exact).toString()).not.toBe(exact);
  });

  it('renders minor units against the currency exponent, not a guess', () => {
    expect(formatMinorUnits('123456', 'USD')).toBe('1234.56');
    expect(formatMinorUnits('123456', 'JPY')).toBe('123456');
    expect(formatMinorUnits('123456', 'KWD')).toBe('123.456');
    expect(formatMinorUnits('5', 'USD')).toBe('0.05');
    expect(formatMinorUnits('-5', 'USD')).toBe('-0.05');
    expect(formatMinorUnits('0', 'BHD')).toBe('0.000');
  });

  it('publishes exponents for currencies that are not two-decimal', () => {
    expect(currencyMinorUnitExponents.JPY).toBe(0);
    expect(currencyMinorUnitExponents.KWD).toBe(3);
    expect(currencyMinorUnitExponents.USD).toBe(2);
  });

  it('holds the arithmetic properties a ledger depends on', () => {
    const next = sequence(20_260_815);
    for (let index = 0; index < 500; index += 1) {
      const left = money(next(), 'USD');
      const right = money(next(), 'USD');
      // Addition is commutative and subtraction inverts it, so a compensating
      // entry of the same magnitude always returns a balance to where it was.
      expect(moneyEquals(addMoney(left, right), addMoney(right, left))).toBe(
        true,
      );
      expect(
        moneyEquals(subtractMoney(addMoney(left, right), right), left),
      ).toBe(true);
      expect(isZeroMoney(addMoney(left, negateMoney(left)))).toBe(true);
      expect(
        moneyEquals(sumMoney([left, right], 'USD'), addMoney(left, right)),
      ).toBe(true);
      // The wire spelling round-trips without passing through a double.
      expect(
        moneyEquals(moneyFromMinorUnits(minorUnitsOf(left), 'USD'), left),
      ).toBe(true);
    }
  });
});

describe('journal account identity', () => {
  it('derives a stable version 8 identifier from the position', () => {
    const first = journalAccountId(billingJournalPrefix, 'USD', {
      category: 'platform_revenue',
      subjectType: 'platform',
    });
    const again = journalAccountId(billingJournalPrefix, 'USD', {
      category: 'platform_revenue',
      subjectType: 'platform',
    });
    expect(first).toBe(again);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('separates positions that differ in any part of their identity', () => {
    const platform = {
      category: 'creator_payable',
      subjectType: 'platform',
    } as const;
    const base = journalAccountId(billingJournalPrefix, 'USD', platform);
    expect(journalAccountId(billingJournalPrefix, 'EUR', platform)).not.toBe(
      base,
    );
    expect(journalAccountId('payouts', 'USD', platform)).not.toBe(base);
    expect(
      journalAccountId(billingJournalPrefix, 'USD', {
        category: 'platform_revenue',
        subjectType: 'platform',
      }),
    ).not.toBe(base);
    expect(
      journalAccountId(billingJournalPrefix, 'USD', {
        category: 'creator_payable',
        subjectId: '00000000-0000-4000-8000-000000000001',
        subjectType: 'creator',
      }),
    ).not.toBe(base);
  });
});

const platformClearing = {
  category: 'provider_clearing',
  subjectType: 'platform',
} as const;
const platformSettlement = {
  category: 'customer_settlement',
  subjectType: 'platform',
} as const;

/**
 * Runs a posting and returns whatever it threw.
 *
 * `expect(...).rejects` is typed as returning nothing in `bun:test`, so awaiting
 * it is both a lint error and a silent no-op if the promise resolves. Catching
 * the error and asserting its class is the shape the rest of this repository
 * uses, and it fails loudly when nothing is thrown at all.
 */
async function rejectionFrom(posted: JournalPosting): Promise<unknown> {
  try {
    await store().post(unreachable, posted);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('journal posting validation', () => {
  const unsound: readonly (readonly [string, JournalPosting])[] = [
    [
      'does not balance',
      posting({
        entries: [
          {
            account: platformClearing,
            amount: money(1_000n, 'USD'),
            direction: 'debit',
          },
          {
            account: platformSettlement,
            amount: money(999n, 'USD'),
            direction: 'credit',
          },
        ],
      }),
    ],
    ['has no entries', posting({ entries: [] })],
    [
      'has a single entry',
      posting({
        entries: [
          {
            account: platformClearing,
            amount: money(1_000n, 'USD'),
            direction: 'debit',
          },
        ],
      }),
    ],
    [
      'mixes two currencies in one transaction',
      posting({
        entries: [
          {
            account: platformClearing,
            amount: money(1_000n, 'USD'),
            direction: 'debit',
          },
          {
            account: platformSettlement,
            amount: money(1_000n, 'EUR'),
            direction: 'credit',
          },
        ],
      }),
    ],
    [
      'carries a zero amount that balances vacuously',
      posting({
        entries: [
          {
            account: platformClearing,
            amount: money(0n, 'USD'),
            direction: 'debit',
          },
          {
            account: platformSettlement,
            amount: money(0n, 'USD'),
            direction: 'credit',
          },
        ],
      }),
    ],
    [
      'is a correction that names no transaction',
      posting({ reason: journalCorrectionReason }),
    ],
    [
      'is an ordinary posting claiming to correct one',
      posting({ correctsTransactionId: crypto.randomUUID() }),
    ],
    [
      'gives a subject account no subject',
      posting({
        entries: [
          {
            account: { category: 'creator_payable', subjectType: 'creator' },
            amount: money(1_000n, 'USD'),
            direction: 'debit',
          },
          {
            account: platformSettlement,
            amount: money(1_000n, 'USD'),
            direction: 'credit',
          },
        ],
      }),
    ],
    [
      'gives a platform account a subject',
      posting({
        entries: [
          {
            account: {
              category: 'provider_clearing',
              subjectId: '00000000-0000-4000-8000-000000000002',
              subjectType: 'platform',
            },
            amount: money(1_000n, 'USD'),
            direction: 'debit',
          },
          {
            account: platformSettlement,
            amount: money(1_000n, 'USD'),
            direction: 'credit',
          },
        ],
      }),
    ],
  ];

  for (const [description, unsoundPosting] of unsound) {
    it(`refuses a posting that ${description}`, async () => {
      expect(await rejectionFrom(unsoundPosting)).toBeInstanceOf(JournalError);
    });
  }

  it('keeps every declared reason and category enforceable', () => {
    expect(billingJournalReasons).toContain(journalCorrectionReason);
    for (const value of [
      ...billingJournalReasons,
      ...billingJournalCategories,
    ]) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/u);
    }
  });
});
