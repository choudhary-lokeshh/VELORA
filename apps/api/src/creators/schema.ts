import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  creatorHandlePattern,
  creatorProfilePublications,
  maximumCreatorBioLength,
  maximumCreatorDisplayNameLength,
  maximumCreatorHandleLength,
  maximumCreatorLinkLabelLength,
  maximumCreatorLinkUrlLength,
  maximumCreatorLinks,
  minimumCreatorDisplayNameLength,
  minimumCreatorHandleLength,
  reservedCreatorHandles,
  type CreatorProfilePublication,
} from './handle-policy.js';

/**
 * CREATORS-owned persistence.
 *
 * `docs/architecture/03-domain-boundaries.md` gives CREATORS the creator
 * identity and its eligibility to operate platform features, and nothing else:
 * no credential, no session, no consumer profile, no club, no content, no
 * membership, no money. Club configuration, content catalog, and entitlement
 * belong to PRIVATE CLUBS; charge truth belongs to BILLING; payout truth
 * belongs to PAYOUTS. A second writer to any of those would be a boundary
 * violation however convenient the join looked.
 *
 * The link to AUTH is one opaque account identifier and nothing else. There is
 * deliberately no foreign key to `auth_accounts` or to `users_accounts`, for
 * the same reason USERS has none: `docs/architecture/05-data-ownership.md`
 * requires cross-domain references to be stable identifiers rather than shared
 * schema, and a cascade from another domain's table would let a deletion there
 * silently erase creator state that `docs/flows/account-deletion.md` says the
 * owning domain must coordinate. The uniqueness that matters — one creator
 * capability per AUTH principal — is enforced here, where CREATORS owns it.
 *
 * Nothing in this schema collects a legal name, a business registration, a tax
 * identifier, a bank account, a payout credential, or an identity document.
 * `docs/compliance/03-creator-content-gates.md` places those behind approval
 * gates that have not been granted, and a column that exists is a column
 * something will eventually fill.
 */

/**
 * See `creatorAccountStatusValues` in `@velora/validation` and
 * `docs/decisions/ADR-0020-creator-capability-activation.md` for why the ladder
 * is this short: identity verification is a separate predicate with no approved
 * provider, not a lifecycle state a row could sit in.
 */
export const creatorAccountStatuses = [
  'applicant',
  'active',
  'suspended',
  'closed',
] as const;
export type CreatorAccountStatus = (typeof creatorAccountStatuses)[number];

export const creatorAccountStatusReasons = [
  'onboarding_incomplete',
  'eligibility_failed',
  'safety_enforcement',
  'platform_action',
  'creator_requested',
] as const;
export type CreatorAccountStatusReason =
  (typeof creatorAccountStatusReasons)[number];

