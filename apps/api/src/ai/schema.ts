import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  timestamptz,
} from '../database/columns.js';
const aiRunStates = ['running', 'succeeded', 'failed', 'cancelled'] as const;
const aiRunEventTypes = [
  'admitted',
  'succeeded',
  'failed',
  'cancelled',
] as const;

/** AI-owned activation truth. No other domain state is copied here. */
export const aiCapabilityActivations = pgTable(
  'ai_capability_activations',
  {
    capability: text('capability').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    environment: text('environment').notNull(),
    outputSchemaVersion: text('output_schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    safetyVersion: text('safety_version').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.capability] }),
    check(
      'ai_capability_activations_environment_check',
      sql`${table.environment} in ('local', 'test', 'staging', 'production')`,
    ),
  ],
);

/**
 * Durable orchestration record. Inputs/outputs are represented by digests and
 * measurements only; raw drafts and suggestions never enter AI persistence.
 */
export const aiRuns = pgTable(
  'ai_runs',
  {
    actorId: uuid('actor_id').notNull(),
    audience: text('audience').notNull(),
    cancelledAt: timestamptz('cancelled_at'),
    capability: text('capability').notNull(),
    completedAt: timestamptz('completed_at'),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    estimatedCostMicrounits: integer('estimated_cost_microunits')
      .notNull()
      .default(0),
    failureCode: text('failure_code'),
    id: uuid('id').primaryKey(),
    inputCharacters: integer('input_characters').notNull(),
    inputDigest: digestColumn('input_digest').notNull(),
    modelId: text('model_id').notNull(),
    outputCharacters: integer('output_characters').notNull().default(0),
    outputDigest: digestColumn('output_digest'),
    outputSchemaVersion: text('output_schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    providerId: text('provider_id').notNull(),
    safetyVersion: text('safety_version').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    state: text('state').notNull(),
  },
  (table) => [
    index('ai_runs_actor_created_idx').on(table.actorId, table.createdAt),
    index('ai_runs_active_idx')
      .on(table.createdAt)
      .where(sql`${table.state} = 'running'`),
    check('ai_runs_state_check', inList(table.state, aiRunStates)),
    check('ai_runs_input_digest_check', isHexDigest(table.inputDigest)),
    check(
      'ai_runs_output_digest_check',
      sql`${table.outputDigest} is null or ${isHexDigest(table.outputDigest)}`,
    ),
    check(
      'ai_runs_measurements_check',
      sql`${table.inputCharacters} >= 0 and ${table.outputCharacters} >= 0 and ${table.estimatedCostMicrounits} >= 0`,
    ),
    check(
      'ai_runs_terminal_shape_check',
      sql`(${table.state} = 'running' and ${table.completedAt} is null and ${table.cancelledAt} is null and ${table.outputCharacters} = 0 and ${table.outputDigest} is null and ${table.estimatedCostMicrounits} = 0 and ${table.failureCode} is null) or
          (${table.state} = 'succeeded' and ${table.completedAt} is not null and ${table.cancelledAt} is null and ${table.outputDigest} is not null and ${table.failureCode} is null) or
          (${table.state} = 'failed' and ${table.completedAt} is not null and ${table.cancelledAt} is null and ${table.outputCharacters} = 0 and ${table.outputDigest} is null and ${table.estimatedCostMicrounits} = 0 and ${table.failureCode} is not null) or
          (${table.state} = 'cancelled' and ${table.completedAt} is not null and ${table.cancelledAt} is not null and ${table.outputCharacters} = 0 and ${table.outputDigest} is null and ${table.estimatedCostMicrounits} = 0 and ${table.failureCode} is null)`,
    ),
  ],
);

/** Append-only, payload-free audit trail. */
export const aiRunEvents = pgTable(
  'ai_run_events',
  {
    createdAt: timestamptz('created_at').notNull(),
    event: text('event').notNull(),
    id: uuid('id').primaryKey(),
    reasonCode: text('reason_code'),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('ai_run_events_run_idx').on(table.runId, table.createdAt),
    check('ai_run_events_event_check', inList(table.event, aiRunEventTypes)),
    check(
      'ai_run_events_reason_check',
      sql`(${table.event} = 'failed') = (${table.reasonCode} is not null)`,
    ),
  ],
);

/** Authoritative daily admission and accounting, atomically reserved. */
export const aiUsageDaily = pgTable(
  'ai_usage_daily',
  {
    actorId: uuid('actor_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    estimatedCostMicrounits: integer('estimated_cost_microunits')
      .notNull()
      .default(0),
    inputCharacters: integer('input_characters').notNull().default(0),
    outputCharacters: integer('output_characters').notNull().default(0),
    runCount: integer('run_count').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.day] }),
    check(
      'ai_usage_daily_counts_check',
      sql`${table.runCount} >= 0 and ${table.inputCharacters} >= 0 and ${table.outputCharacters} >= 0 and ${table.estimatedCostMicrounits} >= 0`,
    ),
  ],
);
