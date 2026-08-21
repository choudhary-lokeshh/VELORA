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
 * The one-time exact-action record AUTH issues for a sensitive Admin read.
 * It belongs in a header, never a URL that can reach browser history or proxy
 * logs. The value is opaque and single use; it conveys no role by itself.
 */
export const adminExactActionAuthorizationHeader =
  'x-velora-action-authorization';
export const adminExactActionAuthorizationIdSchema = z.uuid();

/** The only owner shapes IDENTITY ASSURANCE accepts internally. */
export const adminIdentityOwnerDomainSchema = z.enum([
  'auth',
  'creators',
  'safety',
]);

/** Exact-reference lookup only. There is intentionally no search schema. */
export const adminIdentitySubjectQuerySchema = z
  .object({
    ownerDomain: adminIdentityOwnerDomainSchema,
    ownerReference: z.uuid(),
  })
  .strict();
export type AdminIdentitySubjectQuery = z.infer<
  typeof adminIdentitySubjectQuerySchema
>;

export const adminIdentityCountSchema = z
  .object({
    count: z.number().int().min(0),
    state: z.string().min(1).max(128),
  })
  .strict();

export const adminIdentityAttemptCountSchema = adminIdentityCountSchema.extend({
  purpose: z.enum([
    'adult_assurance',
    'creator_identity',
    'depicted_person_identity',
    'depicted_person_adult_assurance',
    'commercial_kyc',
  ]),
});

export const adminIdentityBacklogSchema = adminIdentityCountSchema.extend({
  oldestAgeSeconds: z.number().int().min(0).optional(),
});

export const adminIdentityReconciliationCountSchema =
  adminIdentityCountSchema.extend({
    kind: z.enum([
      'missing_provider_reference',
      'provider_state_drift',
      'stuck_attempt',
      'evidence_expiry',
      'callback_gap',
      'deletion_obligation',
      'retention_obligation',
    ]),
    oldestAgeSeconds: z.number().int().min(0).optional(),
  });

/**
 * Platform health for IDENTITY ASSURANCE. Every value is an adapter name,
 * count, lifecycle label, or age — never a subject, document, provider fact,
 * hosted URL, jurisdiction, or callback payload.
 */
export const adminIdentityStateResponseSchema = z
  .object({
    attempts: z.array(adminIdentityAttemptCountSchema),
    expiredEvidence: z.array(adminIdentityCountSchema),
    outbox: z.array(adminIdentityCountSchema),
    provider: z.string().min(1).max(128),
    providerEventBacklog: z.array(adminIdentityBacklogSchema),
    providerEvents: z.array(adminIdentityCountSchema),
    reconciliation: z.array(adminIdentityReconciliationCountSchema),
  })
  .strict();
export type AdminIdentityStateResponse = z.infer<
  typeof adminIdentityStateResponseSchema
>;

const adminIdentityAttemptStateSchema = z.enum([
  'created',
  'provider_starting',
  'provider_pending',
  'processing',
  'succeeded',
  'refused',
  'failed',
  'expired',
  'cancelled',
  'unavailable',
]);

