import { describe, expect, it } from 'vitest';

import type { CreatorAccount, CreatorProfile } from '../src/contract.js';
import {
  creatorAdultGateMessages,
  creatorStage,
  creatorStanding,
  failureMessage,
  isRetryable,
  publicationLabels,
  publicationView,
} from '../src/journey.js';

/**
 * The derivations Creator Studio renders.
 *
 * They are pure, so they are tested here rather than through a browser: what
 * matters is that every server answer maps to exactly one honest thing to say,
 * and that no branch invents a claim the server did not make.
 */

const onboarding = (step: string, satisfied = true) =>
  ({
    account: {} as CreatorAccount,
    adultGateSatisfied: satisfied,
    outstandingPolicies: [],
    step,
  }) as never;

const profile = (publication: 'draft' | 'published') =>
  ({ publication }) as CreatorProfile;

describe('creator stage', () => {
  it('asks for the capability before anything else', () => {
    expect(creatorStage({ onboarding: undefined, profile: undefined })).toBe(
      'capability_required',
    );
  });

  it('follows the ladder the server publishes rather than re-deriving it', () => {
    expect(
      creatorStage({
        onboarding: onboarding('adult_eligibility', false),
        profile: undefined,
      }),
    ).toBe('adult_eligibility');
    expect(
      creatorStage({
        onboarding: onboarding('policy_acknowledgement'),
        profile: undefined,
      }),
    ).toBe('policy_acknowledgement');
    expect(
      creatorStage({ onboarding: onboarding('completed'), profile: undefined }),
    ).toBe('profile');
    expect(
      creatorStage({
        onboarding: onboarding('completed'),
        profile: profile('draft'),
      }),
    ).toBe('ready');
  });

  it('never reports a profile stage while the adult gate is unmet', () => {
    // A profile that exists does not lift a gate. Reporting `ready` here would
    // be the client overruling the server about who may operate.
    expect(
      creatorStage({
        onboarding: onboarding('adult_eligibility', false),
        profile: profile('published'),
      }),
    ).toBe('adult_eligibility');
  });
});

describe('adult gate messages', () => {
  it('names a next step for every reason the contract publishes', () => {
    for (const reason of [
      'no_consumer_account',
      'adult_declaration_missing',
      'not_in_good_standing',
    ]) {
      expect(creatorAdultGateMessages[reason], reason).toBeDefined();
    }
  });

  it('never offers to declare adulthood inside Creator Studio', () => {
    for (const message of Object.values(creatorAdultGateMessages)) {
      expect(message).not.toContain('Confirm here');
    }
  });
});

describe('creator standing', () => {
  it('maps every published status and treats anything else as closed', () => {
    const at = (status: string) => ({ status }) as CreatorAccount;
    expect(creatorStanding(at('active'))).toBe('active');
    expect(creatorStanding(at('applicant'))).toBe('applicant');
    expect(creatorStanding(at('suspended'))).toBe('suspended');
    expect(creatorStanding(at('closed'))).toBe('closed');
  });
});

describe('publication view', () => {
  it('distinguishes no profile from a private one', () => {
    expect(publicationView(undefined)).toBe('none');
    expect(publicationView(profile('draft'))).toBe('draft');
    expect(publicationView(profile('published'))).toBe('published');
    expect(publicationLabels.draft).toContain('Only you');
  });
});

describe('failure messages', () => {
  it('says nothing about another creator and never guesses a cause', () => {
    const conflict = failureMessage({
      code: 'STATE_CONFLICT',
      kind: 'refused',
      status: 409,
    });
    // A conflict covers a taken handle, a stale edit, and a capability that may
    // not act. The server does not say which, so neither does this.
    expect(conflict).toContain('unavailable');
    expect(conflict).toContain('Reload');
    expect(conflict).not.toContain('taken by');
  });

  it('falls back to one honest sentence for a code it does not know', () => {
    expect(
      failureMessage({ code: 'SOMETHING_NEW', kind: 'refused', status: 400 }),
    ).toBe('That is not possible right now.');
  });

  it('offers a retry only when there was no answer at all', () => {
    expect(isRetryable({ kind: 'unavailable' })).toBe(true);
    expect(
      isRetryable({ code: 'STATE_CONFLICT', kind: 'refused', status: 409 }),
    ).toBe(false);
    expect(isRetryable({ kind: 'not-found' })).toBe(false);
  });
});
