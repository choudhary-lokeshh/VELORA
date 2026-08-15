import { describe, expect, it } from 'bun:test';
import {
  enforcementDispositionSchema,
  enforcementScopeSchema,
  reportReasonSchema,
} from '@velora/validation';

import {
  blockingScopesFor,
  denialReasonFor,
  eligibilityPolicyVersion,
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
  reportPolicyVersion,
  reportReasonCodes,
  reportStates,
  safetyCapabilities,
  safetyDenialReasons,
  subjectKindForCapability,
  subjectKindOf,
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
