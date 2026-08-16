import { z } from 'zod';

import { creatorAccountStatusSchema, creatorHandleSchema } from './creator.js';
import { currencyCodeSchema, minorUnitsSchema } from './money.js';
import {
  appealStateSchema,
  enforcementDispositionSchema,
  enforcementScopeSchema,
} from './safety.js';

/**
 * ADMIN wire vocabulary for creator operations.
 *
 * `docs/domains/admin.md` makes ADMIN an operations layer rather than an owner
 * of business truth: every route here invokes a domain's own service with a
 * privileged actor and a reason, and none of them reads or writes another
 * domain's tables directly.
 *
 * Nothing here carries a bank account, a tax identifier, a payout credential,
 * or a raw identity document. `docs/product/04-platform-admin.md` keeps Admin
 * from becoming a creator's financial vault, and a field that exists is a field
 * something eventually fills.
 */

/** Why an operator acted. A closed vocabulary, never free text. */
export const adminCreatorReasonCodeValues = [
  'underage_risk',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'platform_integrity',
] as const;
export const adminCreatorReasonCodeSchema = z.enum(
  adminCreatorReasonCodeValues,
);
export type AdminCreatorReasonCodeValue = z.infer<
  typeof adminCreatorReasonCodeSchema
>;

/**
 * One creator as an operator sees them.
 *
 * Operational state and nothing else: no AUTH subject, no consumer identifier,
 * no email, no address, no financial detail, and no moderation narrative. An
 * operator learns what a creator's capability is doing and can act on it.
 */
export const adminCreatorSchema = z
  .object({
    activatedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    handle: creatorHandleSchema.optional(),
    id: z.uuid(),
    profilePublished: z.boolean(),
    status: creatorAccountStatusSchema,
    statusReason: z.string().max(64).optional(),
    suspendedAt: z.iso.datetime().optional(),
  })
  .strict();
export type AdminCreator = z.infer<typeof adminCreatorSchema>;

