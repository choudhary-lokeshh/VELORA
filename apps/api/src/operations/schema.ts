import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  controlKeys,
  maximumReasonCharacters,
  maximumStateCharacters,
  minimumReasonCharacters,
  operatorActionNames,
  operatorActionOutcomes,
  operatorCapabilities,
  operatorRoles,
  operatorSubjectTypes,
  type ControlKey,
  type OperatorActionName,
  type OperatorActionOutcome,
  type OperatorRole,
  type OperatorSubjectType,
} from './policy.js';

/**
 * OPERATIONS-owned persistence: three small tables and nothing that grows with
 * the product.
 *
 * The absence is the design. There is no activity table, no telemetry table, no
 * metric rollup, and no counter — because every product fact an operator needs
 * is already a row somewhere that owns it, and a second copy of a fact is a
 * second answer waiting to disagree with the first. What is here is only what
 * genuinely had no owner: who an operator is, what the platform has been told
 * to do, and what an operator did about it.
 *
 * That also means this domain creates no retention hazard. Grants and controls
 * are current state, one row per operator and one per switch. Operator actions
 * accumulate at the rate a human presses a button, which over the life of this
 * product is smaller than a single busy day of any other table — and they are
 * audit, which `docs/security` keeps rather than expires.
 *
 * Nothing here references another domain's table. An operator is an opaque AUTH
 * account reference, a subject is an opaque identifier of whatever kind the
 * action names, and neither has a foreign key, on the ownership rule
 * `docs/architecture/05-data-ownership.md` records.
 */

/**
 * What the platform has been told to do, one row per switch.
 *
 * The key is the primary key, so a control exists at most once and the store
 * cannot hold two answers for the same question. A control nobody has ever set
 * has no row at all and takes the default the policy declares — which is why
 * running this migration on a working platform changes no behaviour.
 *
 * `version` is what makes two operators safe. Every write states the version it
 * read and the update matches on it, so the second of two people looking at the
 * same screen is refused with a conflict rather than silently overwriting a
 * change they never saw. `docs/engineering/03-jobs-idempotency-concurrency.md`
 * calls that compare-and-set; here it is the difference between an incident
 * where one operator paused live search and one where they thought they had.
 */
