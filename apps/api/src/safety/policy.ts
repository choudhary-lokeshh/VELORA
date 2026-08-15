/**
 * Approved V1 trust and safety policy.
 *
 * Two vocabularies live here and they are deliberately different things.
 *
 * The report reason codes are a *reporter-facing selection*: what a consumer
 * picks from when they say something is wrong. The enforcement reason codes are
 * what a moderation decision records. Collapsing them would have meant a
 * reporter's category silently becoming an enforcement finding, which is exactly
 * the confusion the report-to-enforcement flow exists to prevent — a report is
 * an allegation, and only a review makes it anything else.
 *
 * **Neither vocabulary is the approved risk taxonomy.** That taxonomy is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. Both sets below are provisional,
 * are versioned so a later change is visible in the record, and are small enough
 * that replacing them is a migration rather than a rewrite.
 */

/** Which reporting vocabulary produced a report. Recorded on every row. */
export const reportPolicyVersion = 'v1-provisional';

/**
 * What a reporter may say is wrong.
 *
 * Provisional. `underage_concern` is first in intent rather than in order: an
 * adults-only platform that cannot be told about a suspected minor has a hole
 * where its most important report ought to be.
 */
export const reportReasonCodes = [
  'underage_concern',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'other',
] as const;
export type ReportReasonCode = (typeof reportReasonCodes)[number];

/**
 * Report lifecycle.
 *
 * `received -> under_review -> actioned | dismissed`. There is no state for
 * "auto-resolved": no automation decides a report in V1, and a state nothing can
 * reach is a state somebody will eventually make reachable by accident.
 */
export const reportStates = [
  'received',
  'under_review',
  'actioned',
  'dismissed',
] as const;
export type ReportState = (typeof reportStates)[number];

export const openReportStates = ['received', 'under_review'] as const;

/** Longest reporter narrative accepted. Evidence, and bounded like any input. */
export const maximumReportDetailCharacters = 2_000;

/**
 * How many reports one account may file in the rate window.
 *
 * A cap on volume, not on truth: reaching it refuses further submissions for a
 * while and never discards a report already made. The flow document is explicit
 * that duplicate or malicious reports are rate limited but never silently
 * erased, because a discarded report is destroyed evidence.
 */
export const reportRateLimitCount = 20;
export const reportRateWindowMilliseconds = 60 * 60 * 1000;

/** Which enforcement rule produced an action. Recorded on every enforcement. */
export const enforcementPolicyVersion = 'v1-provisional';

/**
 * What an enforcement decision may do in V1.
 *
 * Deliberately two things. Restricting an account removes it from discovery,
 * introductions, and messaging at once, because all three read the same
 * admission standing. Closing a conversation ends one relationship without
 * touching the rest of somebody's account. Bans, suspensions with an expiry,
 * appeals, and scope-by-surface enforcement all depend on the policy taxonomy
 * and the appeal process, neither of which is decided.
 */
export const enforcementScopes = [
  'account_restriction',
  'conversation_closure',
  /** Creator capability stopped. The person's consumer account is untouched. */
  'creator_suspension',
  /** A stopped capability restored. Recorded as its own row, never an edit. */
  'creator_reinstatement',
  /** Something a creator published taken down: a profile, an item, a club. */
  'creator_object_removal',
  /** One person's club entitlement withdrawn by the platform. */
  'club_membership_revocation',
] as const;
export type EnforcementScope = (typeof enforcementScopes)[number];

/**
 * What a creator-scoped enforcement can name.
 *
 * A closed vocabulary rather than a free polymorphic reference, and every value
 * is validated by the domain that owns it before an enforcement is recorded —
 * `docs/domains/trust-safety.md` requires an enforcement to be about something
 * that exists, and a target nobody validated is a record that cannot be acted
 * on later.
 */
export const enforcementObjectTypes = [
  'creator_profile',
  'creator_content',
  'club',
  'club_membership',
] as const;
export type EnforcementObjectType = (typeof enforcementObjectTypes)[number];

/** Scopes that name an object, and therefore require one. */
export const objectScopedEnforcements: readonly EnforcementScope[] = [
  'creator_object_removal',
  'club_membership_revocation',
];

/**
 * What a moderation decision may record as its finding. Provisional, and
 * separate from the reporter vocabulary above on purpose.
 */
export const enforcementReasonCodes = [
  'underage_risk',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'platform_integrity',
] as const;
export type EnforcementReasonCode = (typeof enforcementReasonCodes)[number];

/**
 * What has to be decided before this domain may run in a deployed environment.
 *
 * Blocks and reports themselves are not blocked on anything: a person must be
 * able to stop somebody contacting them, and must be able to report, from the
 * first day the product exists. What is blocked is the review and enforcement
 * process around them.
 */
export const productionBlockers = [
  'risk-taxonomy-undecided',
  'emergency-action-policy-undecided',
  'appeal-process-and-sla-undecided',
  'evidence-retention-undecided',
  'admin-sign-in-has-no-approved-implementation',
] as const;

/** Largest page of blocks or reports one read returns. */
export const maximumSafetyPageSize = 50;
