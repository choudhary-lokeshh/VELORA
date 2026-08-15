import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createBillingRuntime } from '../../src/billing/composition.js';
import { billingBusinessTypes } from '../../src/billing/policy.js';
import { money, minorUnitsOf } from '../../src/money/money.js';
import type { JournalPosting } from '../../src/money/journal.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { testDatabaseAdmission } from '../support/harness.js';

/**
 * The customer-money journal against real PostgreSQL.
 *
 * What this suite exists to prove is that the accounting invariants are the
 * *database's*, not the application's. Every assertion that matters here is
 * made by writing directly to the tables — bypassing `JournalStore` entirely —
 * because a rule that only the service upholds is a rule that the next caller
 * can break. The service's own validation is covered in `test/unit/money.test.ts`
 * and exists for the error message, not for the guarantee.
 *
 * The concurrency case is the other half. Fifty simultaneous postings of one
 * business event must produce exactly one transaction, with no lock taken, no
 * retry loop, and a balance that is still arithmetically correct afterwards.
 */

const databaseUrl = await provisionDatabase('velora_billing_journal');
const database: TestDatabase = connectDatabase(databaseUrl);

const now = new Date('2026-08-15T10:00:00.000Z');
const billing = createBillingRuntime({
  database: database.drizzle,
  now: () => now,
});
const journal = billing.journal;

const providerClearing = {
  category: 'provider_clearing',
  subjectType: 'platform',
} as const;
const customerSettlement = {
  category: 'customer_settlement',
  subjectType: 'platform',
} as const;
const creatorId = '11111111-1111-4111-8111-111111111111';
const creatorPayable = {
  category: 'creator_payable',
  subjectId: creatorId,
  subjectType: 'creator',
} as const;

function capture(
  reference: string,
  amountMinor: bigint,
  currency = 'USD',
): JournalPosting {
  return {
    businessReference: reference,
    businessType: billingBusinessTypes.payment,
    entries: [
      {
        account: providerClearing,
        amount: money(amountMinor, currency),
        direction: 'debit',
      },
      {
        account: customerSettlement,
        amount: money(amountMinor, currency),
        direction: 'credit',
      },
    ],
    occurredAt: now,
    reason: 'payment_captured',
  };
}

async function post(posting: JournalPosting) {
  return database.drizzle.transaction(async (executor) =>
    journal.post(executor, posting),
  );
}

/** Inserts a transaction row and whatever entries are given, as one unit. */
async function writeRaw(input: {
  readonly entries: readonly {
    readonly accountId: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly direction: string;
  }[];
  readonly currency: string;
  readonly transactionId: string;
}): Promise<void> {
  await database.sql.begin(async (transaction: Bun.SQL) => {
    await transaction`
      insert into billing_journal_transactions
        (business_reference, business_type, created_at, currency, id, occurred_at, reason)
      values (${crypto.randomUUID()}, 'billing.payment', ${now}, ${input.currency},
              ${input.transactionId}, ${now}, 'payment_captured')`;
    for (const entry of input.entries) {
      await transaction`
        insert into billing_journal_entries
          (account_id, amount_minor, created_at, currency, direction, id, transaction_id)
        values (${entry.accountId}, ${entry.amountMinor}, ${now}, ${entry.currency},
                ${entry.direction}, ${crypto.randomUUID()}, ${input.transactionId})`;
    }
  });
}