export const adminCreatorListResponseSchema = z
  .object({
    creators: z.array(adminCreatorSchema).max(50),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type AdminCreatorListResponse = z.infer<
  typeof adminCreatorListResponseSchema
>;

export const adminSuspendCreatorRequestSchema = z
  .object({
    creatorId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminSuspendCreatorRequest = z.infer<
  typeof adminSuspendCreatorRequestSchema
>;

export const adminReinstateCreatorRequestSchema = z
  .object({
    creatorId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminReinstateCreatorRequest = z.infer<
  typeof adminReinstateCreatorRequestSchema
>;

/** What an operator may take down, named by a closed vocabulary. */
export const adminRemovableObjectValues = [
  'creator_profile',
  'creator_content',
  'club',
] as const;
export const adminRemovableObjectSchema = z.enum(adminRemovableObjectValues);
export type AdminRemovableObjectValue = z.infer<
  typeof adminRemovableObjectSchema
>;

export const adminRemoveObjectRequestSchema = z
  .object({
    creatorId: z.uuid(),
    /** Omitted for a profile, which is identified by its creator. */
    objectId: z.uuid().optional(),
    objectType: adminRemovableObjectSchema,
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminRemoveObjectRequest = z.infer<
  typeof adminRemoveObjectRequestSchema
>;

export const adminRevokeMembershipRequestSchema = z
  .object({
    creatorId: z.uuid(),
    membershipId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
  })
  .strict();
export type AdminRevokeMembershipRequest = z.infer<
  typeof adminRevokeMembershipRequestSchema
>;

/**
 * The record of one operation, returned so an operator sees what was written
 * rather than being told it worked.
 */
export const adminOperationResponseSchema = z
  .object({
    creator: adminCreatorSchema,
    /** Whether the record imposed a restriction or lifted one. */
    disposition: enforcementDispositionSchema,
    enforcementId: z.uuid(),
    reasonCode: adminCreatorReasonCodeSchema,
    recordedAt: z.iso.datetime(),
    scope: enforcementScopeSchema,
  })
  .strict();
export type AdminOperationResponse = z.infer<
  typeof adminOperationResponseSchema
>;

/** Bounded free-text search over the public handle only. */
export const adminCreatorSearchSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/u);

/**
 * What an operator may see of the platform's money.
 *
 * Counts and per-currency totals, and nothing that identifies anybody. No
 * provider reference, no provider idempotency key, no payout recipient
 * reference, no bank detail, no identity document, and no consumer contact
 * detail: an operator needs to know what state the platform's money is in and
 * be able to act on it, and none of those help with that.
 *
 * There is no cross-currency total anywhere, because adding a euro to a yen
 * produces a number with no meaning that somebody would act on.
 */
export const adminFinancialStateSchema = z
  .object({ count: z.number().int().min(0), state: z.string().min(1).max(64) })
  .strict();

export const adminFinancialTotalSchema = z
  .object({ amountMinor: minorUnitsSchema, currency: currencyCodeSchema })
  .strict();

/**
 * Which capability seams are open, reported as the names of the configured
 * adapters.
 *
 * An operator seeing `unavailable` across the row is seeing the truth: no
 * payment provider, no payout provider, no published commercial terms, no
 * approved launch country, and no tax authority. Reporting the adapter name
 * rather than a boolean is what makes the difference between "off" and "off
 * because nobody has approved one" visible without a second screen.
 */
export const adminCapabilityStateSchema = z
  .object({
    commerceEligibility: z.string().min(1).max(64),
    commercePolicy: z.string().min(1).max(64),
    paymentProvider: z.string().min(1).max(64),
    payoutPolicy: z.string().min(1).max(64),
    payoutProvider: z.string().min(1).max(64),
    taxAuthority: z.string().min(1).max(64),
  })
  .strict();

export const adminFinancialStateResponseSchema = z
  .object({
    capabilities: adminCapabilityStateSchema,
    disputes: z.array(adminFinancialStateSchema),
    openDisputeTotals: z.array(adminFinancialTotalSchema),
    payableTotals: z.array(adminFinancialTotalSchema),
    payments: z.array(adminFinancialStateSchema),
    payouts: z.array(adminFinancialStateSchema),
    reconciliation: z.array(adminFinancialStateSchema),
    refunds: z.array(adminFinancialStateSchema),
    subscriptions: z.array(adminFinancialStateSchema),
  })
  .strict();
export type AdminFinancialStateResponse = z.infer<
  typeof adminFinancialStateResponseSchema
>;

/**
 * ADMIN wire vocabulary for moderation operations.
 *
 * Every one of these is an **explicit command**. There is no generic patch
 * endpoint for a safety record anywhere in this contract: a shape that could
 * set an arbitrary field on a case, an evidence row, or a decision would be a
 * shape that could rewrite an audit, and [ADR-0022](../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * forbids exactly that.
 *
 * Two things are absent from every operator shape here and their absence is the
 * design. **Reporter identity**, because a case is about a target and a queue
 * that could group people by who complained about them is a queue somebody will
 * eventually work that way. And **report volume**, for the same reason: a
 * number that decides nothing decides something the moment an operator sees it.
 */

/** Which operator queue a case belongs to. */
export const moderationQueueSchema = z.enum([
  'consumer_conduct',
  'creator_content',
  'creator_identity',
]);

/** How urgent a reviewer judged a case to be. Never computed. */
export const moderationPrioritySchema = z.enum([
  'untriaged',
  'low',
  'normal',
  'high',
  'urgent',
]);

export const moderationCaseStateSchema = z.enum([
  'new',
  'triaged',
  'investigating',
  'decided',
  'closed',
]);

/** What a report is about. Mirrors the domain vocabulary exactly. */
export const moderationTargetTypeSchema = z.enum([
  'consumer_account',
  'creator_profile',
  'creator_content',
  'club',
  'conversation',
]);

/**
 * One case as an operator sees it in the queue.
 *
 * No reporter and no count. The identifier of what the case is about is here
 * because an operator has to be able to act on it; who complained is not
 * theirs to know and is not a column this domain has.
 */
export const moderationCaseSchema = z
  .object({
    assigned: z.boolean(),
    assignmentExpiresAt: z.iso.datetime().optional(),
    id: z.uuid(),
    openedAt: z.iso.datetime(),
    policyVersion: z.string().min(1).max(64),
    priority: moderationPrioritySchema,
    queue: moderationQueueSchema,
    state: moderationCaseStateSchema,
    targetId: z.uuid(),
    targetType: moderationTargetTypeSchema,
    version: z.number().int().min(1),
  })
  .strict();
export type ModerationCase = z.infer<typeof moderationCaseSchema>;

export const moderationCaseListResponseSchema = z
  .object({
    cases: z.array(moderationCaseSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/**
 * A report as a reviewer reads it.
 *
 * The narrative is here because a reviewer cannot judge an allegation without
 * it. The reporter is not, and there is no field for one, so no response this
 * contract can produce carries a reporter identity to an operator surface.
 */
export const moderationReportSchema = z
  .object({
    createdAt: z.iso.datetime(),
    detail: z.string().max(2_000).optional(),
    id: z.uuid(),
    reasonCode: z.string().min(1).max(64),
    sourceSurface: z.string().min(1).max(32).optional(),
    state: z.string().min(1).max(32),
    targetType: moderationTargetTypeSchema,
  })
  .strict();

export const moderationEvidenceSchema = z
  .object({
    id: z.uuid(),
    kind: z.string().min(1).max(64),
    note: z.string().max(2_000).optional(),
    observedAt: z.iso.datetime().optional(),
    recordedAt: z.iso.datetime(),
    referenceId: z.uuid().optional(),
    referenceType: z.string().min(1).max(64).optional(),
    stateLabel: z.string().max(64).optional(),
  })
  .strict();

export const moderationDecisionSchema = z
  .object({
    action: z.string().min(1).max(32),
    decidedAt: z.iso.datetime(),
    enforcementId: z.uuid().optional(),
    evidenceIds: z.array(z.uuid()),
    expiresAt: z.iso.datetime().optional(),
    id: z.uuid(),
    policyVersion: z.string().min(1).max(64),
    priorState: z.string().min(1).max(32).optional(),
    reasonCode: z.string().min(1).max(64),
    resultingState: z.string().min(1).max(32).optional(),
    scope: enforcementScopeSchema.optional(),
    supersedesId: z.uuid().optional(),
  })
  .strict();

export const moderationCaseDetailResponseSchema = z
  .object({
    case: moderationCaseSchema,
    decisions: z.array(moderationDecisionSchema),
    evidence: z.array(moderationEvidenceSchema),
    reports: z.array(moderationReportSchema),
  })
  .strict();

export const moderationCaseRequestSchema = z
  .object({ caseId: z.uuid() })
  .strict();

export const moderationTriageRequestSchema = z
  .object({
    caseId: z.uuid(),
    priority: moderationPrioritySchema,
    state: z.enum(['triaged', 'investigating']),
  })
  .strict();

/**
 * A reviewer's note.
 *
 * The one shape in this contract that carries prose, and it travels in exactly
 * one direction: an operator writes it and only an operator reads it back
 * through the case detail. There is no consumer or creator response anywhere in
 * this API with a field it could reach.
 */
export const moderationNoteRequestSchema = z
  .object({ caseId: z.uuid(), note: z.string().min(1).max(2_000) })
  .strict();

export const moderationCaseResponseSchema = z
  .object({ case: moderationCaseSchema })
  .strict();

/** What a reviewer may decide. A closed vocabulary, never free text. */
export const moderationActionSchema = z.enum([
  'no_action',
  'temporary_hold',
  'unpublish',
  'restrict_capability',
  'revoke_restriction',
  'escalate',
]);

/** Why. A superset of the findings, because a review that found nothing has a reason. */
export const moderationReasonCodeSchema = z.enum([
  'underage_risk',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'platform_integrity',
  'no_violation_found',
  'insufficient_evidence',
  'requires_specialist_review',
]);

/**
 * One decision, as an explicit command.
 *
 * The version the reviewer read is required, so a decision taken against a
 * stale case is refused rather than applied to one that moved underneath it.
 * The evidence cited is required of anything consequential, and the server
 * refuses a citation from another case.
 */
export const moderationDecisionRequestSchema = z
  .object({
    action: moderationActionSchema,
    caseId: z.uuid(),
    evidenceIds: z.array(z.uuid()).max(200),
    expectedVersion: z.number().int().min(1),
    expiresAt: z.iso.datetime().optional(),
    priority: moderationPrioritySchema.optional(),
    reasonCode: moderationReasonCodeSchema,
    scope: enforcementScopeSchema.optional(),
    supersedesDecisionId: z.uuid().optional(),
    targetConversationId: z.uuid().optional(),
  })
  .strict();

export const moderationDecisionResponseSchema = z
  .object({ decision: moderationDecisionSchema })
  .strict();

/**
 * One complaint as an operator sees it.
 *
 * The appellant's own words are absent. An operator reviewing a complaint reads
 * it through the case, and a queue shape that carried prose would be a shape a
 * log line or a metric label eventually carries too.
 */
export const moderationAppealSchema = z
  .object({
    appellantKind: z.enum(['subject', 'notifier']),
    decisionId: z.uuid(),
    id: z.uuid(),
    outcomeDecisionId: z.uuid().optional(),
    state: appealStateSchema,
    submittedAt: z.iso.datetime(),
    version: z.number().int().min(1),
    windowClosesAt: z.iso.datetime().optional(),
  })
  .strict();

export const moderationAppealListResponseSchema = z
  .object({ appeals: z.array(moderationAppealSchema) })
  .strict();

export const moderationAppealOutcomeRequestSchema = z
  .object({
    appealId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    outcome: z.enum(['upheld', 'refused']),
    outcomeDecisionId: z.uuid().optional(),
  })
  .strict();

export const moderationAppealResponseSchema = z
  .object({ appeal: moderationAppealSchema })
  .strict();

export type ModerationActionValue = z.infer<typeof moderationActionSchema>;
export type ModerationReasonCodeValue = z.infer<
  typeof moderationReasonCodeSchema
>;
