import { z } from 'zod';

import { clubSlugSchema } from './clubs.js';
import { creatorHandleSchema } from './creator.js';
import { idempotencyKeySchema } from './product.js';

/**
 * Trust and safety contract.
 *
 * Two rules shape every shape here.
 *
 * A block is never disclosed. Nothing in this contract tells anybody that they
 * have been blocked, by whom, or when; a blocked person's experience is that a
 * candidate is not there and a message cannot be sent, which is exactly what a
 * peer sees when somebody simply is not available.
 *
 * A report is evidence, not a record a consumer may browse. The reporter learns
 * that their report exists and what state it is in. The reporter's identity, the
 * narrative they wrote, and every internal rationale are absent from this
 * contract entirely — there is no field for them, so no response can carry one.
 */

/**
 * What a reporter may say is wrong.
 *
 * **Provisional.** The approved risk taxonomy is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. This is a reporter-facing
 * selection, and it is deliberately not the vocabulary an enforcement decision
 * records: a report is an allegation, and only a review makes it anything more.
 */
export const reportReasonSchema = z.enum([
  'underage_concern',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'other',
]);

/** Report lifecycle, as its own reporter may see it. */
export const reportStateSchema = z.enum([
  'received',
  'under_review',
  'actioned',
  'dismissed',
]);

export const blockRequestSchema = z.object({ targetId: z.uuid() }).strict();

