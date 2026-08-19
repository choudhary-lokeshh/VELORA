import type { Executor } from '../database/executor.js';
import { lockSubject } from '../database/subject-lock.js';
import type { IdentityDepictedPersonEvidenceReaderPort } from '../identity/assurance-reader.js';
import {
  consentPolicyVersion,
  maximumConsentRecordsPerContent,
  maximumDepictedPersonPageSize,
  type ConsentDenialReason,
  type ConsentScope,
  type DepictionDeclaration,
} from './policy.js';
import type {
  ConsentRecordRow,
  DepictedParticipantRow,
  DepictionRow,
  SafetyRepository,
} from './repository.js';

/**
 * Depicted-person evidence and consent.
 *
 * Two questions the platform must be able to answer about a piece of creator
 * content, and they are not the same question. *Who is depicted, and did
 * anybody check?* is identity and age evidence. *What did that person agree
 * to?* is consent, and it is scoped rather than universal.
 *
 * Identity/adult evidence is held by IDENTITY ASSURANCE. SAFETY stores one
 * opaque subject reference plus its own scoped consent records. Velora stores
 * no identification document, image, or biometric template here, and builds no
 * identity matching: [surface and distribution
 * eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * records the reasoning, which is that such a table would be the highest-value
 * breach target the platform could build in exchange for evidence Velora is
 * probably not the right party to hold. Whether Velora is that party at all is
 * a legal question recorded as unresolved rather than answered here.
 *
 * Two independent gates guard all of it and neither is enough alone. IDENTITY
 * must publish current identity and adult-threshold grants for the exact SAFETY
 * assertion. The wording policy must publish what the depicted person agreed
 * to. Both remain unavailable in deployed environments.
 */

/**
 * The approved wording a depicted person agrees to, per scope.
 *
 * Legal copy, and therefore a human gate rather than a code change.
 * `undefined` means nothing is approved for that scope, and the authority then
 * records no grant for it — because a consent record is a claim that a person
 * agreed to specific words, and there are none.
 */
export interface ConsentCopyPolicy {
  readonly name: string;
  approvedCopyVersion(scope: ConsentScope): string | undefined;
}

/** Publishes no wording, which is the only honest state today. */
export class UnpublishedConsentPolicy implements ConsentCopyPolicy {
  readonly name = 'unpublished';

  approvedCopyVersion(): string | undefined {
    return undefined;
  }
}

/**
 * Development and test wording.
 *
 * Deliberately named so nothing using it reads as approved legal copy, and
 * refused outside the local and test environments by configuration.
 */
export class LocalTestConsentPolicy implements ConsentCopyPolicy {
  readonly name = 'local-test';

  approvedCopyVersion(scope: ConsentScope): string {
    return `local-test-${scope}-v1`;
  }
}

/** Whether a content item's consent evidence covers one scope. */
export interface ConsentDecision {
  readonly policyVersion: string;
  /** Absent when satisfied. Coarse, and never about who is depicted. */
  readonly reasonCode: ConsentDenialReason | undefined;
  readonly satisfied: boolean;
}

/**
 * The depicted-person answer TRUST & SAFETY publishes.
 *
 * Asked by whichever domain is about to publish, deliver, or monetise a
 * depiction. It takes the caller's executor on the same rule the rest of this
 * domain's contracts do: a check that commits separately from the write it
 * authorizes is not a check. A caller authorizing a mutation takes the subject
 * lock on the content item first, so a revocation arriving at the same moment
 * either completes before the check or waits and is then seen.
 */
export interface DepictedPersonConsentPort {
  consentSatisfied(input: {
    readonly contentId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly scope: ConsentScope;
  }): Promise<ConsentDecision>;
}

export interface DepictedParticipantView {
  readonly contentId: string;
  readonly declaredAt: Date;
  readonly evidenceState: 'asserted' | 'identity_referenced';
  readonly id: string;
  readonly identitySubjectReference: string | null;
  readonly supersedesId: string | null;
}

export interface ConsentRecordView {
  readonly disposition: 'grant' | 'revoke';
  readonly id: string;
  readonly participantId: string;
  readonly recordedAt: Date;
  readonly scope: ConsentScope;
  readonly supersedesId: string | null;
}

