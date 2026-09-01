import { z } from 'zod';

/**
 * USERS wire vocabulary.
 *
 * The consumer account is the product identity every other consumer domain
 * references. Its identifier is distinct from the AUTH account identifier on
 * purpose: a client that learns a discovery candidate's user id must not
 * thereby learn anything addressable in AUTH.
 */

export const userAccountStatusValues = [
  'pending_profile',
  'active',
  'restricted',
  'deletion_pending',
  'deactivated',
  'erased',
] as const;
export const userAccountStatusSchema = z.enum(userAccountStatusValues);
export type UserAccountStatusValue = z.infer<typeof userAccountStatusSchema>;

/**
 * Coarse cause the account owner may see about their own account. A peer never
 * receives this field for anyone else.
 */
export const userAccountStatusReasonValues = [
  'onboarding_incomplete',
  'eligibility_failed',
  'safety_enforcement',
  'user_requested',
] as const;
export const userAccountStatusReasonSchema = z.enum(
  userAccountStatusReasonValues,
);

/** ISO 3166-1 alpha-2. */
export const regionSchema = z.string().regex(/^[A-Z]{2}$/u);
/** BCP 47 language with an optional region subtag. */
export const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/u);

/**
 * What somebody has declared about themselves, for matching.
 *
 * **It comes from the account owner and from nowhere else.** No camera, face,
 * body, name, voice, model, pronoun, location, or behavioural signal
 * contributes to it, none ever may, and the shape is what makes that checkable:
 * there is exactly one way a value arrives here, and it is a person choosing
 * one from this list on their own account.
 *
 * A closed vocabulary rather than free text, because this value is a *matching
 * category* — something the server groups people by — and a category somebody
 * typed cannot be grouped, cannot be translated, and cannot be reasoned about
 * by anybody deciding whether a filter over it is lawful. What a person calls
 * themselves in their own words is a different thing with different rules, it
 * would need a moderation taxonomy nobody has approved, and it is deliberately
 * not collected here rather than collected and quietly made unfilterable.
 *
 * `undisclosed` is a real declaration and not an absence. Somebody who chose it
 * has answered; somebody with no declaration at all has never been asked. The
 * two behave identically for matching — neither is ever returned for a
 * category-specific preference — and they are kept distinct because a surface
 * that could not tell them apart would have to nag people who had already said
 * no.
 */
export const matchingGenderValues = [
  'woman',
  'man',
  'non_binary',
  'undisclosed',
] as const;
export const matchingGenderSchema = z.enum(matchingGenderValues);
export type MatchingGender = z.infer<typeof matchingGenderSchema>;

/**
 * The subset of the above a preference may actually name.
 *
 * `undisclosed` is missing on purpose and its absence is load-bearing. A
 * preference for people who declined to say would be a filter over the act of
 * declining, which would turn "prefer not to say" into an answer with
 * consequences and make the option dishonest. Somebody who has not declared is
 * matched by `Everyone`, exactly as they are today, and by nothing narrower.
 */
export const matchableGenderValues = ['woman', 'man', 'non_binary'] as const;
export const matchableGenderSchema = z.enum(matchableGenderValues);
export type MatchableGender = z.infer<typeof matchableGenderSchema>;

export const consumerAccountResponseSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    locale: localeSchema.optional(),
    region: regionSchema.optional(),
    status: userAccountStatusSchema,
    statusReason: userAccountStatusReasonSchema.optional(),
  })
  .strict();
export type ConsumerAccountResponse = z.infer<
  typeof consumerAccountResponseSchema
>;

/**
 * Account creation carries no identity input at all. The server derives the
 * AUTH account from the presented credential, so a client cannot name another
 * account and become it.
 */
export const createConsumerAccountRequestSchema = z
  .object({
    locale: localeSchema.optional(),
  })
  .strict();
export type CreateConsumerAccountRequest = z.infer<
  typeof createConsumerAccountRequestSchema
>;

/**
 * Deterministic admission ladder. `docs/flows/onboarding.md` fixes the order,
 * and the server derives the current step from stored evidence rather than
 * accepting one from a client.
 */
export const onboardingStepValues = [
  'adult_declaration',
  'policy_acknowledgement',
  'profile',
  'completed',
] as const;
export const onboardingStepSchema = z.enum(onboardingStepValues);
export type OnboardingStepValue = z.infer<typeof onboardingStepSchema>;

/**
 * Assurance the account holds. The levels are deliberately not
 * interchangeable: `docs/compliance/02-adult-age-verification.md` forbids
 * treating a declaration as a verified check.
 */
export const adultAssuranceLevelValues = [
  'none',
  'self_declared',
  'verified_adult',
] as const;
export const adultAssuranceLevelSchema = z.enum(adultAssuranceLevelValues);

export const consumerPolicyKeyValues = [
  'terms_of_service',
  'privacy_notice',
] as const;
export const consumerPolicyKeySchema = z.enum(consumerPolicyKeyValues);

/**
 * A policy document and the exact version currently required. No legal copy is
 * carried: the client fetches published copy for a version by other means, and
 * the acknowledgement records which version was accepted.
 */
export const policyDocumentSchema = z
  .object({
    key: consumerPolicyKeySchema,
    version: z.string().min(1).max(32),
  })
  .strict();

/**
 * What the minimum discoverable profile still lacks. It is reported only to the
 * account it describes, and it lists requirements rather than values, so no
 * profile content travels with an admission answer.
 */
export const profileRequirementSchema = z.enum([
  'display_name',
  'language',
  'ready_media',
  'region',
]);
export type ProfileRequirement = z.infer<typeof profileRequirementSchema>;

export const onboardingStateResponseSchema = z
  .object({
    account: consumerAccountResponseSchema,
    adultAssurance: adultAssuranceLevelSchema,
    /**
     * True when the most recent assessment refused the account. It is distinct
     * from an assurance of `none`, which only means nothing has been declared.
     */
    adultAssuranceRefused: z.boolean(),
    outstandingPolicies: z.array(policyDocumentSchema).max(16),
    outstandingProfile: z.array(profileRequirementSchema),
    step: onboardingStepSchema,
  })
  .strict();
export type OnboardingStateResponse = z.infer<
  typeof onboardingStateResponseSchema
>;

/**
 * Self-declaration of adult status, with the region whose rules apply. No birth
 * date is collected: the minimum age per country is unresolved, and a date
 * would be sensitive data gathered for a rule that does not yet exist.
 */
export const adultDeclarationRequestSchema = z
  .object({
    declaresAdult: z.boolean(),
    region: regionSchema,
  })
  .strict();
export type AdultDeclarationRequest = z.infer<
  typeof adultDeclarationRequestSchema
>;

export const policyAcknowledgementRequestSchema = z
  .object({
    acknowledgements: z.array(policyDocumentSchema).min(1).max(16),
  })
  .strict();
export type PolicyAcknowledgementRequest = z.infer<
  typeof policyAcknowledgementRequestSchema
>;
