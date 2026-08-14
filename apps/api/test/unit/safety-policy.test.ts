import { describe, expect, it } from 'bun:test';
import { reportReasonSchema } from '@velora/validation';

import {
  enforcementPolicyVersion,
  enforcementReasonCodes,
  enforcementScopes,
  openReportStates,
  productionBlockers,
  reportPolicyVersion,
  reportReasonCodes,
  reportStates,
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

  it('limits enforcement to what V1 can actually justify', () => {
    // Bans, timed suspensions, appeals, and per-surface scoping all depend on
    // the risk taxonomy and the appeal process, neither of which is decided.
    expect([...enforcementScopes]).toEqual([
      'account_restriction',
      'conversation_closure',
    ]);
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
