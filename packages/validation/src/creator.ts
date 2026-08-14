import { z } from 'zod';

/**
 * CREATORS wire vocabulary.
 *
 * A creator is a capability attached to an existing authenticated principal,
 * never a second account with its own credential. `docs/domains/creators.md`
 * gives CREATORS the creator identity and its eligibility to operate platform
 * features; AUTH keeps the credential and the session, USERS keeps the consumer
 * account, and neither identifier is interchangeable with the creator one.
 *
 * The creator identifier is distinct from both the AUTH account identifier and
 * the consumer user identifier on purpose. A surface that learns one must not
 * thereby learn anything addressable in another domain.
 */

/**
 * Creator capability lifecycle.
 *
 * `docs/decisions/ADR-0020-creator-capability-activation.md` records why this
 * ladder is shorter than the diagram in `docs/flows/creator-lifecycle-content.md`:
 * `under_review`, `verified`, and `declined` are states of the creator
 * identity-verification predicate, which has no approved provider and whose
 * criteria are still `DECISION REQUIRED`. Modelling them here would put states
 * in the schema that no code could ever leave.
 */
export const creatorAccountStatusValues = [
  /** Capability requested; at least one activation requirement is outstanding. */
  'applicant',
  /** Every currently required activation gate passes. */
  'active',
  /** Safety, compliance, or platform action stopped creator operation. */
  'suspended',
  /** Ended. Terminal for this capability; the person keeps their account. */
  'closed',
] as const;
export const creatorAccountStatusSchema = z.enum(creatorAccountStatusValues);
export type CreatorAccountStatusValue = z.infer<
  typeof creatorAccountStatusSchema
>;

/**
 * Coarse cause the creator may see about their own capability. It is
 * deliberately blunt: the exact enforcement decision behind a suspension
 * belongs to TRUST & SAFETY and is never restated here.
 */
export const creatorAccountStatusReasonValues = [
  'onboarding_incomplete',
  'eligibility_failed',
  'safety_enforcement',
  'platform_action',
  'creator_requested',
] as const;
export const creatorAccountStatusReasonSchema = z.enum(
  creatorAccountStatusReasonValues,
);
export type CreatorAccountStatusReasonValue = z.infer<
  typeof creatorAccountStatusReasonSchema
>;

export const creatorAccountResponseSchema = z
  .object({
    activatedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    status: creatorAccountStatusSchema,
    statusReason: creatorAccountStatusReasonSchema.optional(),
  })
  .strict();
export type CreatorAccountResponse = z.infer<
  typeof creatorAccountResponseSchema
>;

/**
 * Establishing creator capability carries no identity input at all — no legal
 * name, no business registration, no tax identifier, no document. The acting
 * principal comes from the presented credential, so a client cannot name
 * another account and become its creator.
 */
export const createCreatorAccountRequestSchema = z.object({}).strict();
export type CreateCreatorAccountRequest = z.infer<
  typeof createCreatorAccountRequestSchema
>;

/**
 * Creator admission ladder. Shorter than the consumer one because a creator is
 * an existing adult principal: the adult gate is USERS' answer rather than a
 * step taken here, and no minimum creator profile is required to hold the
 * capability.
 */
export const creatorOnboardingStepValues = [
  'adult_eligibility',
  'policy_acknowledgement',
  'completed',
] as const;
export const creatorOnboardingStepSchema = z.enum(creatorOnboardingStepValues);
export type CreatorOnboardingStepValue = z.infer<
  typeof creatorOnboardingStepSchema
>;

/**
 * Why the adult gate is unmet, reported only to the person it describes.
 *
 * `no_consumer_account` and `adult_declaration_missing` are distinct because
 * they need different next actions, and `not_in_good_standing` never says which
 * restriction applies — that is USERS' and TRUST & SAFETY's to explain, not
 * this domain's.
 */
export const creatorAdultGateReasonValues = [
  'no_consumer_account',
  'adult_declaration_missing',
  'not_in_good_standing',
] as const;
export const creatorAdultGateReasonSchema = z.enum(
  creatorAdultGateReasonValues,
);
export type CreatorAdultGateReasonValue = z.infer<
  typeof creatorAdultGateReasonSchema
>;

export const creatorPolicyKeyValues = [
  'creator_terms',
  'creator_content_policy',
] as const;
export const creatorPolicyKeySchema = z.enum(creatorPolicyKeyValues);
export type CreatorPolicyKeyValue = z.infer<typeof creatorPolicyKeySchema>;

/**
 * A creator policy document and the exact version currently required. No legal
 * copy travels on the wire: the acknowledgement records which version was
 * accepted, and the copy for a version is published by other means.
 */
export const creatorPolicyDocumentSchema = z
  .object({
    key: creatorPolicyKeySchema,
    version: z.string().min(1).max(32),
  })
  .strict();
export type CreatorPolicyDocument = z.infer<typeof creatorPolicyDocumentSchema>;

export const creatorOnboardingStateResponseSchema = z
  .object({
    account: creatorAccountResponseSchema,
    /**
     * Absent when the adult gate passes. Present with a coarse reason when it
     * does not, so a creator knows what to do without learning anything about
     * how another domain reached its answer.
     */
    adultGateReason: creatorAdultGateReasonSchema.optional(),
    adultGateSatisfied: z.boolean(),
    outstandingPolicies: z.array(creatorPolicyDocumentSchema).max(16),
    step: creatorOnboardingStepSchema,
  })
  .strict();
export type CreatorOnboardingStateResponse = z.infer<
  typeof creatorOnboardingStateResponseSchema
>;

export const creatorPolicyAcknowledgementRequestSchema = z
  .object({
    acknowledgements: z.array(creatorPolicyDocumentSchema).min(1).max(16),
  })
  .strict();
export type CreatorPolicyAcknowledgementRequest = z.infer<
  typeof creatorPolicyAcknowledgementRequestSchema
>;
