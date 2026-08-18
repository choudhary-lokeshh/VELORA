import { createHash } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import type { TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import {
  identityEvidenceRecordedEvent,
  type IdentityEvidenceRecordedPayload,
} from './events.js';
import {
  type IdentityProviderEventRepository,
  type IdentityProviderEventRow,
} from './event-repository.js';
import {
  identityCodePattern,
  maximumIdentityProviderEventAttempts,
  maximumIdentityProviderEventBodyBytes,
  maximumIdentityProviderReferenceLength,
  terminalIdentityAttemptStates,
} from './policy.js';
import {
  isIdentityProviderSnapshot,
  isVerifiedIdentityProviderEvent,
  type IdentityProviderEvidenceFact,
  type IdentityProviderSnapshot,
  type IdentityVerificationProviderPort,
} from './provider.js';
import {
  type IdentityAttemptRow,
  type IdentityRepository,
} from './repository.js';

export type IdentityProviderEventIntakeOutcome =
  | { readonly duplicate: boolean; readonly kind: 'accepted' }
  | {
      readonly kind: 'rejected';
      readonly reason: 'inconsistent' | 'oversized' | 'unverified';
    }
  | { readonly kind: 'unavailable' };

export interface IdentityProviderEventProcessReport {
  readonly claimed: number;
  readonly deadLettered: number;
  readonly ignored: number;
  readonly processed: number;
  readonly retried: number;
}

const leaseMilliseconds = 60_000;
const batchSize = 50;

function backoffMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts) * 1_000, 300_000);
}

/** Verified receipt plus leased, provider-current application. */
export class IdentityProviderEventService {
  constructor(
    private readonly dependencies: {
      readonly events: IdentityProviderEventRepository;
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly outbox: OutboxAppendPort;
      readonly owner: string;
      readonly provider: IdentityVerificationProviderPort;
      readonly repository: IdentityRepository;
    },
  ) {}

