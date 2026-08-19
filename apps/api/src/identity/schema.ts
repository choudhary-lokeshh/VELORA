import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  lengthBetween,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import { outboxTable } from '../events/outbox-table.js';
import {
  activeIdentityAttemptStates,
  identityAttemptStates,
  identityCodePattern,
  identityEvidenceClasses,
  identityEvidenceResults,
  identityOwnerDomains,
  identityProviderEventStates,
  identityPurposes,
  reconciliationIdentityAttemptStates,
  identityReconciliationKinds,
  identityReconciliationStates,
  jurisdictionCodePattern,
  maximumIdentityFailureCodeLength,
  maximumIdentityIdempotencyKeyLength,
  maximumIdentityLeaseOwnerLength,
  maximumIdentityProviderEventIdLength,
  maximumIdentityProviderEventTypeLength,
  maximumIdentityProviderReferenceLength,
  terminalIdentityAttemptStates,
  type IdentityAttemptState,
  type IdentityEvidenceClass,
  type IdentityEvidenceResult,
  type IdentityOwnerDomain,
  type IdentityProviderEventState,
  type IdentityPurpose,
  type IdentityReconciliationKind,
  type IdentityReconciliationState,
} from './policy.js';

function literals(values: readonly string[]): string {
  return values
    .map((value) => {
      if (!/^[a-z0-9][a-z0-9_]*$/u.test(value)) {
        throw new Error(`Unsafe enumerated constraint value: ${value}`);
      }
      return `'${value}'`;
    })
    .join(', ');
}

/**
 * Opaque link to one owner-domain entity. IDENTITY never joins this reference
 * to another domain's private table and never treats it as authentication.
 */
export const identitySubjects = pgTable(
  'identity_subjects',
  {
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    ownerDomain: text('owner_domain').notNull().$type<IdentityOwnerDomain>(),
    ownerReference: uuid('owner_reference').notNull(),
  },
  (table) => [
    uniqueIndex('identity_subjects_owner_uk').on(
      table.ownerDomain,
      table.ownerReference,
    ),
    check(
      'identity_subjects_owner_domain_check',
      inList(table.ownerDomain, identityOwnerDomains),
    ),
  ],
);

/**
 * Durable external-operation identity. Provider I/O happens only after this
 * row commits; ambiguous results are recovered through provider idempotency.
 */
