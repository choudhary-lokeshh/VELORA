import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { DatabaseHandle } from '../database/executor.js';
import {
  identityOutbox,
  identityAttempts,
  identityEvidence,
  identityProviderEvents,
  identityReconciliationFindings,
  identitySubjects,
} from './schema.js';
import type {
  IdentityEvidenceClass,
  IdentityOwnerDomain,
  IdentityPurpose,
  IdentityReconciliationKind,
} from './policy.js';
import type { IdentityVerificationProviderPort } from './provider.js';

/** A count labelled only by closed Identity vocabulary. */
export interface IdentityOperationsCount {
  readonly count: number;
  readonly state: string;
}

/** Attempts are grouped by purpose as well as lifecycle. */
export interface IdentityAttemptOperationsCount extends IdentityOperationsCount {
  readonly purpose: IdentityPurpose;
}

/** A bounded queue age. Absent means this queue class has no row. */
export interface IdentityOperationsBacklog extends IdentityOperationsCount {
  readonly oldestAgeSeconds: number | undefined;
}

export interface IdentityReconciliationOperationsCount extends IdentityOperationsCount {
  readonly kind: IdentityReconciliationKind;
  readonly oldestAgeSeconds: number | undefined;
}

/** Identifier-free platform health suitable for the Admin operations screen. */
export interface IdentityOperationalState {
  readonly attempts: readonly IdentityAttemptOperationsCount[];
  /** Current evidence that has reached its explicit expiry instant. */
  readonly expiredEvidence: readonly IdentityOperationsCount[];
  readonly outbox: readonly IdentityOperationsCount[];
  /** Only claimable inbox work, with its age. */
  readonly providerEventBacklog: readonly IdentityOperationsBacklog[];
  readonly providerEvents: readonly IdentityOperationsCount[];
  /** Adapter actually composed by this process, never a client selection. */
  readonly provider: string;
  readonly reconciliation: readonly IdentityReconciliationOperationsCount[];
}

export interface IdentitySubjectAttemptView {
  readonly createdAt: Date;
  readonly purpose: IdentityPurpose;
  readonly state: string;
  readonly updatedAt: Date;
}

/** The current evidence tip only; retained fact history never becomes a view. */
export interface IdentitySubjectEvidenceView {
  readonly evidenceClass: IdentityEvidenceClass;
  readonly expiresAt?: Date;
  readonly recordedAt: Date;
  readonly result: string;
}

export interface IdentitySubjectFindingView {
  readonly detectedAt: Date;
  readonly kind: IdentityReconciliationKind;
  readonly state: string;
}

/** One already-known subject, without an owner ID or provider fact/reference. */
export interface IdentitySubjectOperationsView {
  readonly attempts: readonly IdentitySubjectAttemptView[];
  readonly attemptsTruncated: boolean;
  readonly currentEvidence: readonly IdentitySubjectEvidenceView[];
  readonly findings: readonly IdentitySubjectFindingView[];
  readonly findingsTruncated: boolean;
  readonly ownerDomain: IdentityOwnerDomain;
}

const subjectDetailLimit = 50;

/**
 * IDENTITY's published, read-only operations projection.
 *
 * ADMIN receives this service rather than a repository or database handle. It
 * has no write method and never reveals owner references, provider references,
 * provider payloads, jurisdiction, policy/threshold detail, or evidence IDs.
 */
