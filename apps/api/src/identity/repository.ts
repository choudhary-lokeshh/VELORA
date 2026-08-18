import { and, eq, inArray } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { lockIdempotentOperation } from '../database/idempotency-lock.js';
import {
  activeIdentityAttemptStates,
  terminalIdentityAttemptStates,
  type IdentityAttemptState,
  type IdentityEvidenceClass,
  type IdentityOwnerDomain,
  type IdentityPurpose,
} from './policy.js';
import { identityAttempts, identitySubjects } from './schema.js';

export type IdentitySubjectRow = typeof identitySubjects.$inferSelect;
export type IdentityAttemptRow = typeof identityAttempts.$inferSelect;

export type EstablishIdentityAttemptResult =
  | {
      readonly attempt: IdentityAttemptRow;
      readonly kind: 'created' | 'replay';
      readonly subject: IdentitySubjectRow;
    }
  | { readonly kind: 'idempotency_mismatch' }
  | {
      readonly activeAttempt: IdentityAttemptRow;
      readonly kind: 'active_attempt_exists';
    };

/**
 * IDENTITY-owned persistence only. No query reaches an owner-domain table.
 */
export class IdentityRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Creates or resolves one subject and one caller operation atomically.
   *
   * Lock order is subject identity, then subject/purpose operation. Different
   * idempotency keys for one active purpose serialize on the second lock, so
   * they resolve to an explicit active-attempt conflict rather than a unique
   * violation that aborts the transaction.
   */
  async establishAttempt(input: {
    readonly callerIdempotencyKey: string;
    readonly inputDigest: string;
    readonly jurisdiction: string;
    readonly now: Date;
    readonly ownerDomain: IdentityOwnerDomain;
    readonly ownerReference: string;
    readonly policyVersion: string;
    readonly provider: string;
    readonly providerIdempotencyKey: string;
    readonly purpose: IdentityPurpose;
    readonly requiredEvidenceClass: IdentityEvidenceClass;
    readonly requiredThreshold: string;
  }): Promise<EstablishIdentityAttemptResult> {
    return this.transaction(async (executor) => {
      const subject = await this.findOrCreateSubject(executor, input);
      await lockIdempotentOperation(
        executor,
        'identity_attempts',
        subject.id,
        input.purpose,
      );

      const replay = await this.findByIdempotency(executor, {
        callerIdempotencyKey: input.callerIdempotencyKey,
        purpose: input.purpose,
        subjectId: subject.id,
      });
      if (replay !== undefined) {
        if (replay.inputDigest !== input.inputDigest) {
          return { kind: 'idempotency_mismatch' };
        }
        return { attempt: replay, kind: 'replay', subject };
      }

      const active = await this.findActive(executor, {
        purpose: input.purpose,
        subjectId: subject.id,
      });
      if (active !== undefined) {
        return { activeAttempt: active, kind: 'active_attempt_exists' };
      }

      const inserted = await executor
        .insert(identityAttempts)
        .values({
          callerIdempotencyKey: input.callerIdempotencyKey,
          completedAt: null,
          createdAt: input.now,
          id: crypto.randomUUID(),
          inputDigest: input.inputDigest,
          jurisdiction: input.jurisdiction,
          policyVersion: input.policyVersion,
          provider: input.provider,
          providerBoundAt: null,
          providerIdempotencyKey: input.providerIdempotencyKey,
          providerReference: null,
          purpose: input.purpose,
          requiredEvidenceClass: input.requiredEvidenceClass,
          requiredThreshold: input.requiredThreshold,
          state: 'created',
          subjectId: subject.id,
          updatedAt: input.now,
        })
        .returning();
      const attempt = inserted[0];
      if (attempt === undefined) {
        throw new Error('identity attempt insert returned no row');
      }
      return { attempt, kind: 'created', subject };
    });
  }

  async findByIdempotency(
    executor: Executor,
    input: {
      readonly callerIdempotencyKey: string;
      readonly purpose: IdentityPurpose;
      readonly subjectId: string;
    },
  ): Promise<IdentityAttemptRow | undefined> {
    const rows = await executor
      .select()
      .from(identityAttempts)
      .where(
        and(
          eq(identityAttempts.subjectId, input.subjectId),
          eq(identityAttempts.purpose, input.purpose),
          eq(identityAttempts.callerIdempotencyKey, input.callerIdempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findActive(
    executor: Executor,
    input: { readonly purpose: IdentityPurpose; readonly subjectId: string },
  ): Promise<IdentityAttemptRow | undefined> {
    const rows = await executor
      .select()
      .from(identityAttempts)
      .where(
        and(
          eq(identityAttempts.subjectId, input.subjectId),
          eq(identityAttempts.purpose, input.purpose),
          inArray(identityAttempts.state, activeIdentityAttemptStates),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findById(
    executor: Executor,
    attemptId: string,
  ): Promise<IdentityAttemptRow | undefined> {
    const rows = await executor
      .select()
      .from(identityAttempts)
      .where(eq(identityAttempts.id, attemptId))
      .limit(1);
    return rows[0];
  }

  async transitionAttempt(
    executor: Executor,
    input: {
      readonly attemptId: string;
      readonly from: readonly IdentityAttemptState[];
      readonly now: Date;
      readonly providerReference?: string;
      readonly to: IdentityAttemptState;
    },
  ): Promise<IdentityAttemptRow | undefined> {
    const terminal = terminalIdentityAttemptStates.includes(input.to);
    const updated = await executor
      .update(identityAttempts)
      .set({
        ...(terminal ? { completedAt: input.now } : {}),
        ...(input.providerReference === undefined
          ? {}
          : {
              providerBoundAt: input.now,
              providerReference: input.providerReference,
            }),
        state: input.to,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(identityAttempts.id, input.attemptId),
          inArray(identityAttempts.state, input.from),
        ),
      )
      .returning();
    return updated[0];
  }

  private async findOrCreateSubject(
    executor: TransactionHandle,
    input: {
      readonly now: Date;
      readonly ownerDomain: IdentityOwnerDomain;
      readonly ownerReference: string;
    },
  ): Promise<IdentitySubjectRow> {
    await lockIdempotentOperation(
      executor,
      'identity_subjects',
      input.ownerDomain,
      input.ownerReference,
    );
    const inserted = await executor
      .insert(identitySubjects)
      .values({
        createdAt: input.now,
        id: crypto.randomUUID(),
        ownerDomain: input.ownerDomain,
        ownerReference: input.ownerReference,
      })
      .onConflictDoNothing({
        target: [identitySubjects.ownerDomain, identitySubjects.ownerReference],
      })
      .returning();
    if (inserted[0] !== undefined) return inserted[0];

    const rows = await executor
      .select()
      .from(identitySubjects)
      .where(
        and(
          eq(identitySubjects.ownerDomain, input.ownerDomain),
          eq(identitySubjects.ownerReference, input.ownerReference),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (existing === undefined) {
      throw new Error('identity subject conflict resolved without a row');
    }
    return existing;
  }
}
