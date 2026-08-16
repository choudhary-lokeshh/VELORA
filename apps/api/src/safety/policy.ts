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
 * Only the states this milestone can actually reach. `appealed` arrives with
 * appeals; declaring it now would put a state in the schema that no code could
 * move a row out of, which is how a value nothing is entitled to write ends up
 * being set for convenience later.
 *
 * `decided` and `closed` are both terminal and they are not the same fact. A
 * closed case is one nobody is going to look at any further; a decided case is
 * one somebody judged, and the judgement is a record of its own. Collapsing
 * them would make "was this reviewed" a question answerable only by joining to
 * another table, and would let a case that was quietly dropped read exactly
 * like one that was considered.
 */
export const caseStates = [
  'new',
  'triaged',
  'investigating',
  'decided',
  'closed',
] as const;
export type CaseState = (typeof caseStates)[number];

/** Cases a new report joins rather than opening a second one beside. */
export const openCaseStates = ['new', 'triaged', 'investigating'] as const;

/**
 * Cases that have left the queue.
 *
 * A target may have a new case opened about it once the previous one reaches
 * one of these, because the previous review is over either way.
 */
export const resolvedCaseStates: readonly CaseState[] = ['decided', 'closed'];

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

/**
 * Which evidence rule was in force. Recorded on every evidence record.
 *
 * Separate from the case version because what may be recorded as evidence, and
 * in what shape, moves for its own reasons — a new reference type or a new
 * bound on a note is not a change to how a queue is worked.
 */
export const evidencePolicyVersion = 'v1-provisional';

/**
 * What may be recorded as evidence in a case.
 *
 * Evidence explains a decision. It is a **reference or a minimal snapshot** and
 * never a copy of another domain's record: a whole private conversation copied
 * into `safety_` would be a second, less protected store of the thing the
 * platform is most obliged not to leak, and it would go stale the moment the
 * original changed. [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * fixes that shape, and the column layout enforces it: a reference kind carries
 * an identifier and nothing else, a snapshot kind carries a bounded state label
 * that cannot hold prose, and exactly one kind carries free text.
 */
