/**
 * Bounds a client may import, with no schema library behind them.
 *
 * They live in their own module so a client can import a length limit without
 * importing a validator. `packages/validation` publishes zod schemas built from
 * these same constants, and a React Native bundle that wanted `maximumBioLength`
 * would otherwise carry every schema in the package to get it.
 *
 * The bounds are contract rather than convenience: a client must be able to
 * check a display name before sending it, the published OpenAPI document states
 * the same limits the server enforces, and the database CHECK constraints are
 * generated from these constants. One definition, four consumers, no drift.
 *
 * The minimum discoverable profile is deliberately small — a display name, a
 * coarse region, a language, and one image. Date of birth, precise location,
 * gender, and orientation are not part of it, so nobody is asked to hand over
 * sensitive data as the price of being seen.
 */

/**
 * How many images one creator catalog item holds.
 *
 * Here rather than beside the club schemas for the same reason every other
 * bound in this module is: Creator Studio has to be able to label its own
 * control without importing a validator to find the number out.
 */
export const maximumContentMedia = 6;

export const minimumDisplayNameLength = 2;
export const maximumDisplayNameLength = 32;
export const maximumBioLength = 500;

/** BCP 47 primary language subtag, kept extensible to three-letter codes. */
export const languagePattern = /^[a-z]{2,3}$/u;

export const minimumProfileLanguages = 1;
export const maximumProfileLanguages = 5;

/** Image slots a profile may hold. Positions are zero-based and dense. */
export const maximumProfileMedia = 6;

/**
 * Accepted image types. The server decides an object's type from its own bytes;
 * this list is published so a client can refuse an obviously wrong file early,
 * never so the server can trust what a client claims.
 */
export const acceptedProfileMediaTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ProfileMediaContentType =
  (typeof acceptedProfileMediaTypes)[number];

export const maximumProfileMediaBytes = 8 * 1024 * 1024;