export const creatorAccounts = pgTable(
  'creators_accounts',
  {
    /**
     * When every currently required gate first passed. It is not cleared by a
     * later suspension: when a capability was activated is a fact, and a
     * suspension is a different fact recorded separately.
     */
    activatedAt: timestamptz('activated_at'),
    /** Opaque AUTH account reference. One creator capability per principal. */
    authAccountId: uuid('auth_account_id').notNull(),
    closedAt: timestamptz('closed_at'),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    status: text('status').notNull().$type<CreatorAccountStatus>(),
    statusChangedAt: timestamptz('status_changed_at').notNull(),
    statusReason: text('status_reason').$type<CreatorAccountStatusReason>(),
    suspendedAt: timestamptz('suspended_at'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // The constraint that makes concurrent onboarding converge. Two requests
    // that both find no row will both insert; PostgreSQL rejects the loser
    // here, which is why the service can be idempotent without a lock.
    uniqueIndex('creators_accounts_auth_account_uk').on(table.authAccountId),
    index('creators_accounts_status_idx').on(table.status, table.createdAt),
    // The operator list's ordering, which has no filter to narrow it: every
    // creator is a candidate, newest first. Measured on twenty thousand rows
    // the planner otherwise chose a sequential scan and a top-N heapsort —
    // 2 ms and 267 buffers there, and a table scan at any size. Ordered the
    // way the cursor pages, so a page is an index walk that stops.
    index('creators_accounts_created_idx').on(table.createdAt, table.id),
    check(
      'creators_accounts_status_check',
      inList(table.status, creatorAccountStatuses),
    ),
    check(
      'creators_accounts_status_reason_check',
      sql`${table.statusReason} is null or ${inList(table.statusReason, creatorAccountStatusReasons)}`,
    ),
    // An active capability has nothing outstanding to explain. Anything else
    // carries a coarse reason, so no row can be non-active for no recorded
    // cause.
    check(
      'creators_accounts_active_reason_check',
      sql`(${table.status} = 'active') = (${table.statusReason} is null)`,
    ),
    check(
      'creators_accounts_activated_check',
      sql`${table.status} <> 'active' or ${table.activatedAt} is not null`,
    ),
    check(
      'creators_accounts_closed_check',
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null)`,
    ),
  ],
);

export const creatorPolicyKeys = [
  'creator_terms',
  'creator_content_policy',
] as const;
export type CreatorPolicyKey = (typeof creatorPolicyKeys)[number];

/**
 * Creator policy acknowledgement evidence.
 *
 * Append-only and versioned. The primary key is the creator, the document, and
 * the version together, so re-submitting an acknowledgement already held cannot
 * rewrite when the person agreed — which is the only property that makes this
 * evidence rather than a flag.
 */
export const creatorPolicyAcknowledgements = pgTable(
  'creators_policy_acknowledgements',
  {
    acknowledgedAt: timestamptz('acknowledged_at').notNull(),
    /** The surface the acknowledgement was given on, for audit. */
    audience: text('audience').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creatorAccounts.id, { onDelete: 'cascade' }),
    policyKey: text('policy_key').notNull().$type<CreatorPolicyKey>(),
    policyVersion: text('policy_version').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.creatorId, table.policyKey, table.policyVersion],
    }),
    check(
      'creators_policy_acknowledgements_key_check',
      inList(table.policyKey, creatorPolicyKeys),
    ),
    check(
      'creators_policy_acknowledgements_version_check',
      lengthBetween(table.policyVersion, 1, 32),
    ),
    check(
      'creators_policy_acknowledgements_audience_check',
      inList(table.audience, ['creator_studio']),
    ),
  ],
);

/**
 * The creator's public identity.
 *
 * Separate from the capability row because the two answer different questions —
 * may this person operate, and what does the world see — and separate from
 * `users_profiles` because a creator identity is not a consumer one.
 * `docs/domains/creators.md` gives CREATORS the creator business profile;
 * reusing the consumer profile would have made one row serve two audiences with
 * two different visibility rules.
 *
 * The handle is the public address. It is stored canonical — lower case, ASCII
 * — so uniqueness is case-insensitive by construction rather than by a
 * comparison somebody has to remember to write, and the unique index is what
 * decides a contested claim: fifty simultaneous requests for the same name all
 * insert, and PostgreSQL admits one.
 */
export const creatorProfiles = pgTable(
  'creators_profiles',
  {
    bio: text('bio'),
    createdAt: timestamptz('created_at').notNull(),
    /** One profile per capability, so the capability identifier is the key. */
    creatorId: uuid('creator_id')
      .primaryKey()
      .references(() => creatorAccounts.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    handle: text('handle').notNull(),
    publication: text('publication')
      .notNull()
      .$type<CreatorProfilePublication>(),
    publishedAt: timestamptz('published_at'),
    updatedAt: timestamptz('updated_at').notNull(),
    /**
     * Optimistic concurrency. A save carrying a stale version is refused rather
     * than applied, so two Studio tabs cannot silently overwrite each other.
     */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('creators_profiles_handle_uk').on(table.handle),
    check(
      'creators_profiles_handle_shape_check',
      sql`${table.handle} ~ ${sql.raw(`'${creatorHandlePattern}'`)}`,
    ),
    check(
      'creators_profiles_handle_length_check',
      lengthBetween(
        table.handle,
        minimumCreatorHandleLength,
        maximumCreatorHandleLength,
      ),
    ),
    // Reserved names are refused by the database as well as by the contract.
    // A future code path that inserted one would be shadowing an application
    // route, and that is not a mistake worth leaving to one layer.
    check(
      'creators_profiles_handle_reserved_check',
      sql`not ${inList(table.handle, reservedCreatorHandles)}`,
    ),
    check(
      'creators_profiles_display_name_check',
      lengthBetween(
        table.displayName,
        minimumCreatorDisplayNameLength,
        maximumCreatorDisplayNameLength,
      ),
    ),
    check(
      'creators_profiles_bio_check',
      sql`${table.bio} is null or ${lengthBetween(table.bio, 1, maximumCreatorBioLength)}`,
    ),
    check(
      'creators_profiles_publication_check',
      inList(table.publication, creatorProfilePublications),
    ),
    // A published profile has a publication instant and a draft has none, so
    // no row can claim to be public without recording when it became so.
    check(
      'creators_profiles_published_shape_check',
      sql`(${table.publication} = 'published') = (${table.publishedAt} is not null)`,
    ),
    check('creators_profiles_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * Public links a creator chose to show.
 *
 * A child table rather than a JSON column, so the count, the ordering, and the
 * shape of every link are database facts. The server never fetches any of them:
 * `docs/security/06-abuse-outbound-networking.md` denies egress, and a link the
 * platform resolved on a creator's behalf would be the request-forgery surface
 * that document exists to prevent.
 */
export const creatorProfileLinks = pgTable(
  'creators_profile_links',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creatorProfiles.creatorId, { onDelete: 'cascade' }),
    label: text('label'),
    position: integer('position').notNull(),
    url: text('url').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.creatorId, table.position] }),
    check(
      'creators_profile_links_position_check',
      sql`${table.position} between 0 and ${sql.raw(String(maximumCreatorLinks - 1))}`,
    ),
    // `https` only, and no credentials in the authority. The contract validates
    // the same thing by parsing; this is what stops a row that never went
    // through the contract from carrying a `javascript:` payload to a page.
    check(
      'creators_profile_links_url_check',
      sql`${table.url} like 'https://%' and ${table.url} not like '%@%' and ${lengthBetween(table.url, 'https://a'.length, maximumCreatorLinkUrlLength)}`,
    ),
    check(
      'creators_profile_links_label_check',
      sql`${table.label} is null or ${lengthBetween(table.label, 1, maximumCreatorLinkLabelLength)}`,
    ),
  ],
);
