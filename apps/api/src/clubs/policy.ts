/**
 * Creator content bounds, restated for the schema.
 *
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations, so these values are written here and asserted identical to
 * `@velora/validation` by a unit test. If the two ever disagree the database
 * would enforce something other than what the contract promises, and that must
 * fail the build rather than reach a migration.
 */

export const minimumCreatorContentTitleLength = 2;
export const maximumCreatorContentTitleLength = 120;
export const maximumCreatorContentSummaryLength = 300;
export const maximumCreatorContentBodyLength = 20_000;

export const creatorContentLifecycles = [
  'draft',
  'published',
  'archived',
] as const;
export type CreatorContentLifecycle = (typeof creatorContentLifecycles)[number];

export const creatorContentVisibilities = ['public', 'members_only'] as const;
export type CreatorContentVisibility =
  (typeof creatorContentVisibilities)[number];

/** Largest page the catalog will return, whatever a caller asks for. */
export const maximumCatalogPageSize = 50;
export const defaultCatalogPageSize = 20;

export const minimumClubNameLength = 2;
export const maximumClubNameLength = 80;
export const maximumClubDescriptionLength = 600;
export const minimumClubSlugLength = 3;
export const maximumClubSlugLength = 40;
export const clubSlugPattern = '^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$';

export const clubLifecycles = ['draft', 'published', 'closed'] as const;
export type ClubLifecycle = (typeof clubLifecycles)[number];

export const membershipSources = [
  'creator_invite',
  'admin_grant',
  'billing',
] as const;
export type MembershipSource = (typeof membershipSources)[number];

export const membershipStates = ['active', 'revoked'] as const;
export type MembershipState = (typeof membershipStates)[number];

/**
 * How long an unredeemed invitation stays usable.
 *
 * Bounded because an invitation is a bearer credential: anybody holding the
 * secret is the person it admits, so one that never expires is a permanent key
 * left wherever it was last pasted. Seven days is long enough to send somebody
 * a link and short enough that a leak has a horizon.
 */
export const clubInviteLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000;

/** Bytes of randomness behind an invitation. 256 bits, generated server-side. */
export const clubInviteSecretBytes = 32;
