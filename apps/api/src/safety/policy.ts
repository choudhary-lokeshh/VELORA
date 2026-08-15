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

/**
 * What a report can be about.
 *
 * A closed vocabulary, because a target type is what decides which domain
 * validates the identifier and which queue the case lands in. A free string
 * would be a report pointing at something nobody checked and nobody owns.
 *
 * The identifier a report stores is always Velora's own, resolved server-side.
 * A reporter names a creator by the public handle they were looking at and a
 * club by its slug, because those are the only identifiers a public page
 * exposes; the resolution happens through the owning domain's contract, so a
 * caller can neither invent an identifier nor learn one for something that is
 * not published.
 */
export const reportTargetTypes = [
  'consumer_account',
  'creator_profile',
  'creator_content',
  'club',
  'conversation',
] as const;
export type ReportTargetType = (typeof reportTargetTypes)[number];

/**
 * Where a report was filed from.
 *
 * Derived from the credential's audience rather than from anything the request
 * body carries. A client-declared surface would be a client-authoritative fact
 * about policy, and surface is exactly the axis
 * `docs/compliance/07-surface-and-distribution-eligibility.md` makes
 * load-bearing.
 *
 * `consumer_mobile` does not distinguish iOS from Android, because the AUTH
 * audience does not. That distinction matters for mature-content surface policy
 * and is recorded as unresolved rather than guessed at here.
 */
export const reportSourceSurfaces = [
  'consumer_web',
  'consumer_mobile',
  'creator_studio',
] as const;
export type ReportSourceSurface = (typeof reportSourceSurfaces)[number];

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

/**
 * Which case-management rule was in force. Recorded on every case.
 *
 * Separate from the reporting and enforcement versions because it moves for its
 * own reasons: the queue map, the priority vocabulary, and the lease length are
 * operational policy rather than either of the other two.
 */
export const casePolicyVersion = 'v1-provisional';

/**
 * Case lifecycle.
 *
 * Only the states this milestone can actually reach. `decision_pending` and
 * `decided` arrive with moderation decisions and `appealed` with appeals;
 * declaring them now would put states in the schema that no code could move a
 * row out of, which is how a value nothing is entitled to write ends up being
 * set for convenience later.
 */
export const caseStates = [
  'new',
  'triaged',
  'investigating',
  'closed',
] as const;
export type CaseState = (typeof caseStates)[number];

/** Cases a new report joins rather than opening a second one beside. */
export const openCaseStates = ['new', 'triaged', 'investigating'] as const;

/**
 * How urgent a reviewer judged a case to be.
 *
 * **Set by a reviewer and by nothing else.** It is never derived from how many
 * reports a case carries: `docs/flows/report-to-enforcement.md` forbids report
 * volume from deciding anything, and making volume an input to priority is the
 * same mistake wearing a different word — twenty coordinated accounts would be
 * able to escalate anybody.
 *
 * `untriaged` is the state every case starts in, and it is a real answer rather
 * than a missing one: nobody has looked yet.
 *
 * Provisional. The approved severity taxonomy is `DECISION REQUIRED / LEGAL
 * REVIEW REQUIRED` alongside the risk taxonomy.
 */
export const casePriorities = [
  'untriaged',
  'low',
  'normal',
  'high',
  'urgent',
] as const;
export type CasePriority = (typeof casePriorities)[number];

/**
 * Which operator queue a case belongs to.
 *
 * Derived from what the case is about rather than from who filed it or what
 * they said, so routing is a property of the target and cannot be steered by a
 * reporter's choice of category. Provisional, like everything else here.
 */
export const caseQueues = [
  'consumer_conduct',
  'creator_content',
  'creator_identity',
] as const;
export type CaseQueue = (typeof caseQueues)[number];

const queueByTargetType: Readonly<Record<ReportTargetType, CaseQueue>> = {
  club: 'creator_content',
  consumer_account: 'consumer_conduct',
  conversation: 'consumer_conduct',
  creator_content: 'creator_content',
  creator_profile: 'creator_identity',
};

export function queueFor(targetType: ReportTargetType): CaseQueue {
  return queueByTargetType[targetType];
}

/**
 * How long a reviewer holds a case before the claim lapses.
 *
 * A lease rather than an assignment, because a reviewer whose session ends
 * mid-review must not take a case out of the queue permanently.
 * `docs/operations/02-moderation-operations.md` requires assignment to use a
 * lease or a version to prevent conflicting review; this is both.
 */
