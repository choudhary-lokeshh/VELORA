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
