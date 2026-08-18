import { createHash } from 'node:crypto';

import type { IdentityJurisdictionPolicyPort } from './jurisdiction.js';
import {
  identityCodePattern,
  identityEvidenceClasses,
  identityOwnerDomains,
  identityPurposes,
  jurisdictionCodePattern,
  maximumIdentityIdempotencyKeyLength,
  maximumIdentityProviderReferenceLength,
  type IdentityOwnerDomain,
  type IdentityPurpose,
} from './policy.js';
import {
  IdentityProviderUnavailableError,
  isIdentityHostedSession,
  type IdentityHostedSession,
  type IdentityVerificationProviderPort,
} from './provider.js';
import type {
  IdentityAttemptRow,
  IdentityRepository,
  IdentitySubjectRow,
} from './repository.js';

export type IdentityStartRefusal =
  | 'active_attempt_exists'
  | 'idempotency_mismatch'
  | 'invalid_input'
  | 'policy_blocked'
  | 'policy_unknown'
  | 'provider_unavailable';

export type IdentityStartOutcome =
  | {
      readonly attempt: IdentityAttemptRow;
      readonly handoff?: { readonly expiresAt: Date; readonly url: string };
      readonly kind: 'started';
      readonly recoverable: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: IdentityStartRefusal };

/**
 * Input accepted only from an owner-domain application service after it has
 * authorized actor, subject, purpose, and jurisdiction. No HTTP route exposes
 * this contract in V1.
 */
export interface AuthorizedIdentityStart {
  readonly callerIdempotencyKey: string;
  readonly correlationId: string;
  readonly jurisdiction: string;
  readonly ownerDomain: IdentityOwnerDomain;
  readonly ownerReference: string;
  readonly purpose: IdentityPurpose;
}

export class IdentityOrchestrator {
  constructor(
    private readonly dependencies: {
      readonly jurisdictionPolicy: IdentityJurisdictionPolicyPort;
      readonly now: () => Date;
      readonly provider: IdentityVerificationProviderPort;
      readonly repository: IdentityRepository;
    },
  ) {}

  /**
   * Establishes and starts one provider instruction.
   *
   * Policy and provider eligibility are checked before persistence. The
   * attempt commits before provider I/O. A conditional state claim lets fifty
   * equivalent calls create one provider instruction; an ambiguous result
   * remains recoverable by the same provider idempotency key.
   */
  async start(input: AuthorizedIdentityStart): Promise<IdentityStartOutcome> {
    if (!validInput(input)) return refused('invalid_input');

    const policy = this.dependencies.jurisdictionPolicy.evaluate(input);
    if (policy.kind === 'UNKNOWN') return refused('policy_unknown');
    if (policy.kind === 'BLOCKED') return refused('policy_blocked');
    if (
      !identityEvidenceClasses.includes(policy.requiredEvidenceClass) ||
      !new RegExp(identityCodePattern, 'u').test(policy.policyVersion) ||
      !new RegExp(identityCodePattern, 'u').test(policy.requiredThreshold)
    ) {
      return refused('policy_unknown');
    }

    const provider = this.dependencies.provider;
    if (
      provider.provider === 'unavailable' ||
      !new RegExp(identityCodePattern, 'u').test(provider.provider) ||
      !provider.capabilities.hostedSession ||
      !provider.capabilities.lookupByIdempotencyKey ||
      !provider.capabilities.purposes.includes(input.purpose) ||
      !provider.capabilities.evidenceClasses.includes(
        policy.requiredEvidenceClass,
      )
    ) {
      return refused('provider_unavailable');
    }

    const ownerReference = input.ownerReference.toLowerCase();
    const inputDigest = digestOf([
      input.ownerDomain,
      ownerReference,
      input.purpose,
      input.jurisdiction,
      policy.policyVersion,
      policy.requiredEvidenceClass,
      policy.requiredThreshold,
    ]);
    const providerIdempotencyKey = `identity-${digestOf([
      input.ownerDomain,
      ownerReference,
      input.purpose,
      input.callerIdempotencyKey,
    ])}`;
    const established = await this.dependencies.repository.establishAttempt({
      callerIdempotencyKey: input.callerIdempotencyKey,
      inputDigest,
      jurisdiction: input.jurisdiction,
      now: this.dependencies.now(),
      ownerDomain: input.ownerDomain,
      ownerReference,
      policyVersion: policy.policyVersion,
      provider: provider.provider,
      providerIdempotencyKey,
      purpose: input.purpose,
      requiredEvidenceClass: policy.requiredEvidenceClass,
      requiredThreshold: policy.requiredThreshold,
    });
    if (established.kind === 'idempotency_mismatch') {
      return refused('idempotency_mismatch');
    }
    if (established.kind === 'active_attempt_exists') {
      return refused('active_attempt_exists');
    }

    return this.startOrRecover({
      attempt: established.attempt,
      correlationId: input.correlationId,
      subject: established.subject,
    });
  }

