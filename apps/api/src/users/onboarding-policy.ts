import type { ConsumerPolicyKey } from './schema.js';

/**
 * Consumer admission policy.
 *
 * Every value here is application policy rather than legal text. Velora has no
 * approved terms, privacy notice, minimum age, or launch-country list: those are
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED` in
 * `docs/decisions/DECISIONS_REQUIRED.md`. The versions below are therefore
 * deliberately marked unpublished, and no copy is invented anywhere in the
 * repository.
 *
 * That choice is load-bearing rather than cosmetic. Acknowledgement evidence is
 * append-only and versioned, so when real copy is approved its version string
 * changes here, every account is asked again, and the evidence that people
 * accepted the earlier version is preserved rather than rewritten.
 */

export interface PolicyDocumentRequirement {
  readonly key: ConsumerPolicyKey;
  readonly version: string;
}

/**
 * The `0-unpublished` marker is not a placeholder that behaves like a real
 * version: it is a real version, recorded as such, whose content has not been
 * approved. Publishing approved copy is a version bump, not a data migration.
 */
export const unpublishedPolicyVersion = '0-unpublished';

export const requiredPolicyDocuments: readonly PolicyDocumentRequirement[] = [
  { key: 'terms_of_service', version: unpublishedPolicyVersion },
  { key: 'privacy_notice', version: unpublishedPolicyVersion },
];

/**
 * Version of the adult-eligibility rule an assurance outcome was judged
 * against. It moves when the rule changes — a minimum age, an accepted method,
 * or a country policy — which is what makes a stored outcome re-evaluable
 * instead of merely old.
 */
export const adultEligibilityPolicyVersion = unpublishedPolicyVersion;

/**
 * Method name recorded for a self-declaration. It is not a provider: nothing is
 * consulted, and the resulting assurance class is the weakest one.
 */
export const selfDeclarationMethod = 'self_declaration';

/**
 * Deterministic admission ladder.
 *
 * `docs/flows/onboarding.md` fixes the order: identity, then the adult and
 * country gate, then required notices, then the minimum profile, then
 * activation. A step is never reachable while an earlier one is unmet, so the
 * progression cannot be entered in the middle.
 */
export const onboardingSteps = [
  'adult_declaration',
  'policy_acknowledgement',
  'profile',
  'completed',
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

/**
 * Assurance a capability may require. `none` is the starting state; it is never
 * a synonym for "declared and we did not check".
 */
export const adultAssuranceLevels = [
  'none',
  'self_declared',
  'verified_adult',
] as const;
export type AdultAssuranceLevel = (typeof adultAssuranceLevels)[number];

const assuranceRank: Readonly<Record<AdultAssuranceLevel, number>> = {
  none: 0,
  self_declared: 1,
  verified_adult: 2,
};

export function assuranceAtLeast(
  held: AdultAssuranceLevel,
  required: AdultAssuranceLevel,
): boolean {
  return assuranceRank[held] >= assuranceRank[required];
}

/**
 * Assurance V1 consumer discovery and messaging require.
 *
 * It is `self_declared` because no age-verification provider is approved and
 * `docs/compliance/02-adult-age-verification.md` forbids pretending otherwise.
 * Raising it is a policy change here plus an approved provider, not a code
 * change scattered across the domains that read it.
 */
export const consumerCoreRequiredAssurance: AdultAssuranceLevel =
  'self_declared';