  async receive(input: {
    readonly correlationId: string;
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<IdentityProviderEventIntakeOutcome> {
    const { events, logger, provider } = this.dependencies;
    if (provider.provider === 'unavailable') return { kind: 'unavailable' };
    if (input.rawBody.byteLength > maximumIdentityProviderEventBodyBytes) {
      return { kind: 'rejected', reason: 'oversized' };
    }

    let event: unknown;
    try {
      event = await provider.verifyCallback({
        headers: input.headers,
        rawBody: input.rawBody,
      });
    } catch {
      logger.warn(
        { correlationId: input.correlationId, provider: provider.provider },
        'identity provider callback rejected',
      );
      return { kind: 'rejected', reason: 'unverified' };
    }

    const now = this.dependencies.now();
    if (
      !isVerifiedIdentityProviderEvent(event) ||
      event.occurredAt > now ||
      event.snapshot.providerReference.length >
        maximumIdentityProviderReferenceLength ||
      !new RegExp(identityCodePattern, 'u').test(provider.provider) ||
      !new RegExp(identityCodePattern, 'u').test(provider.account) ||
      !new RegExp(identityCodePattern, 'u').test(provider.environment)
    ) {
      logger.warn(
        { correlationId: input.correlationId, provider: provider.provider },
        'identity provider callback normalization rejected',
      );
      return { kind: 'rejected', reason: 'unverified' };
    }

    const payloadDigest = createHash('sha256')
      .update(input.rawBody)
      .digest('hex');
    const receipt = await events.transaction((executor) =>
      events.receive(executor, {
        eventId: event.eventId,
        eventType: event.eventType,
        now,
        occurredAt: event.occurredAt,
        payloadDigest,
        provider: provider.provider,
        providerAccount: provider.account,
        providerEnvironment: provider.environment,
        providerReference: event.snapshot.providerReference,
      }),
    );
    if (receipt.kind === 'mismatch') {
      logger.warn(
        { correlationId: input.correlationId, provider: provider.provider },
        'identity provider callback identity mismatch',
      );
      return { kind: 'rejected', reason: 'inconsistent' };
    }
    return { duplicate: receipt.kind === 'duplicate', kind: 'accepted' };
  }

  async processOnce(): Promise<IdentityProviderEventProcessReport> {
    const { events, logger, owner } = this.dependencies;
    const claimed = await events.claim({
      leaseMilliseconds,
      limit: batchSize,
      now: this.dependencies.now(),
      owner,
    });
    let processed = 0;
    let ignored = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const event of claimed) {
      try {
        const applied = await this.apply(event);
        await events.transaction((executor) =>
          events.settle(executor, {
            id: event.id,
            now: this.dependencies.now(),
            owner,
            state: applied ? 'processed' : 'ignored',
          }),
        );
        if (applied) processed += 1;
        else ignored += 1;
      } catch (error) {
        const retired = event.attempts >= maximumIdentityProviderEventAttempts;
        const now = this.dependencies.now();
        await events.transaction((executor) =>
          events.settle(executor, {
            ...(retired
              ? { failureReason: 'processing_failed' }
              : {
                  availableAt: new Date(
                    now.getTime() + backoffMilliseconds(event.attempts),
                  ),
                }),
            id: event.id,
            now,
            owner,
            state: retired ? 'dead_letter' : 'retry_wait',
          }),
        );
        if (retired) deadLettered += 1;
        else retried += 1;
        logger.error(
          {
            attempts: event.attempts,
            errorClass:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            provider: event.provider,
          },
          retired
            ? 'identity provider event dead-lettered'
            : 'identity provider event processing failed',
        );
      }
    }

    return {
      claimed: claimed.length,
      deadLettered,
      ignored,
      processed,
      retried,
    };
  }

  private async apply(event: IdentityProviderEventRow): Promise<boolean> {
    const { provider, repository } = this.dependencies;
    if (
      event.provider !== provider.provider ||
      event.providerAccount !== provider.account ||
      event.providerEnvironment !== provider.environment ||
      event.providerReference === null
    ) {
      throw new Error('configured identity provider cannot process receipt');
    }

    // Provider I/O is outside every PostgreSQL transaction.
    const snapshot = await provider.retrieveCurrentState(
      event.providerReference,
    );
    if (!isIdentityProviderSnapshot(snapshot)) {
      throw new Error('identity provider returned an invalid snapshot');
    }
    if (snapshot.providerReference !== event.providerReference) {
      return false;
    }
    const attempt = await repository.findByProviderIdentity(
      repository.transactionless,
      {
        provider: provider.provider,
        providerIdempotencyKey: snapshot.providerIdempotencyKey,
        providerReference: snapshot.providerReference,
      },
    );
    if (
      attempt?.subjectId !== snapshot.platformSubjectReference ||
      attempt.providerIdempotencyKey !== snapshot.providerIdempotencyKey
    ) {
      return false;
    }

    return repository.transaction(async (executor) => {
      const current = await repository.findByIdForUpdate(executor, attempt.id);
      if (
        current?.subjectId !== snapshot.platformSubjectReference ||
        current.provider !== provider.provider ||
        current.providerIdempotencyKey !== snapshot.providerIdempotencyKey ||
        (current.providerReference !== null &&
          current.providerReference !== snapshot.providerReference)
      ) {
        return false;
      }
      return this.applySnapshot(executor, current, snapshot);
    });
  }

  private async applySnapshot(
    executor: TransactionHandle,
    original: IdentityAttemptRow,
    snapshot: IdentityProviderSnapshot,
  ): Promise<boolean> {
    const { repository } = this.dependencies;
    let attempt = original;

    if (attempt.providerReference === null) {
      if (attempt.state !== 'provider_starting') return false;
      const bound = await repository.transitionAttempt(executor, {
        attemptId: attempt.id,
        from: ['provider_starting'],
        now: this.dependencies.now(),
        providerReference: snapshot.providerReference,
        to: 'provider_pending',
      });
      if (bound === undefined) return false;
      attempt = bound;
    }

    if (terminalIdentityAttemptStates.includes(attempt.state)) {
      if (attempt.state !== 'succeeded') {
        return snapshot.state === attempt.state;
      }
      if (snapshot.state === 'succeeded') return true;
      if (snapshot.state !== 'revoked' && snapshot.state !== 'expired') {
        return false;
      }
      return this.appendExpectedEvidence(
        executor,
        attempt,
        snapshot,
        snapshot.state,
      );
    }

    switch (snapshot.state) {
      case 'pending':
        return attempt.state === 'provider_pending';
      case 'processing': {
        if (attempt.state === 'processing') return true;
        return (
          (await repository.transitionAttempt(executor, {
            attemptId: attempt.id,
            from: ['provider_pending'],
            now: this.dependencies.now(),
            to: 'processing',
          })) !== undefined
        );
      }
      case 'succeeded':
      case 'refused': {
        const evidence = await this.appendExpectedEvidence(
          executor,
          attempt,
          snapshot,
          snapshot.state === 'succeeded' ? 'granted' : 'refused',
        );
        if (!evidence) return false;
        return (
          (await repository.transitionAttempt(executor, {
            attemptId: attempt.id,
            from: ['provider_pending', 'processing'],
            now: this.dependencies.now(),
            to: snapshot.state,
          })) !== undefined
        );
      }
      case 'failed':
      case 'cancelled':
      case 'expired': {
        if (snapshot.state === 'expired') {
          const facts = matchingFacts(attempt, snapshot, 'expired');
          const fact = facts.length === 1 ? facts[0] : undefined;
          if (fact !== undefined) {
            const appended = await this.appendFact(executor, attempt, fact);
            if (!appended) return false;
          }
        }
        return (
          (await repository.transitionAttempt(executor, {
            attemptId: attempt.id,
            from: ['provider_pending', 'processing'],
            now: this.dependencies.now(),
            to: snapshot.state,
          })) !== undefined
        );
      }
      case 'revoked':
        return false;
    }
  }

  private async appendExpectedEvidence(
    executor: TransactionHandle,
    attempt: IdentityAttemptRow,
    snapshot: IdentityProviderSnapshot,
    result: IdentityProviderEvidenceFact['normalizedResult'],
  ): Promise<boolean> {
    const facts = matchingFacts(attempt, snapshot, result);
    const fact = facts.length === 1 ? facts[0] : undefined;
    if (fact === undefined) return false;

    if (result === 'granted') {
      const current = await this.dependencies.repository.findCurrentEvidence(
        executor,
        attempt.subjectId,
        attempt.requiredEvidenceClass,
      );
      if (current !== undefined && current.normalizedResult !== 'granted') {
        return false;
      }
    }
    return this.appendFact(executor, attempt, fact);
  }

  private async appendFact(
    executor: TransactionHandle,
    attempt: IdentityAttemptRow,
    fact: IdentityProviderEvidenceFact,
  ): Promise<boolean> {
    const now = this.dependencies.now();
    if (fact.effectiveAt > now) return false;
    if (
      fact.normalizedResult === 'granted' &&
      fact.expiresAt !== undefined &&
      fact.expiresAt <= now
    ) {
      return false;
    }
    const result = await this.dependencies.repository.appendEvidence(executor, {
      attemptId: attempt.id,
      effectiveAt: fact.effectiveAt,
      evidenceClass: fact.evidenceClass,
      ...(fact.expiresAt === undefined ? {} : { expiresAt: fact.expiresAt }),
      normalizedResult: fact.normalizedResult,
      now,
      policyVersion: attempt.policyVersion,
      provider: attempt.provider,
      providerFactReference: fact.providerFactReference,
      subjectId: attempt.subjectId,
      thresholdContext: fact.thresholdContext,
    });
    if (result.kind === 'mismatch' || result.kind === 'stale') return false;
    if (result.kind === 'inserted') {
      const payload: IdentityEvidenceRecordedPayload = {
        effectiveAt: result.evidence.effectiveAt.toISOString(),
        evidenceClass: result.evidence.evidenceClass,
        evidenceId: result.evidence.id,
        ...(result.evidence.expiresAt === null
          ? {}
          : { expiresAt: result.evidence.expiresAt.toISOString() }),
        normalizedResult: result.evidence.normalizedResult,
        policyVersion: result.evidence.policyVersion,
        subjectId: result.evidence.subjectId,
        thresholdContext: result.evidence.thresholdContext,
      };
      await this.dependencies.outbox.append(executor, {
        eventName: identityEvidenceRecordedEvent,
        eventVersion: 1,
        now,
        occurredAt: result.evidence.effectiveAt,
        payload,
        subjectId: result.evidence.subjectId,
        subjectType: 'identity.subject',
      });
    }
    return true;
  }
}

function matchingFacts(
  attempt: IdentityAttemptRow,
  snapshot: IdentityProviderSnapshot,
  result: IdentityProviderEvidenceFact['normalizedResult'],
): readonly IdentityProviderEvidenceFact[] {
  return snapshot.evidence.filter(
    (fact) =>
      fact.evidenceClass === attempt.requiredEvidenceClass &&
      fact.thresholdContext === attempt.requiredThreshold &&
      fact.normalizedResult === result,
  );
}
