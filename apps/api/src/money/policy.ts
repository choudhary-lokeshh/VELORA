/**
 * Money and journal constants, restated for the schema.
 *
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations, so the values a CHECK constraint needs are written here and
 * asserted identical to `@velora/validation` by a unit test. The same rule
 * `src/clubs/policy.ts` follows: if the two ever disagree the database would
 * enforce something other than what the contract promises, and that must fail
 * the build rather than reach a migration.
 */

/** ISO 4217 alpha-3, upper case. Mirrors `currencyCodePattern`. */
export const currencyCodePattern = '^[A-Z]{3}$';

/**
 * The two sides of a double-entry posting.
 *
 * Direction plus a strictly positive amount, rather than a signed amount, so
 * "which way did this move" is a value the database can group by and a
 * malformed entry cannot express itself as a negative credit.
 */
export const journalDirections = ['debit', 'credit'] as const;
export type JournalDirection = (typeof journalDirections)[number];

/**
 * Who a journal account belongs to.
 *
 * `platform` accounts are the platform's own positions and have no subject.
 * The others name one creator or one consumer by opaque identifier, with no
 * foreign key, because `docs/architecture/05-data-ownership.md` makes a
 * cross-domain reference a stable identifier rather than shared schema.
 */
export const journalSubjectTypes = ['platform', 'creator', 'consumer'] as const;
export type JournalSubjectType = (typeof journalSubjectTypes)[number];

/**
 * Widest business reference a journal transaction may carry.
 *
 * Business events are Velora identifiers today and may be provider references
 * later, so this is text rather than `uuid`; bounding it keeps an unbounded
 * external string out of a unique index.
 */
export const maximumBusinessReferenceLength = 200;

/**
 * The PostgreSQL `bigint` range, which is the storage every minor-unit amount
 * lands in.
 *
 * These are representation limits, not commercial ones. No maximum price,
 * minimum price, or transaction ceiling is decided here; those are unresolved
 * commercial policy in `docs/decisions/DECISIONS_REQUIRED.md`. What this bound
 * prevents is an amount that cannot be stored, or a sum that silently wraps.
 */
export const minimumStorableMinorUnits = -9_223_372_036_854_775_808n;
export const maximumStorableMinorUnits = 9_223_372_036_854_775_807n;
