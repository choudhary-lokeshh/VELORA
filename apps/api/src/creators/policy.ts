import type { AdultAssuranceLevel } from '../users/onboarding-policy.js';
import type { CreatorPolicyKey } from './schema.js';

/**
 * Creator admission policy.
 *
 * Every value here is application policy rather than legal text. Velora has no
 * approved creator terms, creator content policy, launch-country list, or
 * creator eligibility criteria: those are `DECISION REQUIRED / LEGAL REVIEW
 * REQUIRED` in `docs/decisions/DECISIONS_REQUIRED.md` and in
 * `docs/compliance/03-creator-content-gates.md`. The versions below are
 * therefore deliberately marked unpublished, and no copy is invented anywhere
 * in the repository.
 *
 * That choice is load-bearing rather than cosmetic. Acknowledgement evidence is
 * append-only and versioned, so when real copy is approved its version string
 * changes here, every creator is asked again, and the evidence that they
 * accepted the earlier version is preserved rather than rewritten.
 */

export interface CreatorPolicyDocumentRequirement {
  readonly key: CreatorPolicyKey;
  readonly version: string;
}

/**
 * The same marker USERS uses, and for the same reason: it is a real version
 * whose content has not been approved, not a placeholder that behaves like an
 * approved one. Publishing approved copy is a version bump, not a data
 * migration.
 */
export const unpublishedCreatorPolicyVersion = '0-unpublished';

export const requiredCreatorPolicyDocuments: readonly CreatorPolicyDocumentRequirement[] =
  [
    { key: 'creator_terms', version: unpublishedCreatorPolicyVersion },
    { key: 'creator_content_policy', version: unpublishedCreatorPolicyVersion },
  ];

/**
 * Adult assurance creator capability requires.
 *
 * `self_declared`, matching consumer core, because no age-verification provider
 * is approved and `docs/compliance/02-adult-age-verification.md` forbids
 * pretending otherwise. It is deliberately a separate constant from the
 * consumer one: raising the creator bar to `verified_adult` once a provider
 * exists must not require raising the consumer bar at the same moment, and a
 * shared constant would have made those two decisions one.
 */
export const creatorRequiredAssurance: AdultAssuranceLevel = 'self_declared';

/**
 * The one surface creator capability may be established from.
 *
 * `AGENTS.md` keeps Creator Studio, Consumer Web, Consumer Mobile, and Platform
 * Admin separate, and `docs/surfaces/03-creator-studio.md` makes Studio the
 * creator workspace. A consumer session reaching a creator mutation would be
 * exactly the audience confusion both forbid.
 */
export const creatorAudience = 'creator_studio' as const;
