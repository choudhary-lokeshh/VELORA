import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';

/**
 * AUTH-owned persistence. AUTH owns authentication identity, sessions, refresh
 * families, rotation evidence, recovery state, privileged authenticator
 * enrolment, and its own security events. Profile, preferences, display name,
 * and every other USERS field are deliberately absent: putting them here for
 * convenience would move ownership, which
 * `docs/architecture/03-domain-boundaries.md` forbids.
 *
 * Every lifetime written by the services on top of these tables comes from
 * ADR-0017 through `./policy.js`; no duration is chosen here.
 */

export const authAudienceValues = [
  'consumer_web',
  'creator_studio',
  'consumer_mobile',
  'platform_admin',
] as const;

export const authAssuranceValues = [
  'single_factor',
  'multi_factor',
  'phishing_resistant',
] as const;

export const authRevocationReasons = [
  'logout',
  'logout_all',
  'account_recovery',
  'privileged_recovery',
  'refresh_reuse_detected',
  'superseded',
  'administrative',
  /**
   * The person closed their account.
   *
   * Its own reason rather than `administrative`, which would record an operator
   * acting on somebody who in fact acted on themselves, and rather than
   * `logout_all`, which is a person signing other devices out of an account
   * they still hold. What actually happened is the only thing worth recording
   * here.
   */
  'account_closed',
] as const;

export const authSecurityEventTypes = [
  'authentication_succeeded',
  'authentication_failed',
  'session_created',
  'session_revoked',
  'sessions_revoked_all',
  'refresh_rotated',
  'refresh_reuse_detected',
  'refresh_family_revoked',
  'recovery_started',
  'recovery_completed',
  'recovery_rejected',
  'admin_authenticator_enrolled',
  'admin_authenticator_revoked',
  'admin_step_up_succeeded',
  'admin_step_up_failed',
  'high_impact_authorized',
  'high_impact_executed',
  'privileged_recovery_started',
  'privileged_recovery_approved',
  'privileged_recovery_completed',
] as const;