export type DeclarationOutcome =
  | { readonly kind: 'recorded'; readonly declaration: DepictionRow }
  /** Somebody changed the answer first; re-read and answer again. */
  | { readonly kind: 'conflict' };

export type ParticipantOutcome =
  | {
      readonly kind: 'declared';
      readonly participant: DepictedParticipantView;
    }
  /** The item carries no declaration, so there is nobody to add a person to. */
  | { readonly kind: 'undeclared' }
  /** The declaration says nobody is depicted. */
  | { readonly kind: 'not_applicable' }
  /** The item is at the bound that keeps the gate query complete. */
  | { readonly kind: 'too_many' };

export type IdentityLinkOutcome =
  | {
      readonly kind: 'linked';
      readonly grantedScopes: readonly ConsentScope[];
      readonly participant: DepictedParticipantView;
    }
  | { readonly kind: 'not_found' }
  /** The exact Identity subject lacks one of the two current grants. */
  | { readonly kind: 'not_verified' }
  /** Already linked, already replaced, invalid evidence, or at the bound. */
  | { readonly kind: 'conflict' };

export type RevocationOutcome =
  | { readonly kind: 'revoked'; readonly consent: ConsentRecordView }
  | { readonly kind: 'not_found' }
  /** Nothing live to withdraw, or somebody withdrew it first. */
  | { readonly kind: 'conflict' };

export interface DepictedPersonConsentDependencies {
  readonly copy: ConsentCopyPolicy;
  readonly identityEvidence: IdentityDepictedPersonEvidenceReaderPort;
  readonly now: () => Date;
  readonly repository: SafetyRepository;
}

export class DepictedPersonConsentService implements DepictedPersonConsentPort {
  constructor(
    private readonly dependencies: DepictedPersonConsentDependencies,
  ) {}

