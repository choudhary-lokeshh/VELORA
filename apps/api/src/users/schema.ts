import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  lengthBetween,
  timestamptz,
} from '../database/columns.js';
import {
  acceptedProfileMediaTypes,
  languagePattern,
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileMedia,
  maximumProfileMediaBytes,
  minimumDisplayNameLength,
  type ProfileMediaContentType,
} from './profile-policy.js';

/**
 * USERS-owned persistence. USERS owns the consumer account, its lifecycle
 * state, and the minimal locale/region metadata other consumer domains need.
 *
 * It deliberately owns no credential, session, refresh, recovery, or
 * authenticator state: those belong to AUTH, and
 * `docs/architecture/03-domain-boundaries.md` forbids a second writer. The link
 * to AUTH is one opaque account identifier and nothing else.
 *
 * There is intentionally no database foreign key to `auth_accounts`. Data
 * ownership requires cross-domain references to be stable identifiers rather
 * than shared schema, and an `on delete cascade` from AUTH would let identity
 * removal silently erase consumer state that `docs/flows/account-deletion.md`
 * says USERS must coordinate. The uniqueness that matters — one consumer
 * account per AUTH account — is enforced here, where USERS owns it.
 */

/**
 * `docs/flows/consumer-account-profile.md` fixes this ladder:
 * `pending_profile -> active/restricted -> deletion_pending -> deactivated ->
 * erased`.
 */
export const userAccountStatuses = [
  'pending_profile',
  'active',
  'restricted',
  'deletion_pending',
  'deactivated',
  'erased',
] as const;
export type UserAccountStatus = (typeof userAccountStatuses)[number];

/**
 * Why an account is not active. The vocabulary is closed and deliberately
 * coarse: a peer must never learn another user's restriction cause, so nothing
 * finer than this ever leaves the domain, and internal detail stays with the
 * domain that owns it.
 */
export const userAccountStatusReasons = [
  'onboarding_incomplete',
  'eligibility_failed',
  'safety_enforcement',
  'user_requested',
] as const;
export type UserAccountStatusReason = (typeof userAccountStatusReasons)[number];

