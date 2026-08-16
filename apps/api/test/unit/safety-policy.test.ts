import { describe, expect, it } from 'bun:test';
import {
  enforcementDispositionSchema,
  enforcementScopeSchema,
  reportReasonSchema,
  reportTargetTypeSchema,
} from '@velora/validation';

import {
  blockingScopesFor,
  caseClaimLeaseMilliseconds,
  casePolicyVersion,
  casePriorities,
  caseQueues,
  caseStates,
  consentDenialReasons,
  consentDispositions,
  consentPolicyVersion,
  consentScopeFor,
  consentScopes,
  contentCapabilities,
  contentClassifications,
  contentDenialReasons,
  contentSafetyPolicyVersion,
  decisionActions,
  decisionPolicyVersion,
  decisionReasonCodes,
  decisionSubjectStates,
  denialReasonFor,
  depictedPersonEvidenceStates,
  depictionDeclarations,
  distributionSurfaces,
  eligibilityPolicyVersion,
  enforcingDecisionActions,
  matureContentClassifications,
  matureIneligibleSurfaces,
  matureViewerAssurance,
  maximumConsentRecordsPerContent,
  maximumDepictedPersonPageSize,
  verifierReferencePattern,
  evidenceKinds,
  evidencePolicyVersion,
  evidenceStateLabelPattern,
  enforcementDispositions,
  enforcementPolicyVersion,
  enforcementPrecedence,
  enforcementReasonCodes,
  enforcementObjectTypes,
  enforcementScopes,
  enforcementSubjectKinds,
  liftableEnforcementScopes,
  objectScopedEnforcements,
  openReportStates,
  productionBlockers,
  referencedEvidenceKinds,
  reportPolicyVersion,
  reportReasonCodes,
  resolvedCaseStates,
  resolvingDecisionActions,
  openCaseStates,
  queueFor,
  reportSourceSurfaces,
  reportStates,
  reportTargetTypes,
  safetyCapabilities,
  safetyDenialReasons,
  scopesForDecision,
  snapshotEvidenceKinds,
  subjectKindForCapability,
  subjectKindOf,
  unavailableEvidenceKinds,
  unpublishedConsentCopyVersion,
} from '../../src/safety/policy.js';

/**
 * The two safety vocabularies are provisional and deliberately different from
 * each other. These assertions exist so neither drifts into the other, and so
 * nothing quietly starts describing itself as the approved risk taxonomy.
 */