export class IdentityOperations {
  constructor(
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly now: () => Date;
      readonly provider: IdentityVerificationProviderPort;
    },
  ) {}

  async operationalState(): Promise<IdentityOperationalState> {
    const now = this.dependencies.now();
    const [
      attempts,
      providerEvents,
      providerEventBacklog,
      expiredEvidence,
      reconciliation,
      outbox,
    ] = await Promise.all([
      this.attemptStates(),
      this.providerEventStates(),
      this.providerEventBacklogs(now),
      this.expiredCurrentEvidence(now),
      this.reconciliationFindings(now),
      this.outboxStates(),
    ]);
    return {
      attempts,
      expiredEvidence,
      outbox,
      providerEventBacklog,
      providerEvents,
      provider: this.dependencies.provider.provider,
      reconciliation,
    };
  }

  /**
   * One known opaque owner reference. This is not a search primitive: callers
   * must already have both parts, and the returned projection does not echo the
   * reference or expose a provider's identity-bearing detail.
   */
  async subjectDetail(input: {
    readonly ownerDomain: IdentityOwnerDomain;
    readonly ownerReference: string;
  }): Promise<IdentitySubjectOperationsView | undefined> {
    const subjects = await this.dependencies.database
      .select({ id: identitySubjects.id })
      .from(identitySubjects)
      .where(
        and(
          eq(identitySubjects.ownerDomain, input.ownerDomain),
          eq(identitySubjects.ownerReference, input.ownerReference),
        ),
      )
      .limit(1);
    const subject = subjects[0];
    if (subject === undefined) return undefined;

    const [attemptRows, evidenceRows, findingRows] = await Promise.all([
      this.dependencies.database
        .select({
          createdAt: identityAttempts.createdAt,
          purpose: identityAttempts.purpose,
          state: identityAttempts.state,
          updatedAt: identityAttempts.updatedAt,
        })
        .from(identityAttempts)
        .where(eq(identityAttempts.subjectId, subject.id))
        .orderBy(desc(identityAttempts.sequence))
        .limit(subjectDetailLimit + 1),
      this.dependencies.database
        .select({
          evidenceClass: identityEvidence.evidenceClass,
          expiresAt: identityEvidence.expiresAt,
          recordedAt: identityEvidence.recordedAt,
          result: identityEvidence.normalizedResult,
        })
        .from(identityEvidence)
        .where(
          and(
            eq(identityEvidence.subjectId, subject.id),
            sql`not exists (
              select 1 from identity_evidence as superseding
              where superseding.supersedes_id = ${identityEvidence.id}
            )`,
          ),
        )
        .orderBy(asc(identityEvidence.evidenceClass)),
      this.dependencies.database
        .select({
          detectedAt: identityReconciliationFindings.detectedAt,
          kind: identityReconciliationFindings.kind,
          state: identityReconciliationFindings.state,
        })
        .from(identityReconciliationFindings)
        .where(eq(identityReconciliationFindings.subjectId, subject.id))
        .orderBy(
          desc(identityReconciliationFindings.detectedAt),
          desc(identityReconciliationFindings.id),
        )
        .limit(subjectDetailLimit + 1),
    ]);
    const attempts = attemptRows.slice(0, subjectDetailLimit);
    const findings = findingRows.slice(0, subjectDetailLimit);
    return {
      attempts,
      attemptsTruncated: attemptRows.length > subjectDetailLimit,
      currentEvidence: evidenceRows.map((row) => ({
        evidenceClass: row.evidenceClass,
        ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
        recordedAt: row.recordedAt,
        result: row.result,
      })),
      findings,
      findingsTruncated: findingRows.length > subjectDetailLimit,
      ownerDomain: input.ownerDomain,
    };
  }

  private async attemptStates(): Promise<
    readonly IdentityAttemptOperationsCount[]
  > {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        purpose: identityAttempts.purpose,
        state: identityAttempts.state,
      })
      .from(identityAttempts)
      .groupBy(identityAttempts.purpose, identityAttempts.state)
      .orderBy(asc(identityAttempts.purpose), asc(identityAttempts.state));
    return rows;
  }

  private async providerEventStates(): Promise<
    readonly IdentityOperationsCount[]
  > {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        state: identityProviderEvents.state,
      })
      .from(identityProviderEvents)
      .groupBy(identityProviderEvents.state)
      .orderBy(asc(identityProviderEvents.state));
    return rows;
  }

  private async providerEventBacklogs(
    now: Date,
  ): Promise<readonly IdentityOperationsBacklog[]> {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        oldest: sql<Date | null>`min(${identityProviderEvents.receivedAt})`,
        state: identityProviderEvents.state,
      })
      .from(identityProviderEvents)
      .where(inArray(identityProviderEvents.state, ['received', 'retry_wait']))
      .groupBy(identityProviderEvents.state)
      .orderBy(asc(identityProviderEvents.state));
    return rows.map((row) => ({
      count: row.count,
      oldestAgeSeconds: ageSeconds(now, row.oldest),
      state: row.state,
    }));
  }

  private async expiredCurrentEvidence(
    now: Date,
  ): Promise<readonly IdentityOperationsCount[]> {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        state: identityEvidence.evidenceClass,
      })
      .from(identityEvidence)
      .where(
        and(
          lte(identityEvidence.expiresAt, now),
          sql`not exists (
            select 1 from identity_evidence as superseding
            where superseding.supersedes_id = ${identityEvidence.id}
          )`,
        ),
      )
      .groupBy(identityEvidence.evidenceClass)
      .orderBy(asc(identityEvidence.evidenceClass));
    return rows;
  }

  private async reconciliationFindings(
    now: Date,
  ): Promise<readonly IdentityReconciliationOperationsCount[]> {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        kind: identityReconciliationFindings.kind,
        oldest: sql<Date | null>`min(${identityReconciliationFindings.detectedAt})`,
        state: identityReconciliationFindings.state,
      })
      .from(identityReconciliationFindings)
      .groupBy(
        identityReconciliationFindings.kind,
        identityReconciliationFindings.state,
      )
      .orderBy(
        asc(identityReconciliationFindings.kind),
        asc(identityReconciliationFindings.state),
      );
    return rows.map((row) => ({
      count: row.count,
      kind: row.kind,
      oldestAgeSeconds:
        row.state === 'open' ? ageSeconds(now, row.oldest) : undefined,
      state: row.state,
    }));
  }

  private async outboxStates(): Promise<readonly IdentityOperationsCount[]> {
    const rows = await this.dependencies.database
      .select({
        count: sql<number>`count(*)::integer`,
        state: identityOutbox.state,
      })
      .from(identityOutbox)
      .groupBy(identityOutbox.state)
      .orderBy(asc(identityOutbox.state));
    return rows;
  }
}

function ageSeconds(now: Date, oldest: Date | null): number | undefined {
  if (oldest === null) return undefined;
  return Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1_000));
}
