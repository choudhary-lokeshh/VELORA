import type { Executor } from '../database/executor.js';
import { lockSubject } from '../database/subject-lock.js';
import type { AdultAssuranceLevel } from '../users/onboarding-policy.js';
import type { DepictedPersonConsentPort } from './consent.js';
import type { SafetyEligibilityPort } from './eligibility.js';
import {
  consentScopeFor,
  contentDenialReasons,
  contentSafetyPolicyVersion,
  matureContentClassifications,
  matureIneligibleSurfaces,
  matureViewerAssurance,
  type ContentCapability,
  type ContentClassification,
  type ContentDenialReason,
  type DistributionSurface,
  type SafetyCapability,
} from './policy.js';
import type { ClassificationRow, SafetyRepository } from './repository.js';

/**
 * The content safety gate.
 *
 * One place that answers whether a content item may be published, stay public,
 * be delivered to a surface, or be monetised. [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * requires this to be a **conjunction of independent gates** rather than a
 * property of one column, because every one of those gates is owned by a
 * different authority that can revoke independently: a store's policy, a
 * verifier's assessment, approved legal copy, a moderation decision, and a
 * viewer's own assurance.
 *
 * So the gate evaluates every applicable predicate rather than stopping at the
 * first refusal, and reports all of them. The headline reason is the strongest
 * one; the full set is what tells a creator or an operator how many separate
 * things would have to change, and it is what stops "we fixed the consent, so
 * it should work now" from being a reasonable thing to believe.
 *
 * **Nothing here can enable mature content.** The capability has exactly one
 * configured value in every environment and it is off. That is not a flag: the
 * configuration schema admits no other value, so there is no state to flip.
 */

export interface ContentSafetyRequest {
  readonly capability: ContentCapability;
  /** The class the caller believes this is. Cross-checked, never trusted. */
  readonly classification: ContentClassification;
  readonly contentId: string;
  readonly creatorId: string;
  readonly executor: Executor;
  readonly now: Date;
  readonly surface: DistributionSurface;
  /** What the viewer holds. Only consulted when delivering a mature class. */
  readonly viewerAdultAssurance?: AdultAssuranceLevel | undefined;
}

export interface ContentSafetyDecision {
  readonly allowed: boolean;
  /**
   * Every gate that is closed, strongest first. Empty when allowed.
   *
   * Reported in full on purpose. A caller told only the first refusal would
   * reasonably conclude that fixing it is enough, and for a mature class that
   * is never true.
   */
  readonly closedGates: readonly ContentDenialReason[];
  readonly policyVersion: string;
  /** The strongest closed gate, or absent when allowed. */
  readonly reasonCode: ContentDenialReason | undefined;
}

export interface ClassificationView {
  readonly classification: ContentClassification;
  readonly contentId: string;
  readonly declaredAt: Date;
  readonly version: number;
}

export type ClassificationOutcome =
  | { readonly kind: 'recorded'; readonly classification: ClassificationView }
  /** Somebody reclassified it first; re-read and declare again. */
  | { readonly kind: 'conflict' };

/**
 * The content answer TRUST & SAFETY publishes.
 *
 * PRIVATE CLUBS asks it before publishing or delivering, and BILLING before
 * monetising. Every method takes the caller's executor on the same rule the
 * rest of this domain's contracts do: a check that commits separately from the
 * write it authorizes is not a check.
 */
export interface ContentSafetyPort {
  decide(request: ContentSafetyRequest): Promise<ContentSafetyDecision>;
  /**
   * The delivery answer, for a caller that cannot assert what an item is.
   *
   * {@link decide} makes the caller name the classification and cross-checks
   * it, which is right for publishing: a creator declaring an item is the act
   * being authorised. It is wrong for delivery. The media platform asking
   * whether some bytes may be served has no business asserting what the item
   * is, and making it guess would mean either trusting the guess or refusing
   * every mature item for the misleading reason that the guess was wrong.
   *
   * So this reads the declaration itself and applies the same gates. An
   * undeclared item is treated as general, which is the same stance the
   * publish path already takes.
   */
  mayDeliver(request: {
    readonly contentId: string;
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly surface: DistributionSurface;
    readonly viewerAdultAssurance?: AdultAssuranceLevel | undefined;
  }): Promise<ContentSafetyDecision>;
}

export interface ContentSafetyDependencies {
  readonly consent: DepictedPersonConsentPort;
  readonly eligibility: SafetyEligibilityPort;
  /**
   * Whether the mature-content capability is on. It is not, in any
   * environment, and the configuration schema admits no value that would make
   * it so. Read from configuration rather than written as a constant, so the
   * gate reports what the deployment actually says.
   */
  readonly matureContentEnabled: boolean;
  readonly now: () => Date;
  readonly repository: SafetyRepository;
}

/** Which safety capability each content capability asks the enforcement log. */
const safetyCapabilityByContentCapability: Readonly<
  Record<ContentCapability, SafetyCapability>
> = {
  deliver: 'creator_publication',
  monetise: 'commercial_participation',
  publish: 'creator_publication',
  remain_public: 'creator_publication',
};

export class ContentSafetyGate implements ContentSafetyPort {
  constructor(private readonly dependencies: ContentSafetyDependencies) {}

