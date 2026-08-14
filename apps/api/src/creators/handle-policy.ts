/**
 * Creator handle and profile bounds, restated for the schema.
 *
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations, so these values are written here and asserted identical to
 * `@velora/validation` by a unit test. If the two ever disagree the database
 * would enforce something other than what the contract promises, and that must
 * fail the build rather than reach a migration.
 */

export const minimumCreatorHandleLength = 3;
export const maximumCreatorHandleLength = 30;

/**
 * The canonical handle shape. Lower-case ASCII, starting and ending with a
 * letter or digit. Written as a PostgreSQL-compatible pattern because it is
 * used in a CHECK constraint as well as in TypeScript.
 */
export const creatorHandlePattern = '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$';

export const reservedCreatorHandles = [
  'about',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'billing',
  'blog',
  'c',
  'club',
  'clubs',
  'contact',
  'creator',
  'creators',
  'dashboard',
  'discovery',
  'docs',
  'explore',
  'faq',
  'help',
  'home',
  'legal',
  'login',
  'logout',
  'me',
  'messages',
  'moderation',
  'new',
  'notifications',
  'null',
  'official',
  'payments',
  'payouts',
  'policy',
  'privacy',
  'profile',
  'register',
  'report',
  'root',
  'safety',
  'search',
  'security',
  'settings',
  'signin',
  'signout',
  'signup',
  'static',
  'status',
  'studio',
  'support',
  'system',
  'terms',
  'trust',
  'undefined',
  'user',
  'users',
  'velora',
  'www',
] as const;

export const minimumCreatorDisplayNameLength = 2;
export const maximumCreatorDisplayNameLength = 60;
export const maximumCreatorBioLength = 600;
export const maximumCreatorLinks = 5;
export const maximumCreatorLinkLabelLength = 40;
export const maximumCreatorLinkUrlLength = 200;

export const creatorProfilePublications = ['draft', 'published'] as const;
export type CreatorProfilePublication =
  (typeof creatorProfilePublications)[number];