export const authAccounts = pgTable(
  'auth_accounts',
  {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /**
     * Set by account recovery and privileged recovery. ADR-0017 restricts
     * high-impact actions for a fixed window afterwards.
     */
    highImpactRestrictedUntil: timestamptz('high_impact_restricted_until'),
    highImpactRestrictionReason: text('high_impact_restriction_reason'),
    id: uuid('id').primaryKey(),
    status: text('status').notNull().default('active'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'auth_accounts_status_check',
      inList(table.status, ['active', 'locked', 'disabled']),
    ),
    check(
      'auth_accounts_restriction_pairing_check',
      nullablePairing(
        table.highImpactRestrictedUntil,
        table.highImpactRestrictionReason,
      ),
    ),
    check(
      'auth_accounts_restriction_reason_check',
      sql`${table.highImpactRestrictionReason} is null or ${inList(table.highImpactRestrictionReason, ['account_recovery', 'privileged_recovery'])}`,
    ),
  ],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    id: uuid('id').primaryKey(),
    lastAuthenticatedAt: timestamptz('last_authenticated_at'),
    /**
     * Only the development/test adapter exists. Adding a real provider is a
     * reviewed migration, not a runtime string, which is exactly the gate
     * ADR-0009 wants around identity providers.
     */
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject_uk').on(
      table.provider,
      table.providerSubject,
    ),
    index('auth_identities_account_idx').on(table.accountId),
    check('auth_identities_provider_check', inList(table.provider, ['local'])),
    check(
      'auth_identities_subject_length_check',
      sql`char_length(${table.providerSubject}) between 1 and 200`,
    ),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    absoluteExpiresAt: timestamptz('absolute_expires_at').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    assurance: text('assurance').notNull(),
    /** Reset by step-up, so assurance age is measurable per ADR-0017. */
    assuranceEstablishedAt: timestamptz('assurance_established_at').notNull(),
    audience: text('audience').notNull(),
    authenticatedAt: timestamptz('authenticated_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Server-bound CSRF secret. Only its digest is stored. */
    csrfDigest: digestColumn('csrf_digest').notNull(),
    deviceDigest: digestColumn('device_digest'),
    id: uuid('id').primaryKey(),
    idleExpiresAt: timestamptz('idle_expires_at').notNull(),
    lastActiveAt: timestamptz('last_active_at').notNull(),
    revocationReason: text('revocation_reason'),
    revokedAt: timestamptz('revoked_at'),
    tokenDigest: digestColumn('token_digest').notNull(),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_digest_uk').on(table.tokenDigest),
    index('auth_sessions_account_active_idx').on(
      table.accountId,
      table.revokedAt,
    ),
    check(
      'auth_sessions_audience_check',
      inList(table.audience, [
        'consumer_web',
        'creator_studio',
        'platform_admin',
      ]),
    ),
    check(
      'auth_sessions_assurance_check',
      inList(table.assurance, authAssuranceValues),
    ),
    check('auth_sessions_token_digest_check', isHexDigest(table.tokenDigest)),
    check('auth_sessions_csrf_digest_check', isHexDigest(table.csrfDigest)),
    check(
      'auth_sessions_device_digest_check',
      sql`${table.deviceDigest} is null or ${isHexDigest(table.deviceDigest)}`,
    ),
    check(
      'auth_sessions_revocation_pairing_check',
      nullablePairing(table.revokedAt, table.revocationReason),
    ),
    check(
      'auth_sessions_revocation_reason_check',
      sql`${table.revocationReason} is null or ${inList(table.revocationReason, authRevocationReasons)}`,
    ),
    check(
      'auth_sessions_absolute_after_creation_check',
      sql`${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'auth_sessions_idle_after_creation_check',
      sql`${table.idleExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'auth_sessions_idle_within_absolute_check',
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

export const authRefreshFamilies = pgTable(
  'auth_refresh_families',
  {
    absoluteExpiresAt: timestamptz('absolute_expires_at').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    assurance: text('assurance').notNull(),
    assuranceEstablishedAt: timestamptz('assurance_established_at').notNull(),
    audience: text('audience').notNull(),
    authenticatedAt: timestamptz('authenticated_at').notNull(),
    compromisedAt: timestamptz('compromised_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    deviceDigest: digestColumn('device_digest'),
    id: uuid('id').primaryKey(),
    idleExpiresAt: timestamptz('idle_expires_at').notNull(),
    /** Binds the family to one application installation, per ADR-0017. */
    installationId: text('installation_id').notNull(),
    lastUsedAt: timestamptz('last_used_at').notNull(),
    revocationReason: text('revocation_reason'),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    // At most one live family per installation. Re-authentication supersedes
    // the previous family inside one transaction rather than leaving two.
    uniqueIndex('auth_refresh_families_active_installation_uk')
      .on(table.accountId, table.installationId)
      .where(sql`${table.revokedAt} is null`),
    index('auth_refresh_families_account_idx').on(table.accountId),
    check(
      'auth_refresh_families_audience_check',
      inList(table.audience, ['consumer_mobile']),
    ),
    check(
      'auth_refresh_families_assurance_check',
      inList(table.assurance, authAssuranceValues),
    ),
    check(
      'auth_refresh_families_installation_length_check',
      sql`char_length(${table.installationId}) between 8 and 128`,
    ),
    check(
      'auth_refresh_families_device_digest_check',
      sql`${table.deviceDigest} is null or ${isHexDigest(table.deviceDigest)}`,
    ),
    check(
      'auth_refresh_families_revocation_pairing_check',
      nullablePairing(table.revokedAt, table.revocationReason),
    ),
    check(
      'auth_refresh_families_revocation_reason_check',
      sql`${table.revocationReason} is null or ${inList(table.revocationReason, authRevocationReasons)}`,
    ),
    // A compromised family is always a revoked family. There is no state in
    // which reuse was detected and the family still authenticates.
    check(
      'auth_refresh_families_compromise_implies_revoked_check',
      sql`${table.compromisedAt} is null or ${table.revokedAt} is not null`,
    ),
    check(
      'auth_refresh_families_absolute_after_creation_check',
      sql`${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'auth_refresh_families_idle_within_absolute_check',
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

/**
 * Rotation evidence. Rows are never deleted while their family exists, because
 * replay detection is exactly the ability to recognise a token that was already
 * consumed. The partial unique index below is the database-level statement that
 * a family has at most one live descendant.
 */
export const authRefreshTokens = pgTable(
  'auth_refresh_tokens',
  {
    consumedAt: timestamptz('consumed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => authRefreshFamilies.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    id: uuid('id').primaryKey(),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => authRefreshTokens.id,
      { onDelete: 'set null' },
    ),
    tokenDigest: digestColumn('token_digest').notNull(),
  },
  (table) => [
    uniqueIndex('auth_refresh_tokens_token_digest_uk').on(table.tokenDigest),
    uniqueIndex('auth_refresh_tokens_family_generation_uk').on(
      table.familyId,
      table.generation,
    ),
    uniqueIndex('auth_refresh_tokens_live_family_uk')
      .on(table.familyId)
      .where(sql`${table.consumedAt} is null`),
    check(
      'auth_refresh_tokens_token_digest_check',
      isHexDigest(table.tokenDigest),
    ),
    check(
      'auth_refresh_tokens_generation_check',
      sql`${table.generation} >= 0`,
    ),
    check(
      'auth_refresh_tokens_replacement_requires_consumption_check',
      sql`${table.replacedById} is null or ${table.consumedAt} is not null`,
    ),
  ],
);

export const authSecurityEvents = pgTable(
  'auth_security_events',
  {
    /** Null when authentication failed before an account could be identified. */
    accountId: uuid('account_id').references(() => authAccounts.id, {
      onDelete: 'cascade',
    }),
    audience: text('audience'),
    correlationId: text('correlation_id').notNull(),
    eventType: text('event_type').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    /** An enumerated reason. There is no free-form payload to leak into. */
    reason: text('reason'),
    refreshFamilyId: uuid('refresh_family_id').references(
      () => authRefreshFamilies.id,
      { onDelete: 'set null' },
    ),
    sessionId: uuid('session_id').references(() => authSessions.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('auth_security_events_account_idx').on(
      table.accountId,
      table.occurredAt,
    ),
    index('auth_security_events_type_idx').on(
      table.eventType,
      table.occurredAt,
    ),
    check(
      'auth_security_events_type_check',
      inList(table.eventType, authSecurityEventTypes),
    ),
    check(
      'auth_security_events_audience_check',
      sql`${table.audience} is null or ${inList(table.audience, authAudienceValues)}`,
    ),
    check(
      'auth_security_events_correlation_length_check',
      sql`char_length(${table.correlationId}) between 1 and 128`,
    ),
    check(
      'auth_security_events_reason_length_check',
      sql`${table.reason} is null or char_length(${table.reason}) between 1 and 64`,
    ),
  ],
);

/**
 * Devices that have completed an authentication for the account. Recovery from
 * a device that is not on this list is high risk, which is the deterministic
 * seam a future risk engine replaces.
 */
export const authKnownDevices = pgTable(
  'auth_known_devices',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    deviceDigest: digestColumn('device_digest').notNull(),
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
    id: uuid('id').primaryKey(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_known_devices_account_device_uk').on(
      table.accountId,
      table.deviceDigest,
    ),
    check(
      'auth_known_devices_device_digest_check',
      isHexDigest(table.deviceDigest),
    ),
  ],
);

export const authRecoveryRequests = pgTable(
  'auth_recovery_requests',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    consumedAt: timestamptz('consumed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Digest of the delivery destination, never the destination itself. */
    destinationDigest: digestColumn('destination_digest').notNull(),
    deviceDigest: digestColumn('device_digest'),
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    invalidatedAt: timestamptz('invalidated_at'),
    invalidationReason: text('invalidation_reason'),
    riskLevel: text('risk_level').notNull(),
    tokenDigest: digestColumn('token_digest').notNull(),
  },
  (table) => [
    uniqueIndex('auth_recovery_requests_token_digest_uk').on(table.tokenDigest),
    index('auth_recovery_requests_account_idx').on(
      table.accountId,
      table.createdAt,
    ),
    check(
      'auth_recovery_requests_channel_check',
      inList(table.channel, ['email', 'passkey', 'recovery_code', 'support']),
    ),
    check(
      'auth_recovery_requests_risk_check',
      inList(table.riskLevel, ['standard', 'high']),
    ),
    check(
      'auth_recovery_requests_token_digest_check',
      isHexDigest(table.tokenDigest),
    ),
    check(
      'auth_recovery_requests_destination_digest_check',
      isHexDigest(table.destinationDigest),
    ),
    check(
      'auth_recovery_requests_device_digest_check',
      sql`${table.deviceDigest} is null or ${isHexDigest(table.deviceDigest)}`,
    ),
    check(
      'auth_recovery_requests_invalidation_pairing_check',
      nullablePairing(table.invalidatedAt, table.invalidationReason),
    ),
    check(
      'auth_recovery_requests_expiry_after_creation_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

/**
 * Rate-limit evidence for recovery. It carries no account reference on purpose:
 * a request for an address with no account must be counted exactly like one for
 * an address that has an account, or the per-requester limit itself discloses
 * account existence.
 */
export const authRecoveryRateEvents = pgTable(
  'auth_recovery_rate_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    scope: text('scope').notNull(),
    scopeDigest: digestColumn('scope_digest').notNull(),
  },
  (table) => [
    index('auth_recovery_rate_events_scope_idx').on(
      table.scope,
      table.scopeDigest,
      table.occurredAt,
    ),
    check(
      'auth_recovery_rate_events_scope_check',
      inList(table.scope, ['account', 'destination', 'requester']),
    ),
    check(
      'auth_recovery_rate_events_digest_check',
      isHexDigest(table.scopeDigest),
    ),
  ],
);

/**
 * Enrolled phishing-resistant authenticators for privileged access. Only public
 * credential material is stored; there is no shared secret to leak. Verification
 * itself lives behind a provider-neutral port and has no approved implementation
 * yet.
 */
export const authAdminAuthenticators = pgTable(
  'auth_admin_authenticators',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    attachment: text('attachment'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    credentialId: text('credential_id').notNull(),
    id: uuid('id').primaryKey(),
    label: text('label').notNull(),
    lastUsedAt: timestamptz('last_used_at'),
    publicKey: text('public_key').notNull(),
    revocationReason: text('revocation_reason'),
    revokedAt: timestamptz('revoked_at'),
    signCount: integer('sign_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('auth_admin_authenticators_credential_uk').on(
      table.credentialId,
    ),
    index('auth_admin_authenticators_account_idx').on(table.accountId),
    check(
      'auth_admin_authenticators_attachment_check',
      sql`${table.attachment} is null or ${inList(table.attachment, ['platform', 'cross_platform'])}`,
    ),
    check(
      'auth_admin_authenticators_label_length_check',
      sql`char_length(${table.label}) between 1 and 64`,
    ),
    check(
      'auth_admin_authenticators_sign_count_check',
      sql`${table.signCount} >= 0`,
    ),
    check(
      'auth_admin_authenticators_revocation_pairing_check',
      nullablePairing(table.revokedAt, table.revocationReason),
    ),
  ],
);

/** Preauthorized privileged-recovery approvers. Two are required to complete. */
export const authSecurityOwners = pgTable(
  'auth_security_owners',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    designatedAt: timestamptz('designated_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
  },
  () => [],
);

export const authPrivilegedRecoveryRequests = pgTable(
  'auth_privileged_recovery_requests',
  {
    completedAt: timestamptz('completed_at'),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    initiatedByAccountId: uuid('initiated_by_account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    rejectedAt: timestamptz('rejected_at'),
    status: text('status').notNull(),
    targetAccountId: uuid('target_account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('auth_privileged_recovery_requests_target_idx').on(
      table.targetAccountId,
      table.createdAt,
    ),
    check(
      'auth_privileged_recovery_requests_status_check',
      inList(table.status, ['pending', 'completed', 'rejected', 'expired']),
    ),
    check(
      'auth_privileged_recovery_requests_reason_length_check',
      sql`char_length(${table.reason}) between 1 and 500`,
    ),
    check(
      'auth_privileged_recovery_requests_expiry_after_creation_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'auth_privileged_recovery_requests_completion_status_check',
      sql`(${table.completedAt} is null) or (${table.status} = 'completed')`,
    ),
  ],
);

export const authPrivilegedRecoveryApprovals = pgTable(
  'auth_privileged_recovery_approvals',
  {
    approvedAt: timestamptz('approved_at').notNull().defaultNow(),
    approverAccountId: uuid('approver_account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => authPrivilegedRecoveryRequests.id, {
        onDelete: 'cascade',
      }),
  },
  (table) => [
    // One approver counts once. Dual control cannot be satisfied by one person
    // approving twice.
    uniqueIndex('auth_privileged_recovery_approvals_unique_approver_uk').on(
      table.requestId,
      table.approverAccountId,
    ),
  ],
);

/**
 * Exact-action authorization for a high-impact operation. Everything ADR-0017
 * requires an approval to bind is a column, so a stored authorization can only
 * ever match one operation against one target with one argument set and one
 * expected effect.
 */
export const authHighImpactAuthorizations = pgTable(
  'auth_high_impact_authorizations',
  {
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => authAccounts.id, { onDelete: 'cascade' }),
    actorSessionId: uuid('actor_session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    approvedAt: timestamptz('approved_at'),
    approverAccountId: uuid('approver_account_id').references(
      () => authAccounts.id,
      { onDelete: 'set null' },
    ),
    argumentDigest: digestColumn('argument_digest').notNull(),
    assurance: text('assurance').notNull(),
    authorizedAt: timestamptz('authorized_at').notNull().defaultNow(),
    beforeStateDigest: digestColumn('before_state_digest').notNull(),
    consumedAt: timestamptz('consumed_at'),
    correlationId: text('correlation_id').notNull(),
    expectedEffectDigest: digestColumn('expected_effect_digest').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    operation: text('operation').notNull(),
    targetId: text('target_id').notNull(),
    targetType: text('target_type').notNull(),
  },
  (table) => [
    index('auth_high_impact_authorizations_actor_idx').on(
      table.actorAccountId,
      table.authorizedAt,
    ),
    index('auth_high_impact_authorizations_target_idx').on(
      table.targetType,
      table.targetId,
      table.authorizedAt,
    ),
    check(
      'auth_high_impact_authorizations_assurance_check',
      inList(table.assurance, authAssuranceValues),
    ),
    check(
      'auth_high_impact_authorizations_argument_digest_check',
      isHexDigest(table.argumentDigest),
    ),
    check(
      'auth_high_impact_authorizations_before_digest_check',
      isHexDigest(table.beforeStateDigest),
    ),
    check(
      'auth_high_impact_authorizations_effect_digest_check',
      isHexDigest(table.expectedEffectDigest),
    ),
    check(
      'auth_high_impact_authorizations_approval_pairing_check',
      nullablePairing(table.approverAccountId, table.approvedAt),
    ),
    check(
      'auth_high_impact_authorizations_expiry_after_authorization_check',
      sql`${table.expiresAt} > ${table.authorizedAt}`,
    ),
  ],
);
