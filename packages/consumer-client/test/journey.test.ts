import { describe, expect, it } from 'vitest';

import type {
  Availability,
  ConsumerAccount,
  ConsumerProfile,
  OnboardingState,
} from '../src/contract.js';
import {
  accountStanding,
  availabilityView,
  failureMessage,
  isRetryable,
  journeyStage,
  profileMediaState,
} from '../src/journey.js';
import type { ApiResult } from '../src/result.js';

/**
 * The rules the surface renders, tested without a browser.
 *
 * Every one of them is a reading of a server answer rather than a decision, so
 * they can be checked exhaustively here and trusted everywhere they are used.
 */

const account = (status: string): ConsumerAccount =>
  ({
    createdAt: '2026-08-14T12:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
    status,
  }) as ConsumerAccount;

const onboarding = (step: string): OnboardingState =>
  ({
    account: account('active'),
    adultAssurance: 'self_declared',
    adultAssuranceRefused: false,
    outstandingPolicies: [],
    outstandingProfile: [],
    step,
  }) as OnboardingState;

const profile = (media: { state: string }[]): ConsumerProfile =>
  ({
    complete: false,
    discoverable: false,
    languages: [],
    media: media.map((entry, index) => ({
      id: `0000000${String(index)}-0000-4000-8000-000000000000`,
      position: index,
      state: entry.state,
      uploadExpiresAt: '2026-08-14T13:00:00.000Z',
    })),
    outstandingRequirements: [],
  }) as ConsumerProfile;

describe('the admission ladder', () => {
  it('follows the step the server publishes rather than re-deriving one', () => {
    expect(journeyStage(onboarding('adult_declaration'))).toBe(
      'adult_declaration',
    );
    expect(journeyStage(onboarding('policy_acknowledgement'))).toBe(
      'policy_acknowledgement',
    );
    expect(journeyStage(onboarding('profile'))).toBe('profile');
    expect(journeyStage(onboarding('completed'))).toBe('ready');
  });

  it('treats an unknown future step as admitted rather than as a dead end', () => {
    // A server that grows a step this client has not heard of must not strand
    // somebody on a screen with no control on it.
    expect(journeyStage(onboarding('something_new'))).toBe('ready');
  });

  it('asks for an account when there is none', () => {
    expect(journeyStage(undefined)).toBe('account_required');
  });
});

describe('profile media', () => {
  it('reports the best state any image has reached', () => {
    expect(profileMediaState(undefined)).toBe('none');
    expect(profileMediaState(profile([]))).toBe('none');
    expect(profileMediaState(profile([{ state: 'pending_upload' }]))).toBe(
      'pending',
    );
    expect(profileMediaState(profile([{ state: 'rejected' }]))).toBe(
      'rejected',
    );
    expect(profileMediaState(profile([{ state: 'ready' }]))).toBe('ready');
    // The platform now genuinely does two things after the bytes arrive, and
    // they take different amounts of time. Reporting one "pending" throughout
    // would tell somebody nothing for the whole period anything is happening.
    expect(profileMediaState(profile([{ state: 'checking' }]))).toBe(
      'checking',
    );
    expect(profileMediaState(profile([{ state: 'preparing' }]))).toBe(
      'preparing',
    );
    // One ready image is enough to be seen, whatever else is in flight.
    expect(
      profileMediaState(profile([{ state: 'rejected' }, { state: 'ready' }])),
    ).toBe('ready');
    // A refusal outranks work in progress: it is the only state that needs the
    // person to do something.
    expect(
      profileMediaState(
        profile([{ state: 'checking' }, { state: 'rejected' }]),
      ),
    ).toBe('rejected');
    // And progress outranks a window nobody has filled yet.
    expect(
      profileMediaState(
        profile([{ state: 'pending_upload' }, { state: 'preparing' }]),
      ),
    ).toBe('preparing');
  });
});

describe('availability', () => {
  const window = (
    state: 'available' | 'unavailable',
    effectiveState: 'available' | 'unavailable',
  ): Availability => ({
    effectiveState,
    state,
    updatedAt: '2026-08-14T12:00:00.000Z',
  });

  it('separates never chosen from chosen and run out', () => {
    expect(availabilityView(undefined)).toBe('unavailable');
    expect(availabilityView(window('unavailable', 'unavailable'))).toBe(
      'unavailable',
    );
    expect(availabilityView(window('available', 'available'))).toBe(
      'available',
    );
    // The server already acts on this as unavailable. Showing only that would
    // hide from somebody that they had chosen otherwise and simply ran out.
    expect(availabilityView(window('available', 'unavailable'))).toBe(
      'expired',
    );
  });
});

describe('account standing', () => {
  it('reports restriction to the account it describes, and nothing more', () => {
    expect(accountStanding(account('active'))).toBe('active');
    expect(accountStanding(account('pending_profile'))).toBe('pending_profile');
    expect(accountStanding(account('restricted'))).toBe('restricted');
    for (const closed of ['deletion_pending', 'deactivated', 'erased']) {
      expect(accountStanding(account(closed))).toBe('closed');
    }
  });
});

describe('what a failure is allowed to say', () => {
  const refused = (code: string): ApiResult<never> => ({
    code,
    kind: 'refused',
    status: 409,
  });

  it('never turns a refusal into a claim about another person', () => {
    // Every one of these can be caused by a block, and none of them says so.
    for (const code of ['ACTION_NOT_PERMITTED', 'ACCOUNT_NOT_ELIGIBLE']) {
      const message = failureMessage(refused(code)) ?? '';
      expect(message).not.toMatch(/block|report|restrict/iu);
    }
    const missing = failureMessage({ kind: 'not-found' }) ?? '';
    expect(missing).not.toMatch(/block|deleted|banned/iu);
  });

  it('does not show a code it does not recognise', () => {
    const message = failureMessage(refused('SOME_FUTURE_CODE'));
    expect(message).toBe('That is not possible right now.');
    expect(message).not.toContain('SOME_FUTURE_CODE');
  });

  it('says nothing at all about a call that succeeded', () => {
    expect(failureMessage({ kind: 'ok', value: 1 })).toBeUndefined();
  });

  it('offers a retry only for a condition, never for a decision', () => {
    expect(isRetryable({ kind: 'unavailable' })).toBe(true);
    expect(isRetryable(refused('ACTION_NOT_PERMITTED'))).toBe(false);
    expect(isRetryable({ kind: 'not-found' })).toBe(false);
    // Repeating a rejected send would hammer a decision already made.
    expect(isRetryable({ kind: 'unauthenticated' })).toBe(false);
  });
});
