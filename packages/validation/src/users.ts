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