export const identityAttempts = pgTable(
  'identity_attempts',
  {
    callerIdempotencyKey: text('caller_idempotency_key').notNull(),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    inputDigest: digestColumn('input_digest').notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    policyVersion: text('policy_version').notNull(),
    provider: text('provider').notNull(),
    providerBoundAt: timestamptz('provider_bound_at'),
    providerIdempotencyKey: text('provider_idempotency_key').notNull(),
    providerReference: text('provider_reference'),
    purpose: text('purpose').notNull().$type<IdentityPurpose>(),
    /** Scheduling marker only; it never changes lifecycle or evidence truth. */
    reconciliationCheckedAt: timestamptz('reconciliation_checked_at'),
    requiredEvidenceClass: text('required_evidence_class')
      .notNull()
      .$type<IdentityEvidenceClass>(),
    requiredThreshold: text('required_threshold').notNull(),
    /** Durable total order; timestamps and random UUIDs can tie. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<IdentityAttemptState>(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => identitySubjects.id, {
        onDelete: 'no action',
        onUpdate: 'no action',
      }),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('identity_attempts_idempotency_uk').on(
      table.subjectId,
      table.purpose,
      table.callerIdempotencyKey,
    ),
    uniqueIndex('identity_attempts_provider_idempotency_uk').on(
      table.provider,
      table.providerIdempotencyKey,
    ),
    uniqueIndex('identity_attempts_provider_reference_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    uniqueIndex('identity_attempts_sequence_uk').on(table.sequence),
    uniqueIndex('identity_attempts_active_uk')
      .on(table.subjectId, table.purpose)
      .where(
        sql`${table.state} in (${sql.raw(literals(activeIdentityAttemptStates))})`,
      ),
    // Composite target used by evidence so one attempt cannot issue evidence
    // for another subject or a class it was not authorized to establish.
    uniqueIndex('identity_attempts_evidence_identity_uk').on(
      table.id,
      table.subjectId,
      table.requiredEvidenceClass,
    ),
    index('identity_attempts_subject_history_idx').on(
      table.subjectId,
      table.purpose,
      table.sequence,
    ),
    index('identity_attempts_recovery_idx')
      .on(table.updatedAt, table.id)
      .where(
        sql`${table.state} in (${sql.raw(literals(activeIdentityAttemptStates))})`,
      ),
    index('identity_attempts_reconciliation_idx')
      .on(table.reconciliationCheckedAt.nullsFirst(), table.id)
      .where(
        sql`${table.state} in (${sql.raw(literals(reconciliationIdentityAttemptStates))})`,
      ),
    check(
      'identity_attempts_purpose_check',
      inList(table.purpose, identityPurposes),
    ),
    check(
      'identity_attempts_evidence_class_check',
      inList(table.requiredEvidenceClass, identityEvidenceClasses),
    ),
    check(
      'identity_attempts_state_check',
      inList(table.state, identityAttemptStates),
    ),
    check(
      'identity_attempts_input_digest_check',
      isHexDigest(table.inputDigest),
    ),
    check(
      'identity_attempts_jurisdiction_check',
      sql`${table.jurisdiction} ~ ${sql.raw(`'${jurisdictionCodePattern}'`)}`,
    ),
    check(
      'identity_attempts_policy_version_check',
      sql`${table.policyVersion} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_attempts_provider_check',
      sql`${table.provider} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_attempts_threshold_check',
      sql`${table.requiredThreshold} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_attempts_caller_idempotency_check',
      lengthBetween(
        table.callerIdempotencyKey,
        8,
        maximumIdentityIdempotencyKeyLength,
      ),
    ),
    check(
      'identity_attempts_provider_idempotency_check',
      lengthBetween(
        table.providerIdempotencyKey,
        8,
        maximumIdentityIdempotencyKeyLength,
      ),
    ),
    check(
      'identity_attempts_provider_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(
        table.providerReference,
        1,
        maximumIdentityProviderReferenceLength,
      )}`,
    ),
    check(
      'identity_attempts_provider_binding_check',
      nullablePairing(table.providerReference, table.providerBoundAt),
    ),
    check(
      'identity_attempts_completion_check',
      sql`(${table.state} in (${sql.raw(literals(terminalIdentityAttemptStates))})) = (${table.completedAt} is not null)`,
    ),
    check(
      'identity_attempts_time_order_check',
      sql`${table.updatedAt} >= ${table.createdAt}
        and (${table.providerBoundAt} is null or ${table.providerBoundAt} >= ${table.createdAt})
        and (${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt})`,
    ),
  ],
);

/**
 * Immutable evidence fact. Current state is derived from the one-successor
 * chain; no grant, refusal, revocation, or expiry rewrites an older row.
 */
export const identityEvidence = pgTable(
  'identity_evidence',
  {
    attemptId: uuid('attempt_id').notNull(),
    effectiveAt: timestamptz('effective_at').notNull(),
    evidenceClass: text('evidence_class')
      .notNull()
      .$type<IdentityEvidenceClass>(),
    expiresAt: timestamptz('expires_at'),
    id: uuid('id').primaryKey(),
    normalizedResult: text('normalized_result')
      .notNull()
      .$type<IdentityEvidenceResult>(),
    policyVersion: text('policy_version').notNull(),
    provider: text('provider').notNull(),
    providerFactReference: text('provider_fact_reference').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => identitySubjects.id, {
        onDelete: 'no action',
        onUpdate: 'no action',
      }),
    supersedesId: uuid('supersedes_id'),
    thresholdContext: text('threshold_context').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.attemptId, table.subjectId, table.evidenceClass],
      foreignColumns: [
        identityAttempts.id,
        identityAttempts.subjectId,
        identityAttempts.requiredEvidenceClass,
      ],
      name: 'identity_evidence_attempt_identity_fk',
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      columns: [table.supersedesId, table.subjectId, table.evidenceClass],
      foreignColumns: [table.id, table.subjectId, table.evidenceClass],
      name: 'identity_evidence_supersession_identity_fk',
    })
      .onUpdate('no action')
      .onDelete('no action'),
    uniqueIndex('identity_evidence_chain_identity_uk').on(
      table.id,
      table.subjectId,
      table.evidenceClass,
    ),
    uniqueIndex('identity_evidence_supersedes_uk')
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} is not null`),
    uniqueIndex('identity_evidence_provider_fact_uk').on(
      table.provider,
      table.providerFactReference,
    ),
    index('identity_evidence_current_idx').on(
      table.subjectId,
      table.evidenceClass,
      table.recordedAt,
      table.id,
    ),
    index('identity_evidence_expiry_idx')
      .on(table.expiresAt, table.id)
      .where(sql`${table.expiresAt} is not null`),
    check(
      'identity_evidence_class_check',
      inList(table.evidenceClass, identityEvidenceClasses),
    ),
    check(
      'identity_evidence_result_check',
      inList(table.normalizedResult, identityEvidenceResults),
    ),
    check(
      'identity_evidence_threshold_check',
      sql`${table.thresholdContext} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_evidence_policy_version_check',
      sql`${table.policyVersion} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_evidence_provider_check',
      sql`${table.provider} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_evidence_provider_fact_check',
      lengthBetween(
        table.providerFactReference,
        1,
        maximumIdentityProviderReferenceLength,
      ),
    ),
    check(
      'identity_evidence_time_order_check',
      sql`${table.recordedAt} >= ${table.effectiveAt}
        and (${table.expiresAt} is null or ${table.expiresAt} >= ${table.effectiveAt})`,
    ),
    check(
      'identity_evidence_not_self_superseding_check',
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
  ],
);