export const operationsControls = pgTable(
  'operations_controls',
  {
    /** The operator who last wrote it. A session reference, never a name. */
    changedBy: text('changed_by').notNull(),
    enabled: boolean('enabled').notNull(),
    key: text('key').primaryKey().$type<ControlKey>(),
    /** Why, in the operator's words. Required on every write. */
    reason: text('reason').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Incremented on every write. The compare-and-set token. */
    version: integer('version').notNull(),
  },
  (table) => [
    check('operations_controls_key_check', inList(table.key, controlKeys)),
    check(
      'operations_controls_reason_length_check',
      lengthBetween(
        table.reason,
        minimumReasonCharacters,
        maximumReasonCharacters,
      ),
    ),
    check('operations_controls_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * Which operator holds which role.
 *
 * One live grant per operator, enforced by a partial unique index rather than
 * by a service remembering to check — two grants for the same person would be
 * two answers to "what may they do", and the union of them is always the more
 * permissive one, which is the wrong way for that ambiguity to resolve.
 *
 * A revoked grant keeps its row. It is the evidence that somebody held a
 * capability during the window an incident happened in, and deleting it would
 * destroy exactly the record an investigation needs.
 *
 * There is no capability column. A grant names a role, the role's capabilities
 * live in code, and widening a role is therefore a reviewed change with a
 * commit behind it rather than an `UPDATE` somebody ran. The alternative —
 * per-operator capability rows — makes every audit of "who could do this"
 * depend on reading data instead of reading the policy.
 */
export const operationsOperatorGrants = pgTable(
  'operations_operator_grants',
  {
    grantedAt: timestamptz('granted_at').notNull(),
    /** The operator who granted it. Absent only for a bootstrap grant. */
    grantedBy: text('granted_by'),
    id: uuid('id').primaryKey(),
    reason: text('reason').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by'),
    role: text('role').notNull().$type<OperatorRole>(),
    /** Opaque AUTH account reference for the operator. No foreign key. */
    subjectReference: text('subject_reference').notNull(),
  },
  (table) => [
    // One live grant per operator. A revoked one may sit beside it forever.
    uniqueIndex('operations_operator_grants_live_uk')
      .on(table.subjectReference)
      .where(sql`${table.revokedAt} is null`),
    index('operations_operator_grants_recency_idx').on(
      table.grantedAt,
      table.id,
    ),
    check(
      'operations_operator_grants_role_check',
      inList(table.role, operatorRoles),
    ),
    check(
      'operations_operator_grants_reason_length_check',
      lengthBetween(
        table.reason,
        minimumReasonCharacters,
        maximumReasonCharacters,
      ),
    ),
    // A revocation has an author and an instant, or it has neither.
    check(
      'operations_operator_grants_revocation_pairing_check',
      sql`(${table.revokedAt} is null) = (${table.revokedBy} is null)`,
    ),
  ],
);

/**
 * What an operator did, written once and never touched again.
 *
 * Append-only is a property of the repository above this table — there is no
 * update and no delete anywhere in this domain for these rows, and no route
 * that could reach one if there were. That is weaker than a database trigger
 * and stronger than a convention, and it is stated here so the next person
 * adding a command knows the rule they are inheriting.
 *
 * A row is written after the command settles, with the outcome it actually had.
 * `refused` is a first-class outcome rather than an absence: an operator who
 * tried to pause live search and was told no has performed an action worth
 * seeing, and an audit that only recorded successes would show an incident with
 * a hole in the middle of it.
 *
 * `previousState` and `requestedState` are short projections — `enabled`,
 * `disabled`, a role name — and are bounded to make them stay that way. They
 * are not payloads. Nothing in this table can hold a message, a token, a
 * profile field, or a body, because there is nowhere to put one.
 */
export const operationsOperatorActions = pgTable(
  'operations_operator_actions',
  {
    /** The operator who acted. A session reference, never a name. */
    actorReference: text('actor_reference').notNull(),
    action: text('action').notNull().$type<OperatorActionName>(),
    /** The capability the route required. What authorised this, recorded. */
    capability: text('capability').notNull(),
    correlationId: text('correlation_id'),
    /** The product error code, where the command was refused or failed. */
    failureCode: text('failure_code'),
    id: uuid('id').primaryKey(),
    occurredAt: timestamptz('occurred_at').notNull(),
    outcome: text('outcome').notNull().$type<OperatorActionOutcome>(),
    previousState: text('previous_state'),
    reason: text('reason').notNull(),
    requestedState: text('requested_state'),
    /** The record acted on, where the action named one. */
    subjectId: text('subject_id'),
    subjectType: text('subject_type').notNull().$type<OperatorSubjectType>(),
  },
  (table) => [
    // The explorer's read: newest first, optionally narrowed. The identifier
    // is in the key so a page boundary cannot move under a reader when two
    // actions share an instant.
    index('operations_operator_actions_recency_idx').on(
      table.occurredAt,
      table.id,
    ),
    index('operations_operator_actions_actor_idx').on(
      table.actorReference,
      table.occurredAt,
    ),
    index('operations_operator_actions_subject_idx')
      .on(table.subjectId, table.occurredAt)
      .where(sql`${table.subjectId} is not null`),
    index('operations_operator_actions_action_idx').on(
      table.action,
      table.occurredAt,
    ),
    check(
      'operations_operator_actions_action_check',
      inList(table.action, operatorActionNames),
    ),
    check(
      'operations_operator_actions_outcome_check',
      inList(table.outcome, operatorActionOutcomes),
    ),
    check(
      'operations_operator_actions_subject_type_check',
      inList(table.subjectType, operatorSubjectTypes),
    ),
    check(
      'operations_operator_actions_capability_check',
      inList(table.capability, operatorCapabilities),
    ),
    check(
      'operations_operator_actions_reason_length_check',
      lengthBetween(
        table.reason,
        minimumReasonCharacters,
        maximumReasonCharacters,
      ),
    ),
    // A refusal or a failure carries a code; an applied action does not.
    check(
      'operations_operator_actions_failure_pairing_check',
      sql`(${table.outcome} = 'applied') = (${table.failureCode} is null)`,
    ),
    check(
      'operations_operator_actions_previous_state_length_check',
      sql`${table.previousState} is null or char_length(${table.previousState}) between 1 and ${sql.raw(String(maximumStateCharacters))}`,
    ),
    check(
      'operations_operator_actions_requested_state_length_check',
      sql`${table.requestedState} is null or char_length(${table.requestedState}) between 1 and ${sql.raw(String(maximumStateCharacters))}`,
    ),
  ],
);