  private async startOrRecover(input: {
    readonly attempt: IdentityAttemptRow;
    readonly correlationId: string;
    readonly subject: IdentitySubjectRow;
  }): Promise<IdentityStartOutcome> {
    if (
      input.attempt.state === 'provider_starting' ||
      input.attempt.state === 'provider_pending'
    ) {
      return this.recoverByIdempotency(input.attempt, input.subject);
    }
    if (input.attempt.state !== 'created') {
      return started(input.attempt, true);
    }

    const claimed = await this.dependencies.repository.transaction(
      async (executor) =>
        this.dependencies.repository.transitionAttempt(executor, {
          attemptId: input.attempt.id,
          from: ['created'],
          now: this.dependencies.now(),
          to: 'provider_starting',
        }),
    );
    if (claimed === undefined) {
      const current = await this.dependencies.repository.findById(
        this.dependencies.repository.transactionless,
        input.attempt.id,
      );
      if (current?.state === 'provider_starting') {
        return this.recoverByIdempotency(current, input.subject);
      }
      return started(current ?? input.attempt, true);
    }

    let session: IdentityHostedSession;
    try {
      // Deliberately outside both repository transactions.
      session = await this.dependencies.provider.createHostedSession({
        attemptReference: claimed.id,
        correlationId: input.correlationId,
        evidenceClass: claimed.requiredEvidenceClass,
        jurisdiction: claimed.jurisdiction,
        platformSubjectReference: input.subject.id,
        policyVersion: claimed.policyVersion,
        providerIdempotencyKey: claimed.providerIdempotencyKey,
        purpose: claimed.purpose,
        thresholdContext: claimed.requiredThreshold,
      });
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) {
        await this.dependencies.repository.transaction(async (executor) =>
          this.dependencies.repository.transitionAttempt(executor, {
            attemptId: claimed.id,
            from: ['provider_starting'],
            now: this.dependencies.now(),
            to: 'unavailable',
          }),
        );
        return refused('provider_unavailable');
      }
      // Provider may have acted. Never retry under a new key or call it a
      // failure; reconciliation or a same-key recovery resolves this state.
      return started(claimed, true);
    }
    return this.bindSession(claimed, input.subject, session);
  }

  private async recoverByIdempotency(
    attempt: IdentityAttemptRow,
    subject: IdentitySubjectRow,
  ): Promise<IdentityStartOutcome> {
    let session: IdentityHostedSession | undefined;
    try {
      // Also outside a transaction. This is a read under the stable key, never
      // a second instruction.
      session = await this.dependencies.provider.retrieveByIdempotencyKey(
        attempt.providerIdempotencyKey,
      );
    } catch {
      return started(attempt, true);
    }
    if (session === undefined) return started(attempt, true);
    return this.bindSession(attempt, subject, session);
  }

  private async bindSession(
    attempt: IdentityAttemptRow,
    subject: IdentitySubjectRow,
    session: IdentityHostedSession,
  ): Promise<IdentityStartOutcome> {
    if (
      !isIdentityHostedSession(session) ||
      session.snapshot.platformSubjectReference !== subject.id ||
      session.snapshot.providerIdempotencyKey !==
        attempt.providerIdempotencyKey ||
      session.snapshot.providerReference.length === 0 ||
      session.snapshot.providerReference.length >
        maximumIdentityProviderReferenceLength
    ) {
      return started(attempt, true);
    }
    const recorded = await this.dependencies.repository.transaction(
      async (executor) =>
        this.dependencies.repository.transitionAttempt(executor, {
          attemptId: attempt.id,
          from: ['provider_starting'],
          now: this.dependencies.now(),
          providerReference: session.snapshot.providerReference,
          to: 'provider_pending',
        }),
    );
    const current =
      recorded ??
      (await this.dependencies.repository.findById(
        this.dependencies.repository.transactionless,
        attempt.id,
      )) ??
      attempt;
    const handoff = safeHandoff(session, this.dependencies.now());
    return started(current, true, handoff);
  }
}

function validInput(input: AuthorizedIdentityStart): boolean {
  return (
    identityOwnerDomains.includes(input.ownerDomain) &&
    identityPurposes.includes(input.purpose) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.ownerReference,
    ) &&
    new RegExp(jurisdictionCodePattern, 'u').test(input.jurisdiction) &&
    input.callerIdempotencyKey.length >= 8 &&
    input.callerIdempotencyKey.length <= maximumIdentityIdempotencyKeyLength &&
    /^[A-Za-z0-9._-]+$/u.test(input.callerIdempotencyKey) &&
    /^[A-Za-z0-9._:-]{1,128}$/u.test(input.correlationId)
  );
}

function digestOf(parts: readonly string[]): string {
  return createHash('sha256')
    .update(parts.join('\u0000'), 'utf8')
    .digest('hex');
}

function safeHandoff(
  session: IdentityHostedSession,
  now: Date,
): { readonly expiresAt: Date; readonly url: string } | undefined {
  try {
    if (
      typeof session.hostedUrl !== 'string' ||
      !(session.expiresAt instanceof Date)
    ) {
      return undefined;
    }
    const url = new URL(session.hostedUrl);
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !Number.isFinite(session.expiresAt.getTime()) ||
      session.expiresAt <= now
    ) {
      return undefined;
    }
    return { expiresAt: session.expiresAt, url: url.toString() };
  } catch {
    return undefined;
  }
}

function refused(reason: IdentityStartRefusal): IdentityStartOutcome {
  return { kind: 'refused', reason };
}

function started(
  attempt: IdentityAttemptRow,
  recoverable: boolean,
  handoff?: { readonly expiresAt: Date; readonly url: string },
): IdentityStartOutcome {
  return {
    attempt,
    ...(handoff === undefined ? {} : { handoff }),
    kind: 'started',
    recoverable,
  };
}
