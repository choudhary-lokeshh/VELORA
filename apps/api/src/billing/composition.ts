import type { DatabaseHandle } from '../database/executor.js';
import { JournalStore } from '../money/journal.js';
import { billingJournalPrefix } from './policy.js';
import { billingJournalTables } from './schema.js';

/**
 * BILLING composition root.
 *
 * Deliberately small. This phase establishes the book the rest of the vertical
 * posts into and nothing else: there is no offer, no payment, no provider, and
 * no route, because none of those can be built correctly before there is
 * somewhere for their money to land.
 */
export interface BillingRuntime {
  readonly database: DatabaseHandle;
  readonly journal: JournalStore;
}

export function createBillingRuntime(input: {
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
}): BillingRuntime {
  return {
    database: input.database,
    journal: new JournalStore({
      ...(input.now === undefined ? {} : { now: input.now }),
      prefix: billingJournalPrefix,
      tables: billingJournalTables,
    }),
  };
}