  /**
   * Records what the creator says about who appears in an item.
   *
   * Mutable, and the only mutable record in this model: a creator who adds a
   * person to a shoot has changed the answer rather than falsified the old one.
   * The evidence — who is depicted, and what they agreed to — is append-only,
   * because that is the part an audit reads.
   *
   * A first answer needs no version. Changing one does, so two Studio tabs
   * produce one answer and the loser is told rather than overwriting.
   */
  async declare(input: {
    readonly contentId: string;
    readonly creatorId: string;
    readonly declaration: DepictionDeclaration;
    readonly expectedVersion?: number | undefined;
  }): Promise<DeclarationOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      await lockSubject(executor, input.contentId);
      const current = await repository.findDepiction(executor, input.contentId);
      if (current === undefined) {
        const created = await repository.insertDepiction(executor, {
          contentId: input.contentId,
          creatorId: input.creatorId,
          declaration: input.declaration,
          now,
          policyVersion: consentPolicyVersion,
        });
        return created === undefined
          ? { kind: 'conflict' as const }
          : { declaration: created, kind: 'recorded' as const };
      }
      // Changing an existing answer requires naming the one being replaced. A
      // caller that omitted it would overwrite whatever is there, and "who is
      // in this item" is not a field to lose a race on.
      if (current.version !== input.expectedVersion) {
        return { kind: 'conflict' as const };
      }
      const updated = await repository.updateDepiction(executor, {
        contentId: input.contentId,
        declaration: input.declaration,
        expectedVersion: current.version,
        now,
      });
      return updated === undefined
        ? { kind: 'conflict' as const }
        : { declaration: updated, kind: 'recorded' as const };
    });
  }

  /**
   * Declares that one more person appears in an item.
   *
   * Recorded as an assertion, which is exactly what it is: nobody has examined
   * anything yet. It carries no evidence reference and a constraint refuses
   * one, so a caller cannot dress an assertion as verification by filling in a
   * field — and the request shape has no field to fill.
   */
  async declareParticipant(input: {
    readonly contentId: string;
    readonly creatorId: string;
  }): Promise<ParticipantOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      await lockSubject(executor, input.contentId);
      const declaration = await repository.findDepiction(
        executor,
        input.contentId,
      );
      if (declaration === undefined) return { kind: 'undeclared' as const };
      if (declaration.declaration === 'no_depicted_persons') {
        return { kind: 'not_applicable' as const };
      }
      // Bounded on the way in, so the gate query can read every record without
      // a page boundary hiding somebody's withdrawal behind it.
      const declared = await repository.countParticipants(
        executor,
        input.contentId,
      );
      if (declared >= maximumDepictedPersonPageSize) {
        return { kind: 'too_many' as const };
      }
      const participant = await repository.insertParticipant(executor, {
        contentId: input.contentId,
        creatorId: input.creatorId,
        evidenceState: 'asserted',
        identitySubjectReference: null,
        now,
        policyVersion: consentPolicyVersion,
        supersedesId: null,
      });
      return {
        kind: 'declared' as const,
        participant: participantView(participant),
      };
    });
  }

  /**
   * Links an assertion to an already-established IDENTITY subject and records
   * only normalized consent-capture references whose wording is approved.
   *
   * This is an internal owner-service contract, not an HTTP request. The caller
   * has already authorized the SAFETY assertion and normalized any consent
   * capture. IDENTITY independently proves that the supplied subject belongs to
   * this assertion and currently holds both required grants.
   *
   * Linkage supersedes the assertion rather than editing it, so what the creator
   * originally said stays exactly as they said it.
   */
  async linkParticipant(input: {
    readonly actorReference: string;
    readonly consentEvidenceReferences: Readonly<
      Partial<Record<ConsentScope, string>>
    >;
    readonly consentExpiresAt?: Date | undefined;
    readonly identitySubjectReference: string;
    readonly participantId: string;
    readonly scopes: readonly ConsentScope[];
  }): Promise<IdentityLinkOutcome> {
    const { copy, identityEvidence, repository } = this.dependencies;
    const now = this.dependencies.now();
    if (input.consentExpiresAt !== undefined && input.consentExpiresAt <= now) {
      return { kind: 'conflict' };
    }
    const asserted = await repository.findParticipant(
      repository.transactionless,
      input.participantId,
    );
    if (asserted === undefined) return { kind: 'not_found' };
    if (asserted.evidenceState !== 'asserted') return { kind: 'conflict' };

    const identity = await identityEvidence.currentForSafetyParticipant({
      executor: repository.transactionless,
      now,
      participantReference: asserted.id,
      subjectReference: input.identitySubjectReference,
    });
    if (
      identity?.identityStanding !== 'granted' ||
      identity.adultStanding !== 'granted'
    ) {
      return { kind: 'not_verified' };
    }
    const requestedScopes = [...new Set(input.scopes)];
    const grantableScopes = requestedScopes.filter(
      (scope) =>
        copy.approvedCopyVersion(scope) !== undefined &&
        input.consentEvidenceReferences[scope] !== undefined,
    );

    return repository
      .transaction(async (executor) => {
        await lockSubject(executor, asserted.contentId);
        const recorded = await repository.countConsentRecords(
          executor,
          asserted.contentId,
        );
        if (
          recorded + grantableScopes.length >=
            maximumConsentRecordsPerContent ||
          (await repository.countParticipants(executor, asserted.contentId)) >=
            maximumDepictedPersonPageSize
        ) {
          return { kind: 'conflict' as const };
        }
        const participant = await repository.insertParticipant(executor, {
          contentId: asserted.contentId,
          creatorId: asserted.creatorId,
          evidenceState: 'identity_referenced',
          identitySubjectReference: identity.subjectReference,
          now,
          policyVersion: consentPolicyVersion,
          supersedesId: asserted.id,
        });

        const grantedScopes: ConsentScope[] = [];
        for (const scope of grantableScopes) {
          const copyVersion = copy.approvedCopyVersion(scope);
          const evidence = input.consentEvidenceReferences[scope];
          // Two independent gates. No approved wording means no grant, however
          // willing the person was, because a record would claim they agreed to
          // words that do not exist. No captured evidence means the verifier did
          // not obtain consent for that scope, whatever was asked.
          if (copyVersion === undefined || evidence === undefined) continue;
          await repository.insertConsentRecord(executor, {
            actorReference: input.actorReference,
            consentEvidenceReference: evidence,
            contentId: asserted.contentId,
            copyVersion,
            disposition: 'grant',
            expiresAt: input.consentExpiresAt ?? null,
            now,
            participantId: participant.id,
            policyVersion: consentPolicyVersion,
            scope,
            supersedesId: null,
          });
          grantedScopes.push(scope);
        }
        return {
          grantedScopes,
          kind: 'linked' as const,
          participant: participantView(participant),
        };
      })
      .catch((error: unknown) => {
        // Two links of the same assertion or Identity subject. PostgreSQL
        // decides, and the loser is told rather than creating a fork.
        if (isUniqueViolation(error)) return { kind: 'conflict' as const };
        throw error;
      });
  }

  /**
   * Withdraws one scope of one person's consent.
   *
   * A second record naming the grant it withdraws, never an edit and never a
   * deletion: a depicted person who later relies on having withdrawn permission
   * needs both facts to survive, and so does the platform.
   */
  async revokeConsent(input: {
    readonly actorReference: string;
    readonly consentId: string;
  }): Promise<RevocationOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const grant = await repository.findConsentRecord(
      repository.transactionless,
      input.consentId,
    );
    if (grant?.disposition !== 'grant') return { kind: 'not_found' };
    return repository
      .transaction(async (executor) => {
        await lockSubject(executor, grant.contentId);
        const revocation = await repository.insertConsentRecord(executor, {
          actorReference: input.actorReference,
          consentEvidenceReference: null,
          contentId: grant.contentId,
          copyVersion: grant.copyVersion,
          disposition: 'revoke',
          expiresAt: null,
          now,
          participantId: grant.participantId,
          policyVersion: consentPolicyVersion,
          scope: grant.scope,
          supersedesId: grant.id,
        });
        return { consent: consentView(revocation), kind: 'revoked' as const };
      })
      .catch((error: unknown) => {
        // The partial unique index refused it: somebody withdrew this grant
        // first, and two withdrawals of one decision would be two histories.
        if (isUniqueViolation(error)) return { kind: 'conflict' as const };
        throw error;
      });
  }

  /** Everybody currently declared on an item, superseded records excluded. */
  async participantsFor(
    contentId: string,
  ): Promise<readonly DepictedParticipantView[]> {
    const { repository } = this.dependencies;
    const rows = await repository.listParticipants(
      repository.transactionless,
      contentId,
    );
    return liveParticipants(rows).map(participantView);
  }

  async consentRecordsFor(
    contentId: string,
  ): Promise<readonly ConsentRecordView[]> {
    const { repository } = this.dependencies;
    const rows = await repository.listConsentRecords(
      repository.transactionless,
      { contentId },
    );
    return rows.map(consentView);
  }

  /**
   * Whether an item's depicted-person evidence covers one scope.
   *
   * Every step fails closed, and the order matters: an item nobody has been
   * asked about is not the same as an item with nobody in it, and neither is
   * the same as an item whose people are declared and unverified. Reporting the
   * first failing condition is what lets whoever has to close the gate know
   * which gate it is.
   */
  async consentSatisfied(input: {
    readonly contentId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly scope: ConsentScope;
  }): Promise<ConsentDecision> {
    const { repository } = this.dependencies;
    const declaration = await repository.findDepiction(
      input.executor,
      input.contentId,
    );
    if (declaration === undefined) return denied('undeclared');
    if (declaration.declaration === 'no_depicted_persons') {
      // Nobody is depicted, so there is nobody to have consented. This is the
      // one satisfied answer that needs no verifier and no wording.
      return {
        policyVersion: consentPolicyVersion,
        reasonCode: undefined,
        satisfied: true,
      };
    }

    const participants = liveParticipants(
      await repository.listParticipants(input.executor, input.contentId),
    );
    if (participants.length === 0) return denied('participants_missing');
    if (
      participants.some((row) => row.evidenceState !== 'identity_referenced')
    ) {
      return denied('assertion_only');
    }
    const identityDecisions = await Promise.all(
      participants.map((participant) =>
        this.dependencies.identityEvidence.currentForSafetyParticipant({
          executor: input.executor,
          now: input.now,
          participantReference: participant.supersedesId ?? participant.id,
          subjectReference: participant.identitySubjectReference ?? '',
        }),
      ),
    );
    if (
      identityDecisions.some(
        (decision) =>
          decision?.adultStanding === 'expired' ||
          decision?.identityStanding === 'expired',
      )
    ) {
      return denied('evidence_expired');
    }
    if (
      identityDecisions.some(
        (decision) =>
          decision?.adultStanding !== 'granted' ||
          decision.identityStanding !== 'granted',
      )
    ) {
      return denied('assertion_only');
    }
    if (this.dependencies.copy.approvedCopyVersion(input.scope) === undefined) {
      // Even a stored grant could not be relied on: nobody has approved what a
      // person agreeing to this scope would be agreeing to.
      return denied('authority_unavailable');
    }

    const records = await repository.listConsentRecords(input.executor, {
      contentId: input.contentId,
      scope: input.scope,
    });
    const superseded = new Set(
      records
        .map((row) => row.supersedesId)
        .filter((id): id is string => id !== null),
    );
    for (const participant of participants) {
      const mine = records.filter(
        (row) => row.participantId === participant.id,
      );
      const grants = mine.filter((row) => row.disposition === 'grant');
      if (grants.length === 0) return denied('consent_missing');
      const live = grants.filter(
        (row) =>
          !superseded.has(row.id) &&
          row.recordedAt <= input.now &&
          (row.expiresAt === null || row.expiresAt > input.now),
      );
      if (live.length > 0) continue;
      return denied(
        grants.some((row) => superseded.has(row.id))
          ? 'consent_revoked'
          : 'consent_expired',
      );
    }
    return {
      policyVersion: consentPolicyVersion,
      reasonCode: undefined,
      satisfied: true,
    };
  }
}