export const evidenceKinds = [
  /** A report filed in this case. The narrative stays on the report. */
  'report',
  /** One message named by a report in this case. Never its body. */
  'message_reference',
  'creator_content_reference',
  'club_reference',
  /** What a creator's page was, at the moment somebody looked. */
  'creator_profile_state',
  /** A depicted-person consent record held by an approved verifier. */
  'consent_evidence_reference',
  /** An approved verifier's outcome reference. Never a document. */
  'external_verification_reference',
  /** A reviewer's own words. The one kind that carries prose. */
  'operator_note',
  /** Something the platform observed about itself. A code, not a sentence. */
  'system_fact',
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

/**
 * What an evidence reference names.
 *
 * A closed vocabulary for the same reason the report target types are one: the
 * type is what decides how the identifier is checked, and a free string would
 * be evidence pointing at something nobody owns.
 */
export const evidenceReferenceTypes = [
  'safety_report',
  'message',
  'creator_profile',
  'creator_content',
  'club',
  'consent_record',
] as const;
export type EvidenceReferenceType = (typeof evidenceReferenceTypes)[number];

/** Kinds that name something, and therefore carry a reference. */
export const referencedEvidenceKinds: readonly EvidenceKind[] = [
  'club_reference',
  'consent_evidence_reference',
  'creator_content_reference',
  'creator_profile_state',
  'message_reference',
  'report',
];

/**
 * Kinds that carry a bounded state label rather than a reference or prose.
 *
 * The label is a code — lowercase, no spaces, sixty-four characters — because a
 * snapshot field that accepted a sentence would become the place a message body
 * or a reporter's narrative ends up, one convenient call site at a time.
 */
export const snapshotEvidenceKinds: readonly EvidenceKind[] = [
  'creator_profile_state',
  'system_fact',
];

/**
 * Kinds no approved authority can produce.
 *
 * An external verification reference is an approved verifier's outcome handle
 * about something other than a depicted person, and Velora has no approved
 * verifier of that kind at all. The vocabulary exists so the evidence model is
 * whole; recording one is refused rather than accepted as an unbacked
 * assertion, which is the same fail-closed shape the adult-assurance gate has.
 *
 * Depicted-person consent is *not* in this set, and deliberately so. It fails
 * closed through the data rather than through a list: a consent record can only
 * exist if an approved verifier captured it under approved wording, and neither
 * exists in a deployed environment, so there is nothing for a citation to name.
 * A gate enforced by what can exist is stronger than one enforced by a check
 * somebody could forget.
 */
export const unavailableEvidenceKinds: readonly EvidenceKind[] = [
  'external_verification_reference',
];

/**
 * The shape a snapshot label and an external reference may take.
 *
 * Both are deliberately narrow. A label is an identifier-shaped code and an
 * external reference is an opaque verifier handle; neither can hold a
 * narrative, a message body, or a line of identity evidence, because neither
 * can hold a space.
 */
export const evidenceStateLabelPattern = '^[a-z][a-z0-9_]{0,63}$';
export const verifierReferencePattern = '^[A-Za-z0-9._:-]{1,200}$';

/** Longest reviewer note accepted. Prose, and bounded like any input. */
export const maximumOperatorNoteCharacters = 2_000;

/** Largest page of evidence or decisions one case read returns. */
export const maximumCaseRecordPageSize = 200;

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

/** Which decision rule was in force. Recorded on every decision. */
export const decisionPolicyVersion = 'v1-provisional';

/**
 * Why a decision was taken.
 *
 * A superset of the enforcement findings, because a review that found nothing
 * still has a reason and none of the findings is it. Recording "no action,
 * platform integrity" would be a decision that reads like a finding of
 * wrongdoing followed by leniency, which is a worse record than none.
 *
 * A decision that enforces may use only the finding vocabulary — a restriction
 * imposed for `no_violation_found` would be incoherent — and the schema
 * enforces that rather than leaving it to the caller.
 */
export const decisionReasonCodes = [
  ...enforcementReasonCodes,
  /** Reviewed, and the allegation was not made out. */
  'no_violation_found',
  /** Reviewed, and there was not enough to decide either way. */
  'insufficient_evidence',
  /** Handed on, because deciding it needs authority this reviewer lacks. */
  'requires_specialist_review',
] as const;
export type DecisionReasonCode = (typeof decisionReasonCodes)[number];

/**
 * What a reviewer may decide.
 *
 * A closed vocabulary, and separate from both the scope and the reason code. A
 * scope says what a restriction is *about*; an action says what the reviewer
 * did, including deciding to do nothing — which is a decision worth recording,
 * because "we looked and found no violation" is the only thing that
 * distinguishes an examined case from an abandoned one.
 *
 * `temporary_hold` is deliberately its own action rather than a restriction
 * with an expiry attached. [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * requires a hold to be distinguishable in the schema from a final violation
 * finding, because an accusation recorded as guilt is a defamation the platform
 * authored.
 */
export const decisionActions = [
  'no_action',
  'temporary_hold',
  'unpublish',
  'restrict_capability',
  'revoke_restriction',
  'escalate',
] as const;
export type DecisionAction = (typeof decisionActions)[number];

/**
 * Actions that end the review.
 *
 * Everything except escalation, which hands the case on rather than settling
 * it. The distinction is load-bearing: a case may be escalated many times and
 * settled once, which is what the partial unique index over the resolving
 * decisions of a case enforces.
 */
export const resolvingDecisionActions: readonly DecisionAction[] = [
  'no_action',
  'restrict_capability',
  'revoke_restriction',
  'temporary_hold',
  'unpublish',
];

/** Actions that produce an enforcement record, and therefore name a scope. */
export const enforcingDecisionActions: readonly DecisionAction[] = [
  'restrict_capability',
  'revoke_restriction',
  'temporary_hold',
  'unpublish',
];

/**
 * Which scopes each action may name.
 *
 * The map is here rather than at the call site so that a scope added to the
 * enforcement vocabulary has to be given an action deliberately. A scope no
 * action names is a restriction nothing can decide, which is a better failure
 * than a decision quietly acquiring a power nobody granted it.
 */
const scopesByDecisionAction: Readonly<
  Record<DecisionAction, readonly EnforcementScope[]>
> = {
  escalate: [],
  no_action: [],
  restrict_capability: [
    'account_restriction',
    'conversation_closure',
    'creator_suspension',
    'club_membership_revocation',
  ],
  revoke_restriction: liftableEnforcementScopes,
  temporary_hold: ['account_restriction', 'creator_suspension'],
  unpublish: ['creator_object_removal'],
};

export function scopesForDecision(
  action: DecisionAction,
): readonly EnforcementScope[] {
  return scopesByDecisionAction[action];
}

/**
 * What a decision records about the subject's safety standing.
 *
 * The prior and resulting state describe **what this domain decides**, not
 * another domain's column. An account's status is USERS' truth and SAFETY may
 * not read it; what SAFETY can state, and be held to, is whether a live
 * restriction stood before the decision and whether one stands after it. Both
 * are read inside the decision's own transaction, under the subject lock, so
 * the pair is a fact about one instant rather than two.
 */
export const decisionSubjectStates = ['unrestricted', 'restricted'] as const;
export type DecisionSubjectState = (typeof decisionSubjectStates)[number];

/**
 * Which depicted-person rule was in force. Recorded on every declaration,
 * participant, and consent record.
 */
export const consentPolicyVersion = 'v1-provisional';

/**
 * Whether a content item depicts anybody, as its creator states it.
 *
 * A declaration is required because *absence is not an answer*. No row means
 * the creator has never been asked or has never replied, which is a different
 * fact from "nobody is depicted here" — and treating the two as the same would
 * make every unasked item silently compliant.
 *
 * [Surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * records why this matters: the record-keeping duty attaches to depictions of
 * actual people, and whether Velora is the party it attaches to is a legal
 * question nobody here may answer. What is answerable is whether the creator
 * was asked and what they said.
 */
export const depictionDeclarations = [
  'no_depicted_persons',
  'depicted_persons',
] as const;
export type DepictionDeclaration = (typeof depictionDeclarations)[number];

/**
 * How much is actually known about a depicted person.
 *
 * `asserted` is the creator's word and nothing more. `verified` means an
 * approved verifier examined an identification document and returned a
 * normalized outcome, and the platform holds a reference to that outcome rather
 * than the document.
 *
 * The two are separate values that no code widens into each other, for the same
 * reason `self_declared` and `verified_adult` are separate adult-assurance
 * classes: 18 U.S.C. § 2257 requires identity and date of birth to be
 * ascertained *by examination of an identification document*, so an
 * architecture in which a creator merely asserts that a depicted person is an
 * adult cannot satisfy it, and recording an assertion as verification would be
 * the platform stating something nobody checked.
 */
export const depictedPersonEvidenceStates = ['asserted', 'verified'] as const;
export type DepictedPersonEvidenceState =
  (typeof depictedPersonEvidenceStates)[number];

/**
 * What a depicted person's consent covers.
 *
 * Scoped rather than universal, because "this person once consented to
 * something" is not permission for anything else. Each scope is granted and
 * revoked on its own, so a person who withdraws permission to monetise a
 * depiction has not necessarily withdrawn permission to publish it, and the
 * platform never has to guess which they meant.
 *
 * **Provisional.** The approved scope list, the wording each scope carries, and
 * what a revocation withdraws are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`
 * and recorded in [DECISIONS_REQUIRED](../../../../docs/decisions/DECISIONS_REQUIRED.md).
 * They are values here so that a later approved scope is a migration and a
 * version bump rather than a rewrite.
 */
export const consentScopes = [
  /** May the depiction be published at all. */
  'publication',
  /** May it be delivered beyond the creator's own view. */
  'distribution',
  /** May it be monetised. */
  'commercial_use',
] as const;
export type ConsentScope = (typeof consentScopes)[number];

/** Whether a consent record grants permission or takes it away. */
export const consentDispositions = ['grant', 'revoke'] as const;
export type ConsentDisposition = (typeof consentDispositions)[number];

/**
 * The version of the wording a depicted person agreed to.
 *
 * `0-unpublished` is the honest value while no wording is approved, and it is
 * the same idiom the consumer and creator policy documents already use. A grant
 * recorded under unpublished wording would be a claim that somebody agreed to
 * words that do not exist, so the consent authority refuses to record one at
 * all rather than storing it against a placeholder.
 */
export const unpublishedConsentCopyVersion = '0-unpublished';

/**
 * Why a content item's consent evidence does not satisfy a scope.
 *
 * Internal and coarse. It explains a gate to the operator or the creator who
 * has to close it, and it says nothing about who the depicted person is —
 * there is no field here that could.
 */
export const consentDenialReasons = [
  /** Nobody has stated whether this item depicts anybody. */
  'undeclared',
  /** The creator said people are depicted and named none of them. */
  'participants_missing',
  /** Declared, and nobody verified. A creator's word is not evidence. */
  'assertion_only',
  /** The verification itself lapsed and has not been renewed. */
  'evidence_expired',
  /** No consent covering this scope was ever recorded. */
  'consent_missing',
  'consent_expired',
  'consent_revoked',
  /** No approved verifier or no approved wording, so nothing can be relied on. */
  'authority_unavailable',
] as const;
export type ConsentDenialReason = (typeof consentDenialReasons)[number];

/**
 * Most people one content item may declare, and most consent records one item
 * may accumulate.
 *
 * Both are enforced on the write path rather than only on the read, because the
 * gate query has to be *complete* to be correct: a read that silently stopped
 * at a page boundary could report an item as consented while somebody's
 * withdrawal sat on the next page. Bounding what can be written is what makes
 * bounding what is read safe.
 */
export const maximumDepictedPersonPageSize = 100;
export const maximumConsentRecordsPerContent = 1_000;

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

/**
 * Which content-safety rule was in force. Recorded on every classification and
 * carried by every gate answer.
 */
export const contentSafetyPolicyVersion = 'v1-provisional';

/**
 * Where content can be delivered.
 *
 * A first-class closed vocabulary, because [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * makes surface a separate predicate from content: an item can be entirely
 * lawful, fully consented, fully moderated, and still be forbidden on two of
 * these five. A content decision that names no surface is incomplete.
 *
 * **Deliberately not the same vocabulary as `reportSourceSurfaces`.** That one
 * is derived from a credential's audience, and the AUTH audience cannot tell
 * iOS from Android, so it is coarser by necessity. The distinction between the
 * two mobile stores is exactly what decides mature eligibility, which is why a
 * content decision may never be derived from where a report was filed. A unit
 * assertion keeps the two sets from converging.
 */
export const distributionSurfaces = [
  'web',
  'mobile_ios',
  'mobile_android',
  'creator_studio',
  'platform_admin',
] as const;
export type DistributionSurface = (typeof distributionSurfaces)[number];

/**
 * Surfaces that may never carry mature content.
 *
 * A property of the surface rather than a configuration value. Both stores
 * prohibit the content class outright with no published approval path —
 * recorded with sources and retrieval dates in
 * [surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * — so this is a prohibition rather than a restriction pending approval. No
 * environment variable, country row, creator setting, or client field can
 * change it, and a test asserts that.
 */
export const matureIneligibleSurfaces: readonly DistributionSurface[] = [
  'mobile_ios',
  'mobile_android',
];

/**
 * What a content item is, as its creator declares it.
 *
 * Three values rather than one `mature` boolean, because the classes carry
 * different evidence obligations. 18 U.S.C. § 2257 attaches to depictions of
 * **actual** sexually explicit conduct and not to simulated conduct, so a
 * taxonomy that could not tell them apart would either over-collect evidence
 * for one or under-collect it for the other.
 *
 * **Provisional.** The approved content taxonomy is `DECISION REQUIRED / LEGAL
 * REVIEW REQUIRED`, recorded in [DECISIONS_REQUIRED](../../../../docs/decisions/DECISIONS_REQUIRED.md).
 * These are versioned so a later change is visible in the record.
 */
export const contentClassifications = [
  'general',
  'mature_simulated',
  'mature_actual',
] as const;
export type ContentClassification = (typeof contentClassifications)[number];

/** The classes the mature-content gates apply to. */
export const matureContentClassifications: readonly ContentClassification[] = [
  'mature_actual',
  'mature_simulated',
];

/**
 * What a caller is about to do with a content item.
 *
 * Separate values even where the answer happens to be the same today, for the
 * same reason the safety capabilities are separate: the moment a rule applies
 * to delivery and not to publication, that must be one row of a map rather than
 * a change at every call site.
 */
export const contentCapabilities = [
  'publish',
  'remain_public',
  'deliver',
  'monetise',
] as const;
export type ContentCapability = (typeof contentCapabilities)[number];

/** Which consent scope each capability needs from every depicted person. */
const consentScopeByCapability: Readonly<
  Record<ContentCapability, ConsentScope>
> = {
  deliver: 'distribution',
  monetise: 'commercial_use',
  publish: 'publication',
  remain_public: 'publication',
};

export function consentScopeFor(capability: ContentCapability): ConsentScope {
  return consentScopeByCapability[capability];
}

/**
 * Why a content capability was refused.
 *
 * Coarse and disclosable to the creator whose item it is. It names which gate
 * closed, never the reasoning behind it, and never anything about a depicted
 * person or a reporter.
 */
export const contentDenialReasons = [
  /** The whole capability is off, in every environment. */
  'mature_content_disabled',
  /** This surface may never carry this class, whatever else is true. */
  'surface_ineligible',
  /** Nobody declared this item as the class the caller is asking about. */
  'classification_undeclared',
  /** The creator's own standing denies it. */
  'creator_restricted',
  /** This item is held out of view by an enforcement decision. */
  'object_restricted',
  /** Depicted-person evidence does not cover what is being asked. */
  'consent_incomplete',
  /** The viewer does not hold the assurance this class requires. */
  'adult_assurance_insufficient',
] as const;
export type ContentDenialReason = (typeof contentDenialReasons)[number];

/**
 * The assurance a viewer must hold before a mature class may be delivered.
 *
 * `verified_adult` and nothing weaker. Ofcom's published guidance names
 * self-declaration, and payment without an age check, as *not* highly
 * effective; both are recorded by name in
 * [surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md).
 * No approved verifier can produce `verified_adult`, so this fails closed —
 * which is the correct behaviour rather than a gap.
 */
export const matureViewerAssurance = 'verified_adult';

/**
 * Which takedown rule was in force. Recorded on every claim.
 *
 * Separate from the deadline policy version, which is recorded beside it. This
 * one moves when the claim vocabulary changes; that one moves when a published
 * deadline does, and production publishes none.
 */
export const takedownPolicyVersion = 'v1-provisional';

/**
 * Who is asking for something to come down.
 *
 * A claim is not a report. A report is filed by a Velora account about a
 * target; a claim asks for a specific item to be removed and can come from
 * somebody who has no account at all — a depicted person is the case
 * [surface and distribution eligibility](../../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * records, where the card-network requirement is an appeals route allowing a
 * depicted person to request removal.
 *
 * Only an account holder has an identifier here. Nothing stores a name, an
 * address, or a means of contact for anybody else, because this domain has no
 * business holding one and no contract that would use it.
 */
export const takedownClaimantKinds = [
  'depicted_person',
  'account_holder',
  'operator',
  'external',
] as const;
export type TakedownClaimantKind = (typeof takedownClaimantKinds)[number];

/**
 * What a claim says is wrong.
 *
 * Provisional, and deliberately narrow: these are the classes with a published
 * obligation behind them rather than a general complaint vocabulary, which is
 * what reports are for.
 */
export const takedownReasonCodes = [
  'non_consensual_content',
  'consent_withdrawn',
  'illegal_content',
  'other',
] as const;
export type TakedownReasonCode = (typeof takedownReasonCodes)[number];

/**
 * Claim lifecycle.
 *
 * `received -> acknowledged -> decided -> completed`, or `dismissed`. Decided
 * and completed are separate instants because a decision to remove something
 * and the removal actually taking effect are different facts, and an obligation
 * measured against the wrong one would be measured against a promise.
 */
export const takedownStates = [
  'received',
  'acknowledged',
  'decided',
  'completed',
  'dismissed',
] as const;
export type TakedownState = (typeof takedownStates)[number];

/** Claims still owed work. */
export const openTakedownStates = ['received', 'acknowledged'] as const;

/**
 * How fast a claim is owed attention.
 *
 * Derived from what is alleged rather than chosen by the claimant, so nobody
 * can mark their own complaint urgent. It affects **only the deadline** and
 * never the decision: a reviewer's priority stays their own judgement, and no
 * claim decides anything by existing.
 */
export const takedownUrgencies = ['standard', 'urgent'] as const;
export type TakedownUrgency = (typeof takedownUrgencies)[number];

const urgencyByTakedownReason: Readonly<
  Record<TakedownReasonCode, TakedownUrgency>
> = {
  consent_withdrawn: 'urgent',
  illegal_content: 'urgent',
  non_consensual_content: 'urgent',
  other: 'standard',
};

export function urgencyFor(reasonCode: TakedownReasonCode): TakedownUrgency {
  return urgencyByTakedownReason[reasonCode];
}

/**
 * How long a worker holds a claim while acting on its deadline.
 *
 * A lease rather than an assignment, for the reason a case claim is one: a
 * worker that dies releases what it held, and the deadline survives because the
 * deadline is a row and not a timer.
 */
export const takedownLeaseMilliseconds = 15 * 60 * 1000;

/** Largest page of claims one read returns. */
export const maximumTakedownPageSize = 50;

/**
 * How many claims one account may file in the rate window.
 *
 * A cap on volume, not on truth, exactly as the report bound is: reaching it
 * refuses further submissions and never removes or alters a claim already made.
 * It exists because urgency is derived from what is alleged, so a flood of
 * urgent claims is the shape an abuser would reach for.
 */
export const takedownRateLimitCount = 10;
export const takedownRateWindowMilliseconds = 60 * 60 * 1000;