  /**
   * Records what a content item is, as its creator declares it.
   *
   * Declaring an item mature enables nothing. It makes the item refusable for a
   * reason rather than refusable for a missing declaration, which is the only
   * thing a classification can do while the capability is off.
   */
  async classify(input: {
    readonly classification: ContentClassification;
    readonly contentId: string;
    readonly creatorId: string;
    readonly expectedVersion?: number | undefined;
  }): Promise<ClassificationOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      await lockSubject(executor, input.contentId);
      const current = await repository.findClassification(
        executor,
        input.contentId,
      );
      if (current === undefined) {
        const created = await repository.insertClassification(executor, {
          classification: input.classification,
          contentId: input.contentId,
          creatorId: input.creatorId,
          now,
          policyVersion: contentSafetyPolicyVersion,
        });
        return created === undefined
          ? { kind: 'conflict' as const }
          : {
              classification: classificationView(created),
              kind: 'recorded' as const,
            };
      }
      // Reclassifying requires naming the classification being replaced, for
      // the same reason changing a depiction declaration does: what an item is
      // is not a field to lose a race on.
      if (current.version !== input.expectedVersion) {
        return { kind: 'conflict' as const };
      }
      const updated = await repository.updateClassification(executor, {
        classification: input.classification,
        contentId: input.contentId,
        expectedVersion: current.version,
        now,
      });
      return updated === undefined
        ? { kind: 'conflict' as const }
        : {
            classification: classificationView(updated),
            kind: 'recorded' as const,
          };
    });
  }

  async classificationFor(
    contentId: string,
  ): Promise<ClassificationView | undefined> {
    const row = await this.dependencies.repository.findClassification(
      this.dependencies.repository.transactionless,
      contentId,
    );
    return row === undefined ? undefined : classificationView(row);
  }

  /**
   * Whether an item may be published, stay public, be delivered, or be
   * monetised, on this surface, right now.
   *
   * The gates are evaluated in a fixed order and every applicable one runs.
   * Two of them apply to any class, because an enforcement decision is not
   * about maturity: a restricted creator publishes nothing and a removed item
   * stays removed. The rest apply to the mature classes only, and while the
   * capability is off they are all closed together.
   */
  async mayDeliver(request: {
    readonly contentId: string;
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
    readonly surface: DistributionSurface;
    readonly viewerAdultAssurance?: AdultAssuranceLevel | undefined;
  }): Promise<ContentSafetyDecision> {
    const declared = await this.dependencies.repository.findClassification(
      request.executor,
      request.contentId,
    );
    return this.decide({
      capability: 'deliver',
      classification: declared?.classification ?? 'general',
      contentId: request.contentId,
      creatorId: request.creatorId,
      executor: request.executor,
      now: request.now,
      surface: request.surface,
      viewerAdultAssurance: request.viewerAdultAssurance,
    });
  }

  async decide(request: ContentSafetyRequest): Promise<ContentSafetyDecision> {
    const mature = matureContentClassifications.includes(
      request.classification,
    );
    const closed = new Set<ContentDenialReason>();

    if (mature && !this.dependencies.matureContentEnabled) {
      closed.add('mature_content_disabled');
    }
    if (mature && matureIneligibleSurfaces.includes(request.surface)) {
      // A property of the surface. Both stores prohibit the class outright with
      // no published approval path, so no configuration value, country row,
      // creator setting, or client field can change this.
      closed.add('surface_ineligible');
    }

    const declared = await this.dependencies.repository.findClassification(
      request.executor,
      request.contentId,
    );
    // A caller cannot decide at the call site what an item is. An undeclared
    // item is not general — it is unclassified — and a declared item is
    // whatever it was declared to be.
    if (
      declared === undefined
        ? request.classification !== 'general'
        : declared.classification !== request.classification
    ) {
      closed.add('classification_undeclared');
    }

    const capability = await this.dependencies.eligibility.decide({
      capability: safetyCapabilityByContentCapability[request.capability],
      executor: request.executor,
      now: request.now,
      subjectId: request.creatorId,
    });
    if (!capability.allowed) closed.add('creator_restricted');

    const objectRestricted =
      await this.dependencies.eligibility.isObjectRestricted({
        executor: request.executor,
        now: request.now,
        objectId: request.contentId,
        objectType: 'creator_content',
        subjectId: request.creatorId,
      });
    if (objectRestricted) closed.add('object_restricted');

    if (mature) {
      // Depicted-person evidence is required of the mature classes and of
      // nothing else. Whether a record-keeping duty attaches to general content
      // is the open legal question recorded in DECISIONS_REQUIRED, and an
      // obligation nobody has established is not one to invent here.
      const consent = await this.dependencies.consent.consentSatisfied({
        contentId: request.contentId,
        executor: request.executor,
        now: request.now,
        scope: consentScopeFor(request.capability),
      });
      if (!consent.satisfied) closed.add('consent_incomplete');

      if (
        request.capability === 'deliver' &&
        request.viewerAdultAssurance !== matureViewerAssurance
      ) {
        // Nothing weaker counts, and nothing else is accepted in its place: a
        // completed purchase, a club membership, a creator's assertion, and a
        // viewer's checkbox are none of them age assurance.
        closed.add('adult_assurance_insufficient');
      }
    }

    const closedGates = contentDenialReasons.filter((reason) =>
      closed.has(reason),
    );
    return {
      allowed: closedGates.length === 0,
      closedGates,
      policyVersion: contentSafetyPolicyVersion,
      reasonCode: closedGates[0],
    };
  }
}

function classificationView(row: ClassificationRow): ClassificationView {
  return {
    classification: row.classification,
    contentId: row.contentId,
    declaredAt: row.declaredAt,
    version: row.version,
  };
}