export const blockSchema = z
  .object({
    blockedId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const blockListResponseSchema = z
  .object({
    blocks: z.array(blockSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/** Longest reporter narrative accepted. */
export const maximumReportDetailCharacters = 2_000;

/**
 * What a reporter names.
 *
 * A discriminated union rather than one identifier, because a reporter names
 * what they were looking at and public surfaces expose different addresses for
 * different things: an account has an identifier, a creator has a handle, a
 * club has a handle and a slug, a content item has an identifier, and a
 * conversation has one only to the people in it.
 *
 * The server resolves each of these through the owning domain's contract before
 * anything is recorded, so a caller can neither invent a target nor learn an
 * internal identifier for something they could not already see.
 */
export const reportTargetSchema = z.discriminatedUnion('type', [
  z
    .object({ accountId: z.uuid(), type: z.literal('consumer_account') })
    .strict(),
  z
    .object({
      handle: creatorHandleSchema,
      type: z.literal('creator_profile'),
    })
    .strict(),
  z
    .object({ contentId: z.uuid(), type: z.literal('creator_content') })
    .strict(),
  z
    .object({
      handle: creatorHandleSchema,
      slug: clubSlugSchema,
      type: z.literal('club'),
    })
    .strict(),
  z
    .object({ conversationId: z.uuid(), type: z.literal('conversation') })
    .strict(),
]);
export type ReportTarget = z.infer<typeof reportTargetSchema>;

/** What kind of thing a report is about. */
export const reportTargetTypeSchema = z.enum([
  'consumer_account',
  'creator_profile',
  'creator_content',
  'club',
  'conversation',
]);
export type ReportTargetTypeValue = z.infer<typeof reportTargetTypeSchema>;

export const createReportRequestSchema = z
  .object({
    /** Makes submission retry-safe. Scoped by the server to the reporter. */
    clientReportId: idempotencyKeySchema,
    /** Opaque conversation reference, when the report comes from one. */
    conversationId: z.uuid().optional(),
    detail: z.string().min(1).max(maximumReportDetailCharacters).optional(),
    /** Opaque message reference. Only meaningful with a conversation. */
    messageId: z.uuid().optional(),
    reasonCode: reportReasonSchema,
    target: reportTargetSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.messageId === undefined || value.conversationId !== undefined,
    'Evidence about a message must name the conversation it is in',
  );

/**
 * A report as its own reporter may see it.
 *
 * There is no reporter field, because the only caller who can retrieve this is
 * the reporter. There is no detail field: echoing stored evidence back over the
 * API would turn an evidence record into a readable store, and the reporter
 * already knows what they wrote. There is no moderator, no case, and no
 * rationale.
 */
export const reportSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    reasonCode: reportReasonSchema,
    state: reportStateSchema,
    /**
     * What kind of thing was reported, and deliberately not which one. The
     * reporter named it publicly; echoing Velora's internal identifier back
     * would hand them one they never had.
     */
    targetType: reportTargetTypeSchema,
  })
  .strict();

export const reportListResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    reports: z.array(reportSchema),
  })
  .strict();

/**
 * What an enforcement decision is about, on the wire.
 *
 * A closed vocabulary rather than a string, because a wire field that accepts
 * any word is a vocabulary nothing enforces: an operator surface would render
 * whatever the server happened to send, and a typo would ship as a scope. It
 * mirrors the domain vocabulary exactly and a unit assertion keeps the two from
 * drifting.
 */
export const enforcementScopeSchema = z.enum([
  'account_restriction',
  'conversation_closure',
  'creator_suspension',
  'creator_object_removal',
  'club_membership_revocation',
]);
export type EnforcementScopeValue = z.infer<typeof enforcementScopeSchema>;

/** Whether a record imposed a restriction or took one away. */
export const enforcementDispositionSchema = z.enum(['restrict', 'lift']);
export type EnforcementDispositionValue = z.infer<
  typeof enforcementDispositionSchema
>;

export type Block = z.infer<typeof blockSchema>;
export type Report = z.infer<typeof reportSchema>;

/**
 * What a person may be told about a decision that affected them.
 *
 * Regulation (EU) 2022/2065 Article 17 shapes this: somebody whose account was
 * restricted or whose content was removed is entitled to the reasons and to the
 * redress available. What they are *not* entitled to, and what has no field
 * here, is the review's finding, the evidence, the reviewer, or anything that
 * could identify a reporter.
 *
 * The reason code is the disclosable one derived from the scope. It is a
 * different vocabulary from the reporter categories and from the enforcement
 * findings, and a unit assertion keeps the three from converging.
 */
export const safetyDenialReasonSchema = z.enum([
  'account_restricted',
  'creator_capability_suspended',
  'conversation_closed',
  'object_restricted',
]);

export const safetyStatementSchema = z
  .object({
    /** Whether a complaint about this decision is available. */
    appealable: z.boolean(),
    /** After which a complaint would be out of time. Absent while none is published. */
    appealWindowClosesAt: z.iso.datetime().optional(),
    decidedAt: z.iso.datetime(),
    decisionId: z.uuid(),
    reasonCode: safetyDenialReasonSchema,
    scope: enforcementScopeSchema,
  })
  .strict();
export type SafetyStatement = z.infer<typeof safetyStatementSchema>;

/**
 * What is currently in force against the caller, and why.
 *
 * Only decisions that imposed something and that nothing has replaced. A
 * restriction that was lifted is not something somebody is under, and telling
 * them otherwise would be worse than telling them nothing.
 */
export const safetyStandingResponseSchema = z
  .object({ statements: z.array(safetyStatementSchema) })
  .strict();

export const appealStateSchema = z.enum([
  'received',
  'under_review',
  'upheld',
  'refused',
  'withdrawn',
]);
export type AppealStateValue = z.infer<typeof appealStateSchema>;

/**
 * A complaint as its own appellant sees it.
 *
 * The state and the dates, and nothing else. Not the reviewer who answered it,
 * not the decision that replaced the original, and not the statement they
 * wrote — they already know what they wrote, and echoing stored text back over
 * the API turns a record into a readable store.
 */
export const appealSchema = z
  .object({
    decisionId: z.uuid(),
    id: z.uuid(),
    state: appealStateSchema,
    submittedAt: z.iso.datetime(),
    windowClosesAt: z.iso.datetime().optional(),
  })
  .strict();
export type Appeal = z.infer<typeof appealSchema>;

export const appealListResponseSchema = z
  .object({ appeals: z.array(appealSchema) })
  .strict();

/**
 * Submitting a complaint.
 *
 * There is no field saying which kind of appellant the caller is. Who they are
 * to this decision — the person it was about, or the person whose report was
 * dismissed — is derived from the decision and the case on the server, because
 * a client-declared role is a client-authoritative fact about entitlement.
 */
export const createAppealRequestSchema = z
  .object({
    decisionId: z.uuid(),
    statement: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const withdrawAppealRequestSchema = z
  .object({ appealId: z.uuid() })
  .strict();

/**
 * Why mature creator content is unavailable.
 *
 * Reported plainly rather than hidden behind a workflow that cannot succeed.
 * Each blocker is owned by a different authority and each is separately
 * liftable, so a creator can see that none of the remaining work is theirs.
 */
export const matureReadinessBlockerSchema = z.enum([
  'mature_content_capability_disabled',
  'depicted_person_verifier_unavailable',
  'consent_wording_unpublished',
  'content_taxonomy_undecided',
]);

export const matureSurfaceEligibilitySchema = z
  .object({
    /** False for the app-store surfaces, permanently and not by configuration. */
    eligible: z.boolean(),
    surface: z.enum([
      'web',
      'mobile_ios',
      'mobile_android',
      'creator_studio',
      'platform_admin',
    ]),
  })
  .strict();

/**
 * Whether a creator could publish mature content, and what stands in the way.
 *
 * `enabled` is false in every environment and there is no configured value that
 * would make it true. The sources are reported by name rather than as booleans,
 * because "off" and "off because nobody has approved one" are different facts
 * and a creator deserves the second one.
 */
export const creatorMatureReadinessResponseSchema = z
  .object({
    blockers: z.array(matureReadinessBlockerSchema),
    /** Which consent wording is published. `unpublished` everywhere. */
    consentPolicySource: z.string().min(1).max(64),
    enabled: z.boolean(),
    /** Which mature-content capability value is configured. `disabled` everywhere. */
    matureContentSource: z.string().min(1).max(64),
    surfaces: z.array(matureSurfaceEligibilitySchema),
    /** Which IDENTITY provider is configured. `unavailable` everywhere. */
    verifierSource: z.string().min(1).max(64),
  })
  .strict();
export type CreatorMatureReadinessResponse = z.infer<
  typeof creatorMatureReadinessResponseSchema
>;
