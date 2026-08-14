import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';

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