export const userAccounts = pgTable(
  'users_accounts',
  {
    /** Opaque AUTH account reference. One consumer account per AUTH account. */
    authAccountId: uuid('auth_account_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    deletionRequestedAt: timestamptz('deletion_requested_at'),
    id: uuid('id').primaryKey(),
    /** BCP 47 language, optionally with a region subtag. Used for rendering. */
    locale: text('locale'),
    /** ISO 3166-1 alpha-2. Set during onboarding; never inferred from a header. */
    region: text('region'),
    status: text('status').notNull(),
    statusChangedAt: timestamptz('status_changed_at').notNull(),
    statusReason: text('status_reason'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_accounts_auth_account_uk').on(table.authAccountId),
    index('users_accounts_status_idx').on(table.status),
    check(
      'users_accounts_status_check',
      inList(table.status, userAccountStatuses),
    ),
    check(
      'users_accounts_status_reason_check',
      sql`${table.statusReason} is null or ${inList(table.statusReason, userAccountStatusReasons)}`,
    ),
    // A restriction with no recorded cause cannot be reviewed or lifted, so the
    // database refuses one.
    check(
      'users_accounts_restriction_requires_reason_check',
      sql`${table.status} <> 'restricted' or ${table.statusReason} is not null`,
    ),
    // Deletion states exist only as the result of a recorded request.
    check(
      'users_accounts_deletion_requires_request_check',
      sql`${table.status} not in ('deletion_pending', 'deactivated', 'erased') or ${table.deletionRequestedAt} is not null`,
    ),
    check(
      'users_accounts_region_check',
      sql`${table.region} is null or ${table.region} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'users_accounts_locale_check',
      sql`${table.locale} is null or ${table.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`,
    ),
    check(
      'users_accounts_status_changed_after_creation_check',
      sql`${table.statusChangedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Policy documents a consumer must acknowledge before the account is admitted.
 * The key vocabulary is closed; the version each key currently requires is
 * application policy and lives in `./onboarding-policy.ts`.
 */
export const consumerPolicyKeys = [
  'terms_of_service',
  'privacy_notice',
] as const;
export type ConsumerPolicyKey = (typeof consumerPolicyKeys)[number];

/**
 * Append-only acknowledgement evidence.
 *
 * Rows are never updated and never deleted while the account exists. A new
 * policy version produces a new row, so the record of what a person actually
 * agreed to, and when, survives every later republication. The unique index
 * makes a repeated acknowledgement of the same version a no-op rather than a
 * second, contradictory piece of evidence.
 */
export const userPolicyAcknowledgements = pgTable(
  'users_policy_acknowledgements',
  {
    acknowledgedAt: timestamptz('acknowledged_at').notNull().defaultNow(),
    /** Which consumer surface the person was using. Never a client assertion. */
    audience: text('audience').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    policyKey: text('policy_key').notNull(),
    policyVersion: text('policy_version').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('users_policy_acknowledgements_unique_version_uk').on(
      table.userId,
      table.policyKey,
      table.policyVersion,
    ),
    check(
      'users_policy_acknowledgements_key_check',
      inList(table.policyKey, consumerPolicyKeys),
    ),
    check(
      'users_policy_acknowledgements_audience_check',
      inList(table.audience, ['consumer_web', 'consumer_mobile']),
    ),
    check(
      'users_policy_acknowledgements_version_length_check',
      lengthBetween(table.policyVersion, 1, 32),
    ),
  ],
);

/**
 * Assurance classes, kept deliberately distinct.
 *
 * `docs/compliance/02-adult-age-verification.md` forbids treating a declaration,
 * a verified adult check, an identity proof, and creator verification as
 * interchangeable. Only the first two exist today; the others get their own
 * values when their owning domain implements them, never by widening one of
 * these.
 */
export const adultAssuranceClasses = [
  'self_declared',
  'verified_adult',
] as const;
export type AdultAssuranceClass = (typeof adultAssuranceClasses)[number];

/**
 * Normalized outcomes an assurance method may report. An ambiguous provider
 * answer is `pending` or `review`; it is never assumed adult-eligible.
 */
export const adultAssuranceOutcomes = [
  'passed',
  'failed',
  'pending',
  'review',
  'revoked',
] as const;
export type AdultAssuranceOutcome = (typeof adultAssuranceOutcomes)[number];

/**
 * Append-only adult assurance evidence.
 *
 * The current assurance is the most recent row, which is why the identifier is
 * a sequence: it gives a total order even when two assessments share a
 * timestamp. Nothing overwrites a prior assessment, so a later failure or
 * revocation is visible as its own event rather than as the absence of an
 * earlier pass.
 *
 * Raw evidence is never stored. `evidenceReference` is an opaque digest a
 * provider adapter can use to locate its own record; a document, selfie, or
 * birth date has no column here at all.
 */
export const userAdultAssurances = pgTable(
  'users_adult_assurances',
  {
    assuranceClass: text('assurance_class').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at').notNull(),
    evidenceReference: digestColumn('evidence_reference'),
    expiresAt: timestamptz('expires_at'),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** The adapter that produced the outcome, for audit and recheck routing. */
    method: text('method').notNull(),
    outcome: text('outcome').notNull(),
    /** Version of the eligibility policy the outcome was evaluated against. */
    policyVersion: text('policy_version').notNull(),
    /** Declared at the gate, because adult age is a country-dependent rule. */
    region: text('region'),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('users_adult_assurances_user_idx').on(table.userId, table.id),
    check(
      'users_adult_assurances_class_check',
      inList(table.assuranceClass, adultAssuranceClasses),
    ),
    check(
      'users_adult_assurances_outcome_check',
      inList(table.outcome, adultAssuranceOutcomes),
    ),
    check(
      'users_adult_assurances_method_length_check',
      lengthBetween(table.method, 1, 64),
    ),
    check(
      'users_adult_assurances_policy_version_length_check',
      lengthBetween(table.policyVersion, 1, 32),
    ),
    check(
      'users_adult_assurances_region_check',
      sql`${table.region} is null or ${table.region} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'users_adult_assurances_evidence_check',
      sql`${table.evidenceReference} is null or ${isHexDigest(table.evidenceReference)}`,
    ),
    check(
      'users_adult_assurances_expiry_after_decision_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.decidedAt}`,
    ),
    // A self-declaration is the weakest class and can never carry an expiry a
    // stronger method would need, nor provider evidence it never produced.
    check(
      'users_adult_assurances_self_declaration_shape_check',
      sql`${table.assuranceClass} <> 'self_declared' or ${table.evidenceReference} is null`,
    ),
  ],
);

/**
 * The consumer profile.
 *
 * One row per account, holding only what the approved V1 policy asks for: a
 * display name, an optional bio, and the version that makes concurrent edits
 * resolvable. Languages and images are separate tables because discovery reads
 * them as sets, and a set stored in a column cannot be indexed or joined
 * without rewriting the whole profile row.
 *
 * A consumer profile is not a public page. Nothing here is served to an
 * unauthenticated caller, and the visibility rules that decide which
 * authenticated caller may see it live in the domains that own the
 * relationship, never as a column here.
 */
export const userProfiles = pgTable(
  'users_profiles',
  {
    bio: text('bio'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    displayName: text('display_name').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    userId: uuid('user_id')
      .primaryKey()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    /** Optimistic concurrency. Every accepted edit advances it by exactly one. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check(
      'users_profiles_display_name_length_check',
      lengthBetween(
        table.displayName,
        minimumDisplayNameLength,
        maximumDisplayNameLength,
      ),
    ),
    // No control characters, and no leading or trailing whitespace: two names
    // that render identically must not be storable as different values.
    check(
      'users_profiles_display_name_shape_check',
      sql`${table.displayName} !~ '[[:cntrl:]]' and btrim(${table.displayName}) = ${table.displayName}`,
    ),
    check(
      'users_profiles_bio_length_check',
      sql`${table.bio} is null or char_length(${table.bio}) <= ${sql.raw(String(maximumBioLength))}`,
    ),
    check('users_profiles_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * Languages a profile speaks.
 *
 * A row per language rather than an array column, because discovery ranks on
 * language overlap and that is a join, not a scan. The secondary index is
 * ordered language-first for exactly that query.
 */
export const userProfileLanguages = pgTable(
  'users_profile_languages',
  {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    language: text('language').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.language] }),
    index('users_profile_languages_language_idx').on(
      table.language,
      table.userId,
    ),
    check(
      'users_profile_languages_shape_check',
      sql`${table.language} ~ ${sql.raw(`'${languagePattern.source}'`)}`,
    ),
  ],
);

/**
 * Profile image lifecycle.
 *
 * `pending_upload -> ready | rejected`, and any state may be `removed` by its
 * owner. The transition to `ready` is the platform's own decision after the
 * stored bytes have been inspected, never something a client asserts, which is
 * what `docs/security/04-media-upload-delivery.md` requires.
 */
export const profileMediaStates = [
  'pending_upload',
  'ready',
  'rejected',
  'removed',
] as const;
export type ProfileMediaState = (typeof profileMediaStates)[number];

/**
 * Why an object was refused. Coarse and closed: it is shown to the object's own
 * uploader so a person can fix a bad file, and it never carries adapter or
 * scanner internals.
 */
export const profileMediaRejectionReasons = [
  'unsupported_type',
  'too_large',
  'not_uploaded',
  'content_rejected',
] as const;
export type ProfileMediaRejectionReason =
  (typeof profileMediaRejectionReasons)[number];

/**
 * Profile media objects.
 *
 * The row is the platform's record; the bytes live behind a storage adapter and
 * are addressed only by `storage_key`. There is no public URL column, because a
 * durable public address for consumer media is exactly what the media security
 * policy forbids: delivery is authorized per request and signed per request.
 */
export const userProfileMedia = pgTable(
  'users_profile_media',
  {
    /** Byte length of the stored object, measured by the platform. */
    byteSize: integer('byte_size'),
    checksum: digestColumn('checksum'),
    /** Sniffed from the object's own bytes. A client's claim is never stored. */
    contentType: text('content_type').$type<ProfileMediaContentType>(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    id: uuid('id').primaryKey(),
    /** Dense zero-based slot, unique per account while the object is not removed. */
    position: integer('position').notNull(),
    readyAt: timestamptz('ready_at'),
    rejectionReason:
      text('rejection_reason').$type<ProfileMediaRejectionReason>(),
    state: text('state').notNull().$type<ProfileMediaState>(),
    stateChangedAt: timestamptz('state_changed_at').notNull(),
    /** Opaque adapter-scoped object key. Never rendered to any client. */
    storageKey: text('storage_key').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** After this instant the upload capability is spent, used or not. */
    uploadExpiresAt: timestamptz('upload_expires_at').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('users_profile_media_storage_key_uk').on(table.storageKey),
    // Only live objects occupy a slot, so removing an image frees its position
    // without renumbering anything and without losing the removed record.
    uniqueIndex('users_profile_media_position_uk')
      .on(table.userId, table.position)
      .where(sql`${table.state} <> 'removed'`),
    index('users_profile_media_user_state_idx').on(table.userId, table.state),
    check(
      'users_profile_media_state_check',
      inList(table.state, profileMediaStates),
    ),
    check(
      'users_profile_media_position_check',
      sql`${table.position} between 0 and ${sql.raw(String(maximumProfileMedia - 1))}`,
    ),
    check(
      'users_profile_media_content_type_check',
      sql`${table.contentType} is null or ${inList(table.contentType, acceptedProfileMediaTypes)}`,
    ),
    check(
      'users_profile_media_byte_size_check',
      sql`${table.byteSize} is null or (${table.byteSize} > 0 and ${table.byteSize} <= ${sql.raw(String(maximumProfileMediaBytes))})`,
    ),
    check(
      'users_profile_media_checksum_check',
      sql`${table.checksum} is null or ${isHexDigest(table.checksum)}`,
    ),
    // A usable image is one the platform has actually measured. The database
    // refuses a `ready` row that never passed inspection.
    check(
      'users_profile_media_ready_shape_check',
      sql`${table.state} <> 'ready' or (${table.byteSize} is not null and ${table.contentType} is not null and ${table.checksum} is not null and ${table.readyAt} is not null)`,
    ),
    check(
      'users_profile_media_rejection_shape_check',
      sql`(${table.state} = 'rejected') = (${table.rejectionReason} is not null)`,
    ),
    check(
      'users_profile_media_rejection_reason_check',
      sql`${table.rejectionReason} is null or ${inList(table.rejectionReason, profileMediaRejectionReasons)}`,
    ),
  ],
);

/**
 * Self-managed consumer preferences.
 *
 * Discoverability is off until the person turns it on. That is the approved V1
 * default and it is expressed as `not null default false` rather than as
 * application logic, so an account can never become visible because a code path
 * forgot to set it.
 *
 * It is deliberately separate from availability: this is a durable choice about
 * whether the account participates in discovery at all, not a statement about
 * right now.
 */
export const userPreferences = pgTable(
  'users_preferences',
  {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    discoverable: boolean('discoverable').notNull().default(false),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    userId: uuid('user_id')
      .primaryKey()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check('users_preferences_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * Availability, as `docs/flows/consumer-account-profile.md` defines it: a
 * user-managed, bounded preference. It is not presence, not consent to contact,
 * not a promise of appearing in discovery, and never an override of a block or
 * an enforcement decision.
 *
 * Unlike the profile, this row carries no expected version. A profile edit is a
 * document two devices could each have meaningfully authored, so a conflict must
 * be reported; availability is a switch, and the honest answer to two devices
 * flipping it at once is that the last one wins and both then read the same
 * state. `revision` records how many times it moved, so a client can tell its
 * own write from somebody else's.
 */
export const availabilityStates = ['available', 'unavailable'] as const;
export type AvailabilityState = (typeof availabilityStates)[number];

export const userAvailability = pgTable(
  'users_availability',
  {
    /**
     * When the current availability session began.
     *
     * Distinct from `updatedAt` on purpose. `updatedAt` moves every time the row
     * is written — extending a window, toggling a preference, any repeat of the
     * same answer — whereas this only moves when a closed availability actually
     * opens again. Discovery ranks on availability recency, and ranking on a
     * value that changes whenever somebody re-saves the same state would move
     * that person through everybody else's results for no reason a reader could
     * observe. Ranking on the session start keeps a candidate's position fixed
     * for as long as they stay available, which is what makes forward-only
     * paging safe. See `docs/domains/discovery.md`.
     */
    availableSince: timestamptz('available_since'),
    /** When the window closes. Always set while available, never otherwise. */
    availableUntil: timestamptz('available_until'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(1),
    state: text('state').notNull().$type<AvailabilityState>(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    userId: uuid('user_id')
      .primaryKey()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    // Discovery filters on the open window, so the index is ordered by it.
    index('users_availability_open_window_idx').on(
      table.availableUntil,
      table.userId,
    ),
    check(
      'users_availability_state_check',
      inList(table.state, availabilityStates),
    ),
    // An availability with no end would be a presence claim the server cannot
    // support, and an end with no availability describes nothing.
    check(
      'users_availability_window_shape_check',
      sql`(${table.state} = 'available') = (${table.availableUntil} is not null)`,
    ),
    // A session start exists exactly while a session does.
    check(
      'users_availability_session_shape_check',
      sql`(${table.state} = 'available') = (${table.availableSince} is not null)`,
    ),
    check('users_availability_revision_check', sql`${table.revision} >= 1`),
  ],
);