export const caseClaimLeaseMilliseconds = 30 * 60 * 1000;

/** Largest page of cases one queue read returns. */
export const maximumCasePageSize = 50;

/** Which enforcement rule produced an action. Recorded on every enforcement. */
export const enforcementPolicyVersion = 'v1-provisional';

/**
 * What an enforcement decision is *about*.
 *
 * A scope names the thing being restricted. It does not say whether the record
 * imposes the restriction or takes it away — that is the disposition below, and
 * keeping the two apart is what makes "what is in force right now" answerable
 * from this table rather than only from the domain that applied it.
 *
 * Restricting an account removes it from discovery, introductions, and
 * messaging at once, because all three read the same admission standing.
 * Closing a conversation ends one relationship without touching the rest of
 * somebody's account. Creator scopes stop a capability or take one published
 * object out of view, and never touch the person's consumer account.
 *
 * Bans, per-surface scoping, and jurisdiction gates are absent because they
 * depend on the policy taxonomy, the mature-content gates, and the surface
 * policy, none of which is decided. [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * fixes how the next one arrives: a new scope is a vocabulary change with a
 * migration and a constraint, never a new boolean and never a free string.
 */
export const enforcementScopes = [
  'account_restriction',
  'conversation_closure',
  /** Creator capability stopped. The person's consumer account is untouched. */
  'creator_suspension',
  /** Something a creator published taken down: a profile, an item, a club. */
  'creator_object_removal',
  /** One person's club entitlement withdrawn by the platform. */
  'club_membership_revocation',
] as const;
export type EnforcementScope = (typeof enforcementScopes)[number];

/**
 * Whether a record imposes a restriction or lifts one.
 *
 * Before this existed, `account_restriction` was written both by a decision
 * that restricted an account and by the review that restored it, so two rows
 * with the same scope meant opposite things and nothing could derive what was
 * in force. `creator_reinstatement` solved the same problem for creators by
 * inventing a second scope, which made direction a property of *some* scopes
 * and not others.
 *
 * One orthogonal value fixes both. The table stays append-only — a lift is
 * still a new row and never an edit — and a reader can now ask the question an
 * audit and an authorization both need: is anything currently in force.
 */
export const enforcementDispositions = ['restrict', 'lift'] as const;
export type EnforcementDisposition = (typeof enforcementDispositions)[number];

/**
 * Scopes the platform can actually reverse today.
 *
 * A conversation closure is absent because MESSAGING publishes no contract that
 * reopens one, and the object scopes are absent because republishing what an
 * operator took down is the creator's decision to take again rather than an
 * operator's to undo. A lift the platform cannot apply would be a record
 * claiming an effect that never happened.
 */
export const liftableEnforcementScopes: readonly EnforcementScope[] = [
  'account_restriction',
  'creator_suspension',
];

/**
 * Which identifier space a scope's subject lives in.
 *
 * One column carries subjects from two domains — a consumer account for the
 * first two scopes, a creator capability for the rest — and nothing in the
 * schema distinguishes them, because a cross-domain reference here is a stable
 * identifier rather than shared schema. Deriving the space from the scope keeps
 * that from being a guess at every call site, and a unit assertion pins the map
 * so a new scope cannot be added without deciding which space it belongs to.
 */
export const enforcementSubjectKinds = ['consumer_account', 'creator'] as const;
export type EnforcementSubjectKind = (typeof enforcementSubjectKinds)[number];

const subjectKindByScope: Readonly<
  Record<EnforcementScope, EnforcementSubjectKind>
> = {
  account_restriction: 'consumer_account',
  club_membership_revocation: 'creator',
  conversation_closure: 'consumer_account',
  creator_object_removal: 'creator',
  creator_suspension: 'creator',
};

export function subjectKindOf(scope: EnforcementScope): EnforcementSubjectKind {
  return subjectKindByScope[scope];
}

/**
 * Strongest first.
 *
 * A composed decision reports the *strongest* live restriction rather than
 * whichever one a query happened to return first, so the reason a subject is
 * told is stable and so two replicas answering the same question answer it the
 * same way. Global account restriction outranks a capability restriction, which
 * outranks anything scoped to a single object.
 */