function denied(reasonCode: ConsentDenialReason): ConsentDecision {
  return { policyVersion: consentPolicyVersion, reasonCode, satisfied: false };
}

/**
 * The tail of every participant chain.
 *
 * A verification supersedes the assertion it replaces, so the record that
 * describes a person now is the one nothing else claims to replace.
 */
function liveParticipants(
  rows: readonly DepictedParticipantRow[],
): readonly DepictedParticipantRow[] {
  const superseded = new Set(
    rows
      .map((row) => row.supersedesId)
      .filter((id): id is string => id !== null),
  );
  return rows.filter((row) => !superseded.has(row.id));
}

function participantView(row: DepictedParticipantRow): DepictedParticipantView {
  return {
    contentId: row.contentId,
    declaredAt: row.declaredAt,
    evidenceState: row.evidenceState,
    id: row.id,
    identitySubjectReference: row.identitySubjectReference,
    supersedesId: row.supersedesId,
  };
}

function consentView(row: ConsentRecordRow): ConsentRecordView {
  return {
    disposition: row.disposition,
    id: row.id,
    participantId: row.participantId,
    recordedAt: row.recordedAt,
    scope: row.scope,
    supersedesId: row.supersedesId,
  };
}

/**
 * PostgreSQL's unique-violation class, whichever field the driver puts it in.
 *
 * Bun's SQL client reports the SQLSTATE as `errno` and uses `code` for its own
 * error class; other drivers put the SQLSTATE in `code`. Both are checked
 * because a refusal that fell through as an unhandled error would turn "two
 * people withdrew the same permission" into a five hundred.
 */
function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver's error, so the SQLSTATE is on a cause rather than
  // on what the call site catches. Walking the chain is what makes this a
  // refusal rather than a five hundred.
  for (let current = error; current !== undefined && current !== null;) {
    if (typeof current !== 'object') return false;
    const { cause, code, errno } = current as {
      readonly cause?: unknown;
      readonly code?: unknown;
      readonly errno?: unknown;
    };
    if (code === '23505' || errno === '23505') return true;
    current = cause;
  }
  return false;
}
