/**
 * Profile bounds as the database schema sees them.
 *
 * These values are contract, and `@velora/validation` is where the contract is
 * defined. They are restated here for one mechanical reason: `drizzle-kit`
 * resolves the schema module through CommonJS, and the workspace packages
 * publish ESM-only entry points, so a schema file cannot import from them
 * without breaking migration generation.
 *
 * The restatement is not allowed to drift. `test/unit/users-policy.test.ts`
 * asserts every constant below is identical to the published one, so a change
 * on either side that is not made on both fails the build rather than producing
 * a database that enforces something other than what the contract promises.
 *
 * Nothing that is not needed to generate DDL belongs here. Services and routes
 * import the published constants directly.
 */

export const minimumDisplayNameLength = 2;
export const maximumDisplayNameLength = 32;
export const maximumBioLength = 500;

/** BCP 47 primary language subtag, kept extensible to three-letter codes. */
export const languagePattern = /^[a-z]{2,3}$/u;

/**
 * The declared matching categories, restated for the schema on the rule above.
 *
 * A closed list the database enforces, so a value that is not one of these
 * cannot be stored however it arrived. `undisclosed` is a declaration rather
 * than an absence: no row at all means nobody has been asked, and the
 * difference matters to a surface even though it does not matter to the
 * matcher, which treats both as unmatchable by a category-specific preference.
 *
 * Nothing here is ever derived. The only writer is the account owner through
 * the one route that takes it, and there is no code path anywhere that computes
 * a value for this column from anything else.
 */
export const matchingGenderValues = [
  'woman',
  'man',
  'non_binary',
  'undisclosed',
] as const;
export type MatchingGenderValue = (typeof matchingGenderValues)[number];

/**
 * The subset a preference may narrow to.
 *
 * `undisclosed` is absent deliberately. A filter for people who declined to say
 * would make declining an answer with consequences, which would make the option
 * a trap rather than a choice.
 */
export const matchableGenderValues = ['woman', 'man', 'non_binary'] as const;
export type MatchableGenderValue = (typeof matchableGenderValues)[number];

/** Image slots a profile may hold. Positions are zero-based and dense. */
export const maximumProfileMedia = 6;

export const acceptedProfileMediaTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ProfileMediaContentType =
  (typeof acceptedProfileMediaTypes)[number];

export const maximumProfileMediaBytes = 8 * 1024 * 1024;

/**
 * How long an upload target stays usable. Short, because it is a capability to
 * write bytes into the platform's storage and nothing else should hold one.
 * The expiry is published on the media record as an instant, so no client ever
 * needs the duration itself, and it appears in no DDL.
 */
export const profileMediaUploadWindowMilliseconds = 15 * 60 * 1000;

/**
 * How many media readiness projections one sweep cycle refreshes.
 *
 * Bounded so a platform with a large number of attached images revisits them
 * over several cycles rather than in one statement, and ordered by staleness so
 * every slot is reached within a predictable period.
 */
export const profileMediaReadinessBatchSize = 200;

/** How often the readiness projection sweep runs. */
export const profileMediaReadinessIntervalMilliseconds = 15_000;