export const adminIdentitySubjectAttemptSchema = z
  .object({
    createdAt: z.iso.datetime(),
    purpose: adminIdentityAttemptCountSchema.shape.purpose,
    state: adminIdentityAttemptStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const adminIdentitySubjectEvidenceSchema = z
  .object({
    evidenceClass: z.enum([
      'adult_threshold',
      'identity',
      'creator_identity',
      'commercial_kyc',
      'depicted_person_identity',
      'depicted_person_adult_threshold',
    ]),
    expiresAt: z.iso.datetime().optional(),
    recordedAt: z.iso.datetime(),
    result: z.enum(['granted', 'refused', 'revoked', 'expired']),
  })
  .strict();

export const adminIdentitySubjectFindingSchema = z
  .object({
    detectedAt: z.iso.datetime(),
    kind: adminIdentityReconciliationCountSchema.shape.kind,
    state: z.enum(['open', 'resolved', 'dead_letter']),
  })
  .strict();

/**
 * One subject whose opaque owner reference the operator already has. It does
 * not echo that reference and carries only current evidence tips plus bounded
 * technical history; provider facts, reason strings, and any identity attribute
 * are deliberately absent.
 */
export const adminIdentitySubjectResponseSchema = z
  .object({
    subject: z
      .object({
        attempts: z.array(adminIdentitySubjectAttemptSchema).max(50),
        attemptsTruncated: z.boolean(),
        currentEvidence: z.array(adminIdentitySubjectEvidenceSchema),
        findings: z.array(adminIdentitySubjectFindingSchema).max(50),
        findingsTruncated: z.boolean(),
        ownerDomain: adminIdentityOwnerDomainSchema,
      })
      .strict(),
  })
  .strict();
export type AdminIdentitySubjectResponse = z.infer<
  typeof adminIdentitySubjectResponseSchema
>;

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
    /**
     * Whether any of the three lists stopped at its bound.
     *
     * Said out loud, because a reviewer looking at a partial case that looks
     * complete is a reviewer deciding on less than they think they have.
     */
    truncated: z.boolean(),
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

/**
 * ADMIN wire vocabulary for media operations.
 *
 * The media platform is the one domain whose operator surface has to carry
 * technical state, and that is a deliberate exception rather than a leak.
 * [ADR-0023](../../../docs/decisions/ADR-0023-media-platform-architecture.md)
 * keeps MEDIA's technical lifecycle disjoint from any publication vocabulary
 * and hides it behind a coarse readiness projection precisely so that no
 * product surface can spend `ready` as permission to render. An operator is the
 * one person that projection is useless to: "checking" tells them nothing about
 * whether a worker died mid-decode. So these shapes carry the lifecycle, and
 * nothing that reads them is a product surface.
 *
 * What they never carry is a person. There is no owner identifier, no account,
 * no handle, and no digest anywhere here, and the state screen carries no
 * identifiers at all — an operator watching an incident needs counts, and a
 * dashboard that also listed whose uploads were failing is a dashboard somebody
 * eventually screenshots.
 *
 * There is no list of assets and no search, on the same rule. An operator who
 * could page through everybody's media has a browsing surface over private
 * images however it is labelled; the detail route answers about one asset whose
 * identifier the operator already has from a finding or a report.
 */

/** One count under a label. The same shape the financial screen uses. */
export const adminMediaCountSchema = z
  .object({ count: z.number().int().min(0), state: z.string().min(1).max(64) })
  .strict();

/**
 * Which media adapters are in force, reported by name.
 *
 * `unavailable` across the row is the truth about a deployed environment: no
 * approved storage provider and no approved malware scanner, so the platform
 * refuses every upload rather than accepting bytes nobody vetted. Reporting the
 * adapter name rather than a boolean is what makes "off" and "off because
 * nobody has approved one" distinguishable without a second screen.
 */
export const adminMediaAdapterStateSchema = z
  .object({
    scanner: z.string().min(1).max(64),
    storage: z.string().min(1).max(64),
  })
  .strict();

/**
 * One class of owed work, with the age of the oldest thing in it.
 *
 * A count alone cannot distinguish a busy platform from a stuck one: a hundred
 * purges owed in the last minute and one purge owed since Tuesday are the same
 * number and opposite situations. The age is what separates them, and the
 * threshold travels with it so an alert rule and the screen cannot come to
 * disagree about when a class is late.
 *
 * `oldestAgeSeconds` is absent rather than zero when nothing is waiting. A zero
 * would read as "something has been waiting no time at all", and a rule written
 * against it would be written against a lie.
 */
export const adminMediaBacklogSchema = z
  .object({
    breached: z.boolean(),
    count: z.number().int().min(0),
    oldestAgeSeconds: z.number().int().min(0).optional(),
    state: z.string().min(1).max(64),
    thresholdSeconds: z.number().int().min(1),
  })
  .strict();

/**
 * Which RTC adapters are in force, reported by name.
 *
 * `unavailable` across the row is the truth about a deployed environment: no
 * approved RTC provider, no composed eligibility answer, and no realtime
 * gateway, so calling is refused rather than half-running. Reporting the name
 * rather than a boolean is what makes "off" and "off because nobody has
 * approved one" distinguishable without a second screen.
 */
export const adminRtcAdapterStateSchema = z
  .object({
    eligibility: z.string().min(1).max(64),
    provider: z.string().min(1).max(64),
    signalTransport: z.string().min(1).max(64),
  })
  .strict();

/**
 * Calling in operational terms.
 *
 * Counts and ages, and no identifier of any kind — not a call, not an account,
 * not a provider room. A screen an operator watches all day must not become a
 * window onto who is talking to whom, and two people having a call is not an
 * operational fact. There is deliberately no list and no search here for the
 * same reason.
 */
export const adminRtcStateResponseSchema = z
  .object({
    adapters: adminRtcAdapterStateSchema,
    /**
     * Owed work, by class, every class every time. A list that omitted the
     * healthy classes could not tell an operator "nothing is owed" apart from
     * "the signal stopped arriving", and those are opposite situations.
     */
    backlogs: z.array(adminMediaBacklogSchema),
    calls: z.array(adminMediaCountSchema),
    /**
     * Calls that finished while their teardown did not. The platform believes
     * the call is over and a provider may still hold the room open. A number
     * rather than a list, because listing it would name conversations.
     */
    endedWithUndischargedTeardown: z.number().int().min(0),
    /** Whether this environment can carry a call at all. */
    liveCallingAvailable: z.boolean(),
    providerEvents: z.array(adminMediaCountSchema),
    providerObligations: z.array(adminMediaCountSchema),
  })
  .strict();
export type AdminRtcStateResponse = z.infer<typeof adminRtcStateResponseSchema>;

/**
 * One call as an operator sees it.
 *
 * Reached only by an operator who already holds the identifier, from a report
 * or a reconciliation finding. It carries the lifecycle, because triaging a
 * stuck call without it is guesswork, and it carries nothing else: no
 * credential, no provider room reference, no address, no participant, and
 * nothing about media — none of which exists anywhere in the domain to carry.
 */
export const adminRtcCallSchema = z
  .object({
    acceptedAt: z.iso.datetime().optional(),
    authorizationGeneration: z.number().int().min(1),
    connectedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    endReason: z.string().min(1).max(64).optional(),
    endedAt: z.iso.datetime().optional(),
    id: z.uuid(),
    issuances: z.number().int().min(0),
    medium: z.enum(['voice', 'video']),
    obligations: z.array(adminMediaCountSchema),
    providerBound: z.boolean(),
    providerName: z.string().min(1).max(64).optional(),
    state: z.string().min(1).max(32),
  })
  .strict();
export type AdminRtcCall = z.infer<typeof adminRtcCallSchema>;

export const adminMediaStateResponseSchema = z
  .object({
    adapters: adminMediaAdapterStateSchema,
    assets: z.array(adminMediaCountSchema),
    /** Everything that needs a person. Nothing here resolves on its own. */
    attention: z.array(adminMediaCountSchema),
    /**
     * Owed work, by class, every class every time. A list that omitted the
     * healthy classes could not tell an operator "nothing is owed" apart from
     * "the signal stopped arriving", and those are opposite situations.
     */
    backlogs: z.array(adminMediaBacklogSchema),
    /** Outstanding disagreements between the record and the provider. */
    drift: z.array(adminMediaCountSchema),
    /** Whether this environment can accept media at all. */
    liveMediaAvailable: z.boolean(),
    objects: z.array(adminMediaCountSchema),
    obligations: z.array(adminMediaCountSchema),
  })
  .strict();
export type AdminMediaStateResponse = z.infer<
  typeof adminMediaStateResponseSchema
>;

/**
 * One stored object as an operator sees it.
 *
 * The object key is here on purpose, and it is the one field worth arguing
 * about. A key is not a credential: delivery requires a signature the platform
 * mints against current server truth, and key knowledge is nowhere in the
 * authorization model — which is exactly why keys are random rather than
 * derived from anything. An operator whose delivery layer is still serving
 * something taken down has to be able to name the object to their provider.
 */
export const adminMediaObjectSchema = z
  .object({
    byteSize: z.number().int().min(0).optional(),
    format: z.string().min(1).max(16).optional(),
    id: z.uuid(),
    objectKey: z.string().min(1).max(256),
    purgeOutcome: z.enum(['purged', 'unsupported', 'failed']).optional(),
    purgeRequestedAt: z.iso.datetime().optional(),
    role: z.enum(['original', 'variant']),
    state: z.enum(['present', 'deleting', 'deleted']),
    variantKind: z.string().min(1).max(32).optional(),
    verifiedAt: z.iso.datetime(),
  })
  .strict();

/** One recorded disagreement between the record and the provider. */
export const adminMediaFindingSchema = z
  .object({
    firstObservedAt: z.iso.datetime(),
    kind: z.string().min(1).max(64),
    lastObservedAt: z.iso.datetime(),
    occurrences: z.number().int().min(1),
  })
  .strict();

/** One duty the platform owes against this asset. */
export const adminMediaObligationSchema = z
  .object({
    attempts: z.number().int().min(0),
    availableAt: z.iso.datetime(),
    /** A short code the platform chose. Never a provider message. */
    failureReason: z.string().min(1).max(64).optional(),
    kind: z.string().min(1).max(32),
    state: z.string().min(1).max(32),
  })
  .strict();

/**
 * One asset in full.
 *
 * `ownerDomain` and not an owner identifier: an operator needs to know which
 * product surface an image belongs to in order to route an incident, and naming
 * the person would turn a technical fault into a file on somebody.
 */
export const adminMediaAssetSchema = z
  .object({
    assetClass: z.string().min(1).max(64),
    createdAt: z.iso.datetime(),
    deletionRequestedAt: z.iso.datetime().optional(),
    findings: z.array(adminMediaFindingSchema),
    id: z.uuid(),
    legalHold: z.boolean(),
    lifecycle: z.string().min(1).max(32),
    lifecycleChangedAt: z.iso.datetime(),
    objects: z.array(adminMediaObjectSchema),
    obligations: z.array(adminMediaObligationSchema),
    ownerDomain: z.enum(['users', 'creators', 'clubs']),
    readyAt: z.iso.datetime().optional(),
    rejectionReason: z.string().min(1).max(64).optional(),
    /**
     * Whether the retained history below was cut short.
     *
     * Obligations and findings are kept rather than tidied away, so an asset
     * that has been through several removals and several provider incidents
     * accumulates them. Saying so is the difference between an operator knowing
     * they are looking at part of the history and believing they have all of
     * it.
     */
    truncated: z.boolean(),
  })
  .strict();

export const adminMediaAssetResponseSchema = z
  .object({ asset: adminMediaAssetSchema })
  .strict();
export type AdminMediaAssetResponse = z.infer<
  typeof adminMediaAssetResponseSchema
>;

export const adminMediaPurgeRequestSchema = z
  .object({ assetId: z.uuid() })
  .strict();

/**
 * What a requested purge did.
 *
 * `owed` counts the addresses now queued to be forgotten, and a repeat asking
 * for the same asset owes nothing further — the duty is already recorded, and a
 * second row would mean discharging it twice. Zero is therefore a success and
 * not a failure, which is why the asset comes back with it: an operator needs
 * to see the purge state on the objects rather than infer it from a number.
 */
export const adminMediaPurgeResponseSchema = z
  .object({
    asset: adminMediaAssetSchema,
    owed: z.number().int().min(0),
  })
  .strict();
export type AdminMediaPurgeResponse = z.infer<
  typeof adminMediaPurgeResponseSchema
>;