/** Verified callback receipts only. Raw bodies are discarded after hashing. */
export const identityProviderEvents = pgTable(
  'identity_provider_events',
  {
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamptz('available_at').notNull(),
    failureReason: text('failure_reason'),
    id: uuid('id').primaryKey(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    leaseOwner: text('lease_owner'),
    normalizedEventType: text('normalized_event_type').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    payloadDigest: digestColumn('payload_digest').notNull(),
    processedAt: timestamptz('processed_at'),
    provider: text('provider').notNull(),
    providerAccount: text('provider_account').notNull(),
    providerEnvironment: text('provider_environment').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    providerReference: text('provider_reference'),
    receivedAt: timestamptz('received_at').notNull(),
    state: text('state').notNull().$type<IdentityProviderEventState>(),
  },
  (table) => [
    uniqueIndex('identity_provider_events_identity_uk').on(
      table.provider,
      table.providerAccount,
      table.providerEnvironment,
      table.providerEventId,
    ),
    index('identity_provider_events_claimable_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.state} in ('received', 'retry_wait')`),
    index('identity_provider_events_reference_idx')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    check(
      'identity_provider_events_state_check',
      inList(table.state, identityProviderEventStates),
    ),
    check(
      'identity_provider_events_digest_check',
      isHexDigest(table.payloadDigest),
    ),
    check(
      'identity_provider_events_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
    check(
      'identity_provider_events_lease_shape_check',
      nullablePairing(table.leaseOwner, table.leaseExpiresAt),
    ),
    check(
      'identity_provider_events_lease_state_check',
      sql`${table.leaseOwner} is null or ${table.state} in ('received', 'retry_wait')`,
    ),
    check(
      'identity_provider_events_processed_shape_check',
      sql`(${table.state} in ('processed', 'ignored')) = (${table.processedAt} is not null)`,
    ),
    check(
      'identity_provider_events_dead_letter_shape_check',
      sql`(${table.state} = 'dead_letter') = (${table.failureReason} is not null)`,
    ),
    check(
      'identity_provider_events_provider_check',
      sql`${table.provider} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_provider_events_account_check',
      sql`${table.providerAccount} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_provider_events_environment_check',
      sql`${table.providerEnvironment} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_provider_events_event_id_check',
      lengthBetween(
        table.providerEventId,
        1,
        maximumIdentityProviderEventIdLength,
      ),
    ),
    check(
      'identity_provider_events_event_type_check',
      lengthBetween(
        table.normalizedEventType,
        1,
        maximumIdentityProviderEventTypeLength,
      ),
    ),
    check(
      'identity_provider_events_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(
        table.providerReference,
        1,
        maximumIdentityProviderReferenceLength,
      )}`,
    ),
    check(
      'identity_provider_events_lease_owner_check',
      sql`${table.leaseOwner} is null or ${lengthBetween(
        table.leaseOwner,
        1,
        maximumIdentityLeaseOwnerLength,
      )}`,
    ),
    check(
      'identity_provider_events_failure_reason_check',
      sql`${table.failureReason} is null or ${lengthBetween(
        table.failureReason,
        1,
        maximumIdentityFailureCodeLength,
      )}`,
    ),
    check(
      'identity_provider_events_time_order_check',
      sql`${table.receivedAt} >= ${table.occurredAt}
        and (${table.processedAt} is null or ${table.processedAt} >= ${table.receivedAt})`,
    ),
  ],
);

/** Bounded, durable record that provider and platform facts disagree. */
export const identityReconciliationFindings = pgTable(
  'identity_reconciliation_findings',
  {
    attemptId: uuid('attempt_id').references(() => identityAttempts.id, {
      onDelete: 'no action',
      onUpdate: 'no action',
    }),
    detectedAt: timestamptz('detected_at').notNull(),
    evidenceId: uuid('evidence_id').references(() => identityEvidence.id, {
      onDelete: 'no action',
      onUpdate: 'no action',
    }),
    fingerprint: digestColumn('fingerprint').notNull(),
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull().$type<IdentityReconciliationKind>(),
    provider: text('provider').notNull(),
    reasonCode: text('reason_code').notNull(),
    resolvedAt: timestamptz('resolved_at'),
    state: text('state').notNull().$type<IdentityReconciliationState>(),
    subjectId: uuid('subject_id').references(() => identitySubjects.id, {
      onDelete: 'no action',
      onUpdate: 'no action',
    }),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('identity_reconciliation_findings_fingerprint_uk').on(
      table.fingerprint,
    ),
    index('identity_reconciliation_findings_open_idx')
      .on(table.detectedAt, table.id)
      .where(sql`${table.state} = 'open'`),
    index('identity_reconciliation_findings_subject_idx')
      .on(table.subjectId, table.detectedAt, table.id)
      .where(sql`${table.subjectId} is not null`),
    check(
      'identity_reconciliation_findings_kind_check',
      inList(table.kind, identityReconciliationKinds),
    ),
    check(
      'identity_reconciliation_findings_state_check',
      inList(table.state, identityReconciliationStates),
    ),
    check(
      'identity_reconciliation_findings_fingerprint_check',
      isHexDigest(table.fingerprint),
    ),
    check(
      'identity_reconciliation_findings_provider_check',
      sql`${table.provider} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_reconciliation_findings_reason_check',
      sql`${table.reasonCode} ~ ${sql.raw(`'${identityCodePattern}'`)}`,
    ),
    check(
      'identity_reconciliation_findings_resolution_check',
      sql`(${table.state} <> 'open') = (${table.resolvedAt} is not null)`,
    ),
    check(
      'identity_reconciliation_findings_time_order_check',
      sql`${table.updatedAt} >= ${table.detectedAt}
        and (${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.detectedAt})`,
    ),
  ],
);

export const identityOutbox = outboxTable('identity_outbox');