describe('safety vocabularies stay provisional and separate', () => {
  it('versions both vocabularies as provisional', () => {
    expect(reportPolicyVersion).toBe('v1-provisional');
    expect(enforcementPolicyVersion).toBe('v1-provisional');
  });

  it('keeps the reporter vocabulary identical to the published contract', () => {
    expect(reportReasonSchema.options).toEqual([...reportReasonCodes]);
  });

  it('keeps the enforcement vocabulary identical to the published contract', () => {
    // The wire field used to be a free string, so an operator surface rendered
    // whatever the server sent and a typo would have shipped as a scope.
    expect(enforcementScopeSchema.options).toEqual([...enforcementScopes]);
    expect(enforcementDispositionSchema.options).toEqual([
      ...enforcementDispositions,
    ]);
  });

  it('does not let a reporter category be an enforcement finding', () => {
    // A report is an allegation. If the two vocabularies were the same set, a
    // reporter's category could be read as a review's conclusion, which is
    // precisely what the report-to-enforcement flow forbids.
    expect([...reportReasonCodes]).not.toEqual([...enforcementReasonCodes]);
    expect([...reportReasonCodes]).toContain('underage_concern');
    expect([...enforcementReasonCodes]).toContain('underage_risk');
    expect([...enforcementReasonCodes]).not.toContain('other');
  });

  it('reaches every report state and no unreachable one', () => {
    // No automation decides a report in V1, so there is no auto-resolved state
    // for somebody to later make reachable by accident.
    expect([...reportStates]).toEqual([
      'received',
      'under_review',
      'actioned',
      'dismissed',
    ]);
    expect([...openReportStates]).toEqual(['received', 'under_review']);
  });

  it('limits enforcement to what the product can actually act on', () => {
    // Every scope corresponds to a state some domain owns and an operation that
    // exists. Bans, appeal states, and per-surface scoping are still absent,
    // because they depend on the risk taxonomy and the appeal process and
    // neither is decided.
    expect([...enforcementScopes]).toEqual([
      'account_restriction',
      'conversation_closure',
      'creator_suspension',
      'creator_object_removal',
      'club_membership_revocation',
    ]);
  });

  it('says whether a record imposes or lifts, rather than encoding it in scope', () => {
    // `creator_reinstatement` used to be a scope, which made direction a
    // property of some scopes and not others: `account_restriction` was written
    // both by a restriction and by the review that undid one, so two rows with
    // the same scope meant opposite things.
    expect([...enforcementDispositions]).toEqual(['restrict', 'lift']);
    expect([...enforcementScopes]).not.toContain('creator_reinstatement');
  });

  it('only claims to reverse what some domain publishes a way to reverse', () => {
    // MESSAGING publishes no contract that reopens a conversation, and
    // republishing what an operator took down is the creator's decision to take
    // again. A lift the platform cannot apply would be a record claiming an
    // effect that never happened.
    expect([...liftableEnforcementScopes]).toEqual([
      'account_restriction',
      'creator_suspension',
    ]);
    for (const scope of liftableEnforcementScopes) {
      expect(enforcementScopes, scope).toContain(scope);
    }
  });

  it('gives every scope exactly one identifier space and one precedence rank', () => {
    // One column carries subjects from two domains. A scope added without
    // deciding which space it belongs to would be a subject nobody could look
    // up, and one missing from precedence would make the reason a subject is
    // given depend on which row a query returned first.
    for (const scope of enforcementScopes) {
      expect([...enforcementSubjectKinds], scope).toContain(
        subjectKindOf(scope),
      );
      expect(enforcementPrecedence, scope).toContain(scope);
    }
    expect(enforcementPrecedence).toHaveLength(enforcementScopes.length);
    // Global outranks capability outranks anything scoped to one object.
    expect(enforcementPrecedence[0]).toBe('account_restriction');
    expect(enforcementPrecedence[1]).toBe('creator_suspension');
  });

  it('maps every capability onto scopes that exist, in precedence order', () => {
    for (const capability of safetyCapabilities) {
      const scopes = blockingScopesFor(capability);
      expect(scopes.length, capability).toBeGreaterThan(0);
      for (const scope of scopes) {
        expect(enforcementScopes, capability).toContain(scope);
        // A capability may only be denied by a scope whose subject lives in the
        // same identifier space, or the answer would be about somebody else.
        expect(subjectKindOf(scope), capability).toBe(
          subjectKindForCapability(capability),
        );
      }
      expect([...scopes], capability).toEqual(
        enforcementPrecedence.filter((scope) => scopes.includes(scope)),
      );
    }
  });

  it('keeps what a subject may be told separate from what a review found', () => {
    // A subject is entitled to the category and scope of what was done to them.
    // They are not entitled to the finding, the report, or anything that would
    // identify a reporter, so the disclosable vocabulary is its own set.
    for (const scope of enforcementScopes) {
      expect([...safetyDenialReasons], scope).toContain(denialReasonFor(scope));
    }
    for (const reason of safetyDenialReasons) {
      expect([...enforcementReasonCodes], reason).not.toContain(reason);
      expect([...reportReasonCodes], reason).not.toContain(reason);
    }
  });

  it('versions the composition rule separately from the enforcement vocabulary', () => {
    // They change for different reasons: one when what an enforcement may
    // record changes, the other when precedence or the capability map does.
    expect(eligibilityPolicyVersion).toBe('v1-provisional');
  });

  it('keeps the enforcement target vocabulary closed', () => {
    // A creator-scoped enforcement names an object from a fixed set, validated
    // by the domain that owns it. A free polymorphic reference would be a
    // record pointing at something nobody checked.
    expect([...enforcementObjectTypes]).toEqual([
      'creator_profile',
      'creator_content',
      'club',
      'club_membership',
    ]);
    expect([...objectScopedEnforcements]).toEqual([
      'creator_object_removal',
      'club_membership_revocation',
    ]);
    for (const scope of objectScopedEnforcements) {
      expect(enforcementScopes, scope).toContain(scope);
    }
  });

  it('opens a case in a state something can move it out of', () => {
    // `appealed` arrives with the phase that can reach it. Declaring it now
    // would put a state in the schema no code could move a row out of, which is
    // how a value nothing is entitled to write ends up being set for
    // convenience later.
    expect([...caseStates]).toEqual([
      'new',
      'triaged',
      'investigating',
      'decided',
      'closed',
    ]);
    expect([...openCaseStates]).toEqual(['new', 'triaged', 'investigating']);
    for (const state of openCaseStates) {
      expect([...caseStates], state).toContain(state);
    }
  });

  it('keeps a decided case distinct from one that was merely dropped', () => {
    // Both are out of the queue and they are not the same fact: one was judged
    // and one was abandoned. A schema that could not tell them apart would make
    // "was this reviewed" a question nothing could answer.
    expect([...resolvedCaseStates]).toEqual(['decided', 'closed']);
    for (const state of resolvedCaseStates) {
      expect([...caseStates], state).toContain(state);
      expect([...openCaseStates], state).not.toContain(state);
    }
    expect(resolvedCaseStates.length + openCaseStates.length).toBe(
      caseStates.length,
    );
  });

  it('starts every case untriaged, because nobody has looked yet', () => {
    // A default of `normal` would be a claim about urgency that no reviewer
    // made. `untriaged` is a real answer rather than a missing one.
    expect(casePriorities[0]).toBe('untriaged');
    expect([...casePriorities]).toEqual([
      'untriaged',
      'low',
      'normal',
      'high',
      'urgent',
    ]);
    expect(casePolicyVersion).toBe('v1-provisional');
    expect(caseClaimLeaseMilliseconds).toBeGreaterThan(0);
  });

  it('routes a case by what it is about rather than what a reporter said', () => {
    // Routing keyed on the reporter's chosen category would let a reporter
    // steer which queue somebody's case lands in.
    for (const targetType of reportTargetTypes) {
      expect([...caseQueues], targetType).toContain(queueFor(targetType));
    }
    expect(queueFor('consumer_account')).toBe('consumer_conduct');
    expect(queueFor('conversation')).toBe('consumer_conduct');
    expect(queueFor('creator_profile')).toBe('creator_identity');
    expect(queueFor('creator_content')).toBe('creator_content');
    expect(queueFor('club')).toBe('creator_content');
  });

  it('keeps the report target and surface vocabularies closed and published', () => {
    expect(reportTargetTypeSchema.options).toEqual([...reportTargetTypes]);
    // The surface is derived from the credential's audience, so the vocabulary
    // is the set of audiences that may file a report and nothing wider.
    expect([...reportSourceSurfaces]).toEqual([
      'consumer_web',
      'consumer_mobile',
      'creator_studio',
    ]);
    expect([...reportSourceSurfaces]).not.toContain('platform_admin');
  });

  it('versions the evidence and decision rules separately', () => {
    // They move for their own reasons: one when what may be recorded as
    // evidence changes, the other when what a reviewer may decide changes.
    expect(evidencePolicyVersion).toBe('v1-provisional');
    expect(decisionPolicyVersion).toBe('v1-provisional');
  });

  it('gives every evidence kind exactly one shape', () => {
    // Each kind is a reference, a bounded snapshot, prose, or an external
    // handle — and never two of those at once, because a kind that could be
    // either is a column nobody can constrain.
    for (const kind of evidenceKinds) {
      const shapes = [
        referencedEvidenceKinds.includes(kind),
        snapshotEvidenceKinds.includes(kind),
        kind === 'operator_note',
        kind === 'external_verification_reference',
      ].filter(Boolean).length;
      // `creator_profile_state` is deliberately both a reference and a
      // snapshot: it names whose page it is and what that page was.
      expect(shapes, kind).toBeGreaterThan(0);
    }
    expect([...snapshotEvidenceKinds]).toEqual([
      'creator_profile_state',
      'system_fact',
    ]);
    for (const kind of [...referencedEvidenceKinds, ...snapshotEvidenceKinds]) {
      expect([...evidenceKinds], kind).toContain(kind);
    }
  });

  it('refuses the evidence no approved authority can produce', () => {
    // An external verification reference is refused by name: Velora has no
    // approved verifier of that kind at all. Depicted-person consent is
    // deliberately absent from this list — it fails closed through the data,
    // because a consent record can only exist if an approved verifier captured
    // it under approved wording, and a gate enforced by what can exist is
    // stronger than one enforced by a check somebody could forget.
    expect([...unavailableEvidenceKinds]).toEqual([
      'external_verification_reference',
    ]);
    for (const kind of unavailableEvidenceKinds) {
      expect([...evidenceKinds], kind).toContain(kind);
    }
  });

  it('shapes a snapshot label so it cannot hold a sentence', () => {
    const label = new RegExp(evidenceStateLabelPattern, 'u');
    expect(label.test('published')).toBe(true);
    expect(label.test('profile_withdrawn')).toBe(true);
    // No spaces, no punctuation, no capitals: a field a narrative cannot reach.
    expect(label.test('the reporter said they were sixteen')).toBe(false);
    expect(label.test('Published')).toBe(false);
    expect(label.test('a'.repeat(65))).toBe(false);
    const external = new RegExp(verifierReferencePattern, 'u');
    expect(external.test('verifier:outcome-0001')).toBe(true);
    expect(external.test('passport number 123 456')).toBe(false);
  });

  it('gives every decision action scopes that exist, or none at all', () => {
    for (const action of decisionActions) {
      const scopes = scopesForDecision(action);
      for (const scope of scopes) {
        expect([...enforcementScopes], action).toContain(scope);
      }
      // An action that produces an enforcement names a scope; one that does not
      // may name none, so the two sets partition the vocabulary.
      expect(scopes.length > 0, action).toBe(
        enforcingDecisionActions.includes(action),
      );
    }
    expect(scopesForDecision('unpublish')).toEqual(['creator_object_removal']);
    expect(scopesForDecision('revoke_restriction')).toEqual([
      ...liftableEnforcementScopes,
    ]);
  });

  it('settles a case with anything except handing it on', () => {
    // Escalation is the one action that is not a settlement, which is what lets
    // a case be escalated many times and decided once.
    expect([...decisionActions].sort()).toEqual(
      [...resolvingDecisionActions, 'escalate' as const].sort(),
    );
    expect([...resolvingDecisionActions]).not.toContain('escalate');
    for (const action of enforcingDecisionActions) {
      expect([...resolvingDecisionActions], action).toContain(action);
    }
  });

  it('lets a review that found nothing say so, and never enforce for it', () => {
    // The findings are a subset: a decision may record that nothing was made
    // out, and a restriction imposed for `no_violation_found` would be a record
    // that contradicts itself.
    for (const reason of enforcementReasonCodes) {
      expect([...decisionReasonCodes], reason).toContain(reason);
    }
    expect([...decisionReasonCodes]).toContain('no_violation_found');
    expect([...enforcementReasonCodes]).not.toContain('no_violation_found');
  });

  it('describes only the standing this domain owns', () => {
    // Prior and resulting state are about whether a live restriction stood, not
    // about another domain's column: an account's status is USERS' truth and
    // SAFETY may not read it.
    expect([...decisionSubjectStates]).toEqual(['unrestricted', 'restricted']);
  });

  it('keeps a creator assertion and a verification as separate answers', () => {
    // The same separation `self_declared` and `verified_adult` have, for the
    // same reason: 18 U.S.C. 2257 requires identity and age to be ascertained
    // by examining an identification document, so a creator's word cannot
    // satisfy it and must never be recorded as though it had.
    expect([...depictedPersonEvidenceStates]).toEqual(['asserted', 'verified']);
    expect([...depictionDeclarations]).toEqual([
      'no_depicted_persons',
      'depicted_persons',
    ]);
    expect(consentPolicyVersion).toBe('v1-provisional');
  });

  it('scopes consent rather than treating it as a flag', () => {
    // "This person once consented to something" is not permission for anything
    // else, so each scope is granted and withdrawn on its own.
    expect([...consentScopes]).toEqual([
      'publication',
      'distribution',
      'commercial_use',
    ]);
    expect([...consentDispositions]).toEqual(['grant', 'revoke']);
    // Nothing is approved, so the wording version is the honest placeholder the
    // consumer and creator policy documents already use.
    expect(unpublishedConsentCopyVersion).toBe('0-unpublished');
  });

  it('says why a gate is closed without saying who is depicted', () => {
    // Every reason is about the state of the evidence. There is no value here
    // that could carry a name, and none that overlaps the enforcement findings
    // or the reporter categories.
    for (const reason of consentDenialReasons) {
      expect([...enforcementReasonCodes], reason).not.toContain(reason);
      expect([...reportReasonCodes], reason).not.toContain(reason);
    }
    expect([...consentDenialReasons]).toContain('undeclared');
    expect([...consentDenialReasons]).toContain('assertion_only');
    expect([...consentDenialReasons]).toContain('authority_unavailable');
  });

  it('bounds what one item may carry so the gate query stays complete', () => {
    // A read that stopped at a page boundary could report an item as consented
    // while somebody's withdrawal sat on the next page, so both bounds are
    // enforced on the way in.
    expect(maximumDepictedPersonPageSize).toBeGreaterThan(0);
    expect(maximumConsentRecordsPerContent).toBeGreaterThan(
      maximumDepictedPersonPageSize,
    );
  });

  it('keeps the delivery surfaces separate from where a report was filed', () => {
    // The report surface is derived from a credential's audience, and the AUTH
    // audience cannot tell iOS from Android. That distinction is exactly what
    // decides mature eligibility, so a content decision may never be derived
    // from where a report came from — and the two sets must not converge.
    expect([...distributionSurfaces]).toEqual([
      'web',
      'mobile_ios',
      'mobile_android',
      'creator_studio',
      'platform_admin',
    ]);
    // `creator_studio` is genuinely the same surface in both and is named the
    // same. The consumer surfaces are not: one vocabulary splits the two mobile
    // stores and the other cannot, which is the whole distinction.
    expect([...reportSourceSurfaces]).toContain('consumer_mobile');
    expect([...distributionSurfaces]).not.toContain('consumer_mobile');
    expect([...distributionSurfaces]).toContain('mobile_ios');
    expect([...reportSourceSurfaces]).not.toContain('mobile_ios');
    expect(contentSafetyPolicyVersion).toBe('v1-provisional');
  });

  it('holds the mobile surfaces ineligible as a property of the surface', () => {
    // Both stores prohibit the class outright with no published approval path,
    // which is a different answer from the payment providers' written-approval
    // route. It is therefore a fact about the surface rather than a value.
    expect([...matureIneligibleSurfaces]).toEqual([
      'mobile_ios',
      'mobile_android',
    ]);
    for (const surface of matureIneligibleSurfaces) {
      expect([...distributionSurfaces], surface).toContain(surface);
    }
    expect([...matureIneligibleSurfaces]).not.toContain('web');
  });

  it('distinguishes the classes that carry different evidence duties', () => {
    // 18 U.S.C. 2257 attaches to actual sexually explicit conduct and not to
    // simulated conduct, so one `mature` boolean would either over-collect
    // evidence for one class or under-collect it for the other.
    expect([...contentClassifications]).toEqual([
      'general',
      'mature_simulated',
      'mature_actual',
    ]);
    expect([...matureContentClassifications]).not.toContain('general');
    for (const classification of matureContentClassifications) {
      expect([...contentClassifications], classification).toContain(
        classification,
      );
    }
  });

  it('gives every content capability a consent scope and a safety capability', () => {
    for (const capability of contentCapabilities) {
      expect([...consentScopes], capability).toContain(
        consentScopeFor(capability),
      );
    }
    // Delivering needs distribution consent and monetising needs commercial
    // consent, because permission to publish is neither.
    expect(consentScopeFor('publish')).toBe('publication');
    expect(consentScopeFor('deliver')).toBe('distribution');
    expect(consentScopeFor('monetise')).toBe('commercial_use');
  });

  it('requires verified adult assurance of a mature viewer and nothing weaker', () => {
    // Ofcom names self-declaration, and payment without an age check, as not
    // highly effective. Neither may stand in for the class this requires.
    expect(matureViewerAssurance).toBe('verified_adult');
    expect(matureViewerAssurance).not.toBe('self_declared');
  });

  it('names which gate closed without naming what a review found', () => {
    // Disclosable to the creator whose item it is: it says which gate, never
    // the reasoning, and never anything about a depicted person or a reporter.
    expect(contentDenialReasons[0]).toBe('mature_content_disabled');
    for (const reason of contentDenialReasons) {
      expect([...enforcementReasonCodes], reason).not.toContain(reason);
      expect([...reportReasonCodes], reason).not.toContain(reason);
    }
  });

  it('names what blocks production rather than implying nothing does', () => {
    expect([...productionBlockers]).toEqual([
      'risk-taxonomy-undecided',
      'emergency-action-policy-undecided',
      'appeal-process-and-sla-undecided',
      'evidence-retention-undecided',
      'admin-sign-in-has-no-approved-implementation',
    ]);
  });
});
