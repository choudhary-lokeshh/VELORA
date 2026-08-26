import { and, eq, sql } from 'drizzle-orm';

import type { AppEnvironment } from '@velora/config/server';
import type { AiCapability, AuthAudience } from '@velora/validation';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import { aiDailyRunLimit, type AiRunState } from './policy.js';
import {
  aiCapabilityActivations,
  aiRunEvents,
  aiRuns,
  aiUsageDaily,
} from './schema.js';

export interface AiRunPins {
  readonly modelId: string;
  readonly outputSchemaVersion: string;
  readonly promptVersion: string;
  readonly providerId: string;
  readonly safetyVersion: string;
}

/** A client run identity is single-use; collision must not consume usage. */
export class AiRunConflictError extends Error {
  constructor() {
    super('AI run identity already exists');
    this.name = 'AiRunConflictError';
  }
}

export class AiRepository {
  constructor(private readonly database: DatabaseHandle) {}

  async capabilityEnabled(
    environment: AppEnvironment,
    capability: AiCapability,
    pins: Pick<
      AiRunPins,
      'outputSchemaVersion' | 'promptVersion' | 'safetyVersion'
    >,
  ): Promise<boolean> {
    const rows = await this.database
      .select({ enabled: aiCapabilityActivations.enabled })
      .from(aiCapabilityActivations)
      .where(
        and(
          eq(aiCapabilityActivations.environment, environment),
          eq(aiCapabilityActivations.capability, capability),
          eq(aiCapabilityActivations.promptVersion, pins.promptVersion),
          eq(
            aiCapabilityActivations.outputSchemaVersion,
            pins.outputSchemaVersion,
          ),
          eq(aiCapabilityActivations.safetyVersion, pins.safetyVersion),
        ),
      )
      .limit(1);
    return rows[0]?.enabled === true;
  }

  async admit(input: {
    readonly actorId: string;
    readonly audience: AuthAudience;
    readonly capability: AiCapability;
    readonly correlationId: string;
    readonly inputCharacters: number;
    readonly inputDigest: string;
    readonly now: Date;
    readonly pins: AiRunPins;
    readonly runId: string;
  }): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const day = input.now.toISOString().slice(0, 10);
      const reservation = await tx
        .insert(aiUsageDaily)
        .values({
          actorId: input.actorId,
          day,
          inputCharacters: input.inputCharacters,
          runCount: 1,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [aiUsageDaily.actorId, aiUsageDaily.day],
          set: {
            inputCharacters: sql`${aiUsageDaily.inputCharacters} + ${input.inputCharacters}`,
            runCount: sql`${aiUsageDaily.runCount} + 1`,
            updatedAt: input.now,
          },
          where: sql`${aiUsageDaily.runCount} < ${aiDailyRunLimit}`,
        })
        .returning({ runCount: aiUsageDaily.runCount });
      if (reservation.length === 0) return false;
      const inserted = await tx
        .insert(aiRuns)
        .values({
          actorId: input.actorId,
          audience: input.audience,
          capability: input.capability,
          correlationId: input.correlationId,
          createdAt: input.now,
          id: input.runId,
          inputCharacters: input.inputCharacters,
          inputDigest: input.inputDigest,
          ...input.pins,
          startedAt: input.now,
          state: 'running',
        })
        .onConflictDoNothing()
        .returning({ id: aiRuns.id });
      // Throwing rolls the whole transaction back, including the usage reserve.
      if (inserted.length === 0) throw new AiRunConflictError();
      await this.event(tx, input.runId, 'admitted', input.now);
      return true;
    });
  }

  async complete(input: {
    readonly actorId: string;
    readonly cost: number;
    readonly now: Date;
    readonly outputCharacters: number;
    readonly outputDigest: string;
    readonly runId: string;
  }): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const updated = await tx
        .update(aiRuns)
        .set({
          completedAt: input.now,
          estimatedCostMicrounits: input.cost,
          outputCharacters: input.outputCharacters,
          outputDigest: input.outputDigest,
          state: 'succeeded',
        })
        .where(
          and(
            eq(aiRuns.id, input.runId),
            eq(aiRuns.actorId, input.actorId),
            eq(aiRuns.state, 'running'),
          ),
        )
        .returning({ createdAt: aiRuns.createdAt, id: aiRuns.id });
      const completedRun = updated[0];
      if (completedRun === undefined) return false;
      await tx
        .update(aiUsageDaily)
        .set({
          estimatedCostMicrounits: sql`${aiUsageDaily.estimatedCostMicrounits} + ${input.cost}`,
          outputCharacters: sql`${aiUsageDaily.outputCharacters} + ${input.outputCharacters}`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(aiUsageDaily.actorId, input.actorId),
            eq(
              aiUsageDaily.day,
              completedRun.createdAt.toISOString().slice(0, 10),
            ),
          ),
        );
      await this.event(tx, input.runId, 'succeeded', input.now);
      return true;
    });
  }

  async fail(
    runId: string,
    actorId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const updated = await tx
        .update(aiRuns)
        .set({ completedAt: now, failureCode: reason, state: 'failed' })
        .where(
          and(
            eq(aiRuns.id, runId),
            eq(aiRuns.actorId, actorId),
            eq(aiRuns.state, 'running'),
          ),
        )
        .returning({ id: aiRuns.id });
      if (updated.length > 0)
        await this.event(tx, runId, 'failed', now, reason);
    });
  }

  async cancel(
    runId: string,
    actorId: string,
    audience: AuthAudience,
    now: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const updated = await tx
        .update(aiRuns)
        .set({ cancelledAt: now, completedAt: now, state: 'cancelled' })
        .where(
          and(
            eq(aiRuns.id, runId),
            eq(aiRuns.actorId, actorId),
            eq(aiRuns.audience, audience),
            eq(aiRuns.state, 'running'),
          ),
        )
        .returning({ id: aiRuns.id });
      if (updated.length > 0) await this.event(tx, runId, 'cancelled', now);
      return updated.length > 0;
    });
  }

  private async event(
    executor: Executor,
    runId: string,
    event: AiRunState | 'admitted',
    now: Date,
    reasonCode?: string,
  ): Promise<void> {
    await executor.insert(aiRunEvents).values({
      createdAt: now,
      event,
      id: crypto.randomUUID(),
      ...(reasonCode === undefined ? {} : { reasonCode }),
      runId,
    });
  }
}