export const enforcementPrecedence: readonly EnforcementScope[] = [
  'account_restriction',
  'creator_suspension',
  'conversation_closure',
  'creator_object_removal',
  'club_membership_revocation',
];

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
 * Version of the rule that composes live enforcements into an answer.
 *
 * Separate from `enforcementPolicyVersion` because the two change for different
 * reasons. That one moves when what an enforcement may record changes; this one
 * moves when the precedence or the capability map changes, and an eligibility
 * answer carries it so a decision taken under an older rule stays explicable.
 */
export const eligibilityPolicyVersion = 'v1-provisional';

/**
 * What another domain may ask TRUST & SAFETY about.
 *
 * A closed vocabulary rather than a scope, because a caller asks about
 * something it wants to do and should not have to know which enforcement scopes
 * bear on it. `docs/architecture/03-domain-boundaries.md` keeps the mapping
 * here, in the domain that owns enforcement, so adding a scope does not require
 * every caller to learn about it.
 *
 * These answer only the safety question. Account standing is USERS' truth,
 * creator lifecycle is CREATORS', and commercial terms are BILLING's; a caller
 * still evaluates its own predicates and this is one conjunct among them.
 */
export const safetyCapabilities = [
  /** May this consumer take part in discovery, introductions, and messaging. */
  'consumer_interaction',
  /** May this creator operate creator features at all. */
  'creator_operation',
  /** May this creator publish or keep something published. */
  'creator_publication',
  /** May this creator take part in commercial activity. */
  'commercial_participation',
] as const;
export type SafetyCapability = (typeof safetyCapabilities)[number];

interface CapabilityRule {
  readonly blockedBy: readonly EnforcementScope[];
  readonly subjectKind: EnforcementSubjectKind;
}

/**
 * Which live enforcements deny which capability.
 *
 * Creator capability, publication, and commercial participation are three
 * separate questions that a suspension happens to answer identically today.
 * They stay separate values rather than one because the moment a scope exists
 * that stops publication without stopping the whole capability — which is what
 * the mature-content gates will need — that must be a change to one row of this
 * map rather than a change to every caller.
 */
const capabilityRules: Readonly<Record<SafetyCapability, CapabilityRule>> = {
  commercial_participation: {
    blockedBy: ['creator_suspension'],
    subjectKind: 'creator',
  },
  consumer_interaction: {
    blockedBy: ['account_restriction'],
    subjectKind: 'consumer_account',
  },
  creator_operation: {
    blockedBy: ['creator_suspension'],
    subjectKind: 'creator',
  },
  creator_publication: {
    blockedBy: ['creator_suspension'],
    subjectKind: 'creator',
  },
};

export function subjectKindForCapability(
  capability: SafetyCapability,
): EnforcementSubjectKind {
  return capabilityRules[capability].subjectKind;
}

/** The scopes that deny a capability, strongest first. */
export function blockingScopesFor(
  capability: SafetyCapability,
): readonly EnforcementScope[] {
  const rule = capabilityRules[capability];
  return enforcementPrecedence.filter((scope) =>
    rule.blockedBy.includes(scope),
  );
}

/**
 * What a denied subject may be told.
 *
 * Deliberately coarse, and deliberately not the enforcement reason code. A
 * subject is entitled to know the category and the scope of what was done to
 * them; they are not entitled to the review's finding, the report behind it, or
 * anything that would identify a reporter. Regulation (EU) 2022/2065's
 * statement-of-reasons shape is recorded in
 * `docs/compliance/07-surface-and-distribution-eligibility.md`; this is the
 * vocabulary that satisfies it without disclosing evidence.
 */
export const safetyDenialReasons = [
  'account_restricted',
  'creator_capability_suspended',
  'conversation_closed',
  'object_restricted',
] as const;
export type SafetyDenialReason = (typeof safetyDenialReasons)[number];

const denialReasonByScope: Readonly<
  Record<EnforcementScope, SafetyDenialReason>
> = {
  account_restriction: 'account_restricted',
  club_membership_revocation: 'object_restricted',
  conversation_closure: 'conversation_closed',
  creator_object_removal: 'object_restricted',
  creator_suspension: 'creator_capability_suspended',
};

export function denialReasonFor(scope: EnforcementScope): SafetyDenialReason {
  return denialReasonByScope[scope];
}

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