async function seedAccounts(): Promise<{
  readonly clearingUsd: string;
  readonly clearingEur: string;
  readonly settlementUsd: string;
}> {
  await post(capture(crypto.randomUUID(), 100n));
  await post(capture(crypto.randomUUID(), 100n, 'EUR'));
  return {
    clearingEur: journal.accountId('EUR', providerClearing),
    clearingUsd: journal.accountId('USD', providerClearing),
    settlementUsd: journal.accountId('USD', customerSettlement),
  };
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('billing journal persistence', () => {
  it('owns exactly the three billing tables and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'billing_%'
        order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'billing_journal_accounts',
      'billing_journal_entries',
      'billing_journal_transactions',
    ]);
  });

  it('creates the tables, indexes, and invariant triggers the journal needs', async () => {
    const triggers = await rowsOf<{ tgname: string }>(
      database.sql`
        select tgname from pg_trigger
        where not tgisinternal
          and tgrelid::regclass::text like 'billing_journal%'
        order by tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'billing_journal_accounts_append_only',
      'billing_journal_entries_append_only',
      'billing_journal_entries_balanced',
      'billing_journal_entries_same_transaction',
      'billing_journal_transactions_append_only',
      'billing_journal_transactions_posted',
    ]);

    const indexes = await rowsOf<{ indexname: string }>(
      database.sql`
        select indexname from pg_indexes
        where tablename like 'billing_journal%'
        order by indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toContain(
      'billing_journal_transactions_event_uk',
    );
    expect(indexes.map((row) => row.indexname)).toContain(
      'billing_journal_entries_account_idx',
    );
  });

  it('posts a balanced transaction and derives both balances from its entries', async () => {
    const reference = crypto.randomUUID();
    const result = await post(capture(reference, 4_999n));
    expect(result.alreadyPosted).toBe(false);

    const view = await journal.readTransaction(
      database.drizzle,
      result.transactionId,
    );
    expect(view?.transaction.reason).toBe('payment_captured');
    expect(view?.transaction.currency).toBe('USD');
    expect(view?.entries).toHaveLength(2);

    const clearing = await journal.balanceOf(
      database.drizzle,
      'USD',
      providerClearing,
    );
    const settlement = await journal.balanceOf(
      database.drizzle,
      'USD',
      customerSettlement,
    );
    expect(minorUnitsOf(clearing)).toBe('4999');
    expect(minorUnitsOf(settlement)).toBe('-4999');
  });

  it('carries an amount larger than a double through PostgreSQL exactly', async () => {
    // 2^53 + 1 minor units. If any layer between here and `bigint` were a
    // double this would come back as ...992.
    const exact = 9_007_199_254_740_993n;
    const result = await post(capture(crypto.randomUUID(), exact));
    const view = await journal.readTransaction(
      database.drizzle,
      result.transactionId,
    );
    expect(view?.entries.map((entry) => minorUnitsOf(entry.amount))).toEqual([
      '9007199254740993',
      '9007199254740993',
    ]);
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('9007199254740993');
  });

  it('keeps one currency per account and per transaction', async () => {
    const accounts = await seedAccounts();
    expect(accounts.clearingUsd).not.toBe(accounts.clearingEur);

    // An entry that names a USD transaction and a EUR account cannot exist:
    // the composite foreign keys make currency agreement structural.
    expect(
      await refused(async () =>
        writeRaw({
          currency: 'USD',
          entries: [
            {
              accountId: accounts.clearingEur,
              amountMinor: '500',
              currency: 'USD',
              direction: 'debit',
            },
            {
              accountId: accounts.settlementUsd,
              amountMinor: '500',
              currency: 'USD',
              direction: 'credit',
            },
          ],
          transactionId: crypto.randomUUID(),
        }),
      ),
    ).toBe(true);
  });

  it('refuses an unbalanced transaction written directly to the tables', async () => {
    const accounts = await seedAccounts();
    expect(
      await refused(async () =>
        writeRaw({
          currency: 'USD',
          entries: [
            {
              accountId: accounts.clearingUsd,
              amountMinor: '500',
              currency: 'USD',
              direction: 'debit',
            },
            {
              accountId: accounts.settlementUsd,
              amountMinor: '499',
              currency: 'USD',
              direction: 'credit',
            },
          ],
          transactionId: crypto.randomUUID(),
        }),
      ),
    ).toBe(true);
  });

  it('refuses a transaction with no entries and one with a single entry', async () => {
    const accounts = await seedAccounts();
    expect(
      await refused(async () =>
        writeRaw({
          currency: 'USD',
          entries: [],
          transactionId: crypto.randomUUID(),
        }),
      ),
    ).toBe(true);
    expect(
      await refused(async () =>
        writeRaw({
          currency: 'USD',
          entries: [
            {
              accountId: accounts.clearingUsd,
              amountMinor: '500',
              currency: 'USD',
              direction: 'debit',
            },
          ],
          transactionId: crypto.randomUUID(),
        }),
      ),
    ).toBe(true);
  });

  it('refuses a zero or negative entry amount', async () => {
    const accounts = await seedAccounts();
    for (const amountMinor of ['0', '-500']) {
      expect(
        await refused(async () =>
          writeRaw({
            currency: 'USD',
            entries: [
              {
                accountId: accounts.clearingUsd,
                amountMinor,
                currency: 'USD',
                direction: 'debit',
              },
              {
                accountId: accounts.settlementUsd,
                amountMinor,
                currency: 'USD',
                direction: 'credit',
              },
            ],
            transactionId: crypto.randomUUID(),
          }),
        ),
      ).toBe(true);
    }
  });

  it('refuses every update and delete against a posted book', async () => {
    const result = await post(capture(crypto.randomUUID(), 2_500n));
    for (const statement of [
      database.sql`update billing_journal_entries set amount_minor = 1`,
      database.sql`delete from billing_journal_entries`,
      database.sql`update billing_journal_transactions set reason = 'refund_issued'`,
      database.sql`delete from billing_journal_transactions`,
      database.sql`update billing_journal_accounts set category = 'reserves'`,
      database.sql`delete from billing_journal_accounts`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
    const view = await journal.readTransaction(
      database.drizzle,
      result.transactionId,
    );
    expect(view?.transaction.reason).toBe('payment_captured');
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('2500');
  });

  it('refuses entries appended to a transaction posted earlier', async () => {
    // The mutation an append-only rule would otherwise miss entirely: two
    // entries that balance on their own, added later, changing what a settled
    // transaction says without updating a single row.
    const accounts = await seedAccounts();
    const posted = await post(capture(crypto.randomUUID(), 4_000n));
    expect(
      await refused(async () =>
        database.sql.begin(async (transaction: Bun.SQL) => {
          await transaction`
            insert into billing_journal_entries
              (account_id, amount_minor, created_at, currency, direction, id, transaction_id)
            values (${accounts.clearingUsd}, 100, ${now}, 'USD', 'debit',
                    ${crypto.randomUUID()}, ${posted.transactionId})`;
          await transaction`
            insert into billing_journal_entries
              (account_id, amount_minor, created_at, currency, direction, id, transaction_id)
            values (${accounts.settlementUsd}, 100, ${now}, 'USD', 'credit',
                    ${crypto.randomUUID()}, ${posted.transactionId})`;
        }),
      ),
    ).toBe(true);
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('4100');
  });

  it('refuses a correction denominated in another currency', async () => {
    const original = await post(capture(crypto.randomUUID(), 1_000n, 'EUR'));
    expect(
      await refused(async () =>
        execute(
          database.sql`
            insert into billing_journal_transactions
              (business_reference, business_type, corrects_transaction_id, created_at, currency, id, occurred_at, reason)
            values (${crypto.randomUUID()}, 'billing.correction', ${original.transactionId}, ${now}, 'USD',
                    ${crypto.randomUUID()}, ${now}, 'correction')`,
        ),
      ),
    ).toBe(true);
  });

  it('holds one account per category, currency, and subject', async () => {
    await post(capture(crypto.randomUUID(), 100n));
    expect(
      await refused(async () =>
        execute(
          database.sql`
            insert into billing_journal_accounts
              (category, created_at, currency, id, subject_id, subject_type)
            values ('provider_clearing', ${now}, 'USD', ${crypto.randomUUID()}, null, 'platform')`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(async () =>
        execute(
          database.sql`
            insert into billing_journal_accounts
              (category, created_at, currency, id, subject_id, subject_type)
            values ('creator_payable', ${now}, 'USD', ${crypto.randomUUID()}, null, 'creator')`,
        ),
      ),
    ).toBe(true);
  });
});

describe('billing journal idempotency', () => {
  it('posts one business event exactly once, however often it is offered', async () => {
    const reference = crypto.randomUUID();
    const first = await post(capture(reference, 1_200n));
    const second = await post(capture(reference, 1_200n));
    expect(first.alreadyPosted).toBe(false);
    expect(second.alreadyPosted).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);

    const [count] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_journal_transactions`,
    );
    expect(count?.count).toBe('1');
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('1200');
  });

  it('separates the same reference under two business types', async () => {
    const reference = crypto.randomUUID();
    await post(capture(reference, 700n));
    const refund = await post({
      ...capture(reference, 700n),
      businessType: billingBusinessTypes.refund,
      reason: 'refund_issued',
    });
    expect(refund.alreadyPosted).toBe(false);
    const [count] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_journal_transactions`,
    );
    expect(count?.count).toBe('2');
  });

  it('admits exactly one of fifty simultaneous postings of one event', async () => {
    const reference = crypto.randomUUID();
    // Bounded below the harness pool, exactly as production bounds in-flight
    // work below its own. A pool that has to queue while serving transactions
    // is the Bun.SQL defect ADR-0019 exists for, and it would show up here as a
    // hang rather than as a wrong answer.
    const admission = testDatabaseAdmission();
    const results = await Promise.all(
      Array.from({ length: 50 }, async () =>
        admission.run(async () => post(capture(reference, 3_300n))),
      ),
    );

    expect(results.filter((result) => !result.alreadyPosted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);

    const [transactions] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_journal_transactions`,
    );
    const [entries] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_journal_entries`,
    );
    expect(transactions?.count).toBe('1');
    expect(entries?.count).toBe('2');
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('3300');

    const [deadlocks] = await rowsOf<{ deadlocks: string }>(
      database.sql`select deadlocks::text as deadlocks from pg_stat_database where datname = current_database()`,
    );
    expect(deadlocks?.deadlocks).toBe('0');
  });

  it('refuses a posting that is not inside a transaction', async () => {
    // The transaction row and its entries are separate statements. Outside a
    // transaction the first one commits alone, and the deferred trigger fires
    // against a transaction that has no entries — which is exactly the state
    // the journal must never hold.
    expect(
      await refused(async () =>
        journal.post(database.drizzle, capture(crypto.randomUUID(), 900n)),
      ),
    ).toBe(true);
    const [count] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_journal_transactions`,
    );
    expect(count?.count).toBe('0');
  });
});

describe('billing journal corrections', () => {
  it('repairs a transaction with a compensating one and keeps both', async () => {
    const original = await post({
      businessReference: crypto.randomUUID(),
      businessType: billingBusinessTypes.payment,
      entries: [
        {
          account: providerClearing,
          amount: money(5_000n, 'USD'),
          direction: 'debit',
        },
        {
          account: creatorPayable,
          amount: money(5_000n, 'USD'),
          direction: 'credit',
        },
      ],
      occurredAt: now,
      reason: 'payment_captured',
    });

    const correction = await post({
      businessReference: crypto.randomUUID(),
      businessType: billingBusinessTypes.correction,
      correctsTransactionId: original.transactionId,
      entries: [
        {
          account: creatorPayable,
          amount: money(5_000n, 'USD'),
          direction: 'debit',
        },
        {
          account: providerClearing,
          amount: money(5_000n, 'USD'),
          direction: 'credit',
        },
      ],
      occurredAt: now,
      reason: 'correction',
    });

    expect(correction.alreadyPosted).toBe(false);
    // Both positions are back where they started, and neither transaction was
    // touched to achieve it.
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', providerClearing),
      ),
    ).toBe('0');
    expect(
      minorUnitsOf(
        await journal.balanceOf(database.drizzle, 'USD', creatorPayable),
      ),
    ).toBe('0');

    const rows = await rowsOf<{
      corrects_transaction_id: string | null;
      id: string;
    }>(
      database.sql`select id, corrects_transaction_id from billing_journal_transactions order by created_at, id`,
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.id === correction.transactionId)
        ?.corrects_transaction_id,
    ).toBe(original.transactionId);
  });

  it('refuses a correction that names no transaction and an ordinary posting that names one', async () => {
    const accounts = await seedAccounts();
    for (const [reason, corrects] of [
      ['correction', null],
      ['payment_captured', crypto.randomUUID()],
    ] as const) {
      expect(
        await refused(async () =>
          execute(
            database.sql`
              insert into billing_journal_transactions
                (business_reference, business_type, corrects_transaction_id, created_at, currency, id, occurred_at, reason)
              values (${crypto.randomUUID()}, 'billing.payment', ${corrects}, ${now}, 'USD',
                      ${crypto.randomUUID()}, ${now}, ${reason})`,
          ),
        ),
      ).toBe(true);
    }
    expect(accounts.clearingUsd).toBeDefined();
  });
});
