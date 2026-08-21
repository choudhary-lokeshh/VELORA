import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsumerShell } from '../src/product/shell';
import {
  admittedState,
  createApiDouble,
  otherPersonId,
  type ApiDouble,
  type ApiDoubleState,
} from './support/api-double';

/**
 * The Consumer Web calling surface, driven through the generated client against
 * a stand-in API that answers the real contract.
 *
 * What is worth proving here is not that buttons render. It is that this
 * surface cannot express a call the server would refuse: that there is no way
 * to name a person, that a role's controls belong to that role, that a finished
 * call stays finished, and that a join credential is asked for again rather
 * than kept. Each of those is a property of the code rather than of a handler
 * somebody remembered to guard.
 */

const baseUrl = 'http://api.test';

afterEach(cleanup);

const introductionId = '55555555-5555-4555-8555-555555555555';

function withMutualIntroduction(): ApiDoubleState {
  return {
    ...admittedState(),
    introductions: [
      {
        counterpart: {
          displayName: 'Robin',
          id: otherPersonId,
          media: [],
          sharedLanguages: ['es'],
        },
        createdAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 0)).toISOString(),
        id: introductionId,
        mutualAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 0)).toISOString(),
        role: 'initiator',
        state: 'mutual',
      },
    ],
  };
}

async function click(testId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testId));
}

const callId = '66666666-6666-4666-8666-666666666666';
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 7, 14, 12, 0, seconds)).toISOString();

/**
 * A state in which the pair already has a call.
 *
 * This is how somebody meets a call they did not place. The server returns the
 * pair's live call rather than opening a second one, so pressing "Voice call"
 * while the other person is ringing hands back *their* call, with this person
 * correctly on the receiving side of it. That is the server's own
 * one-live-call-per-pair rule doing the work, not a contrivance of the test.
 */
function withLiveCall(
  overrides: Partial<NonNullable<ApiDoubleState['call']>>,
): ApiDoubleState {
  return {
    ...withMutualIntroduction(),
    call: {
      counterpart: { displayName: 'Robin', id: otherPersonId },
      createdAt: at(0),
      id: callId,
      invitationExpiresAt: at(45),
      medium: 'voice',
      role: 'recipient',
      state: 'invited',
      ...overrides,
    },
  };
}

async function openCalls(
  state: ApiDoubleState = withMutualIntroduction(),
): Promise<ApiDouble> {
  const double = createApiDouble(state);
  render(
    <ConsumerShell apiBaseUrl={baseUrl} fetchImplementation={double.fetch} />,
  );
  await waitFor(() => {
    expect(screen.getByTestId('auth-status').textContent).toContain(
      'Signed in',
    );
  });
  await click('nav-calls');
  return double;
}

describe('a call is placed against a relationship, never against a person', () => {
  it('offers a call only from an introduction that is already mutual', async () => {
    await openCalls();
    expect(
      (await screen.findByTestId(`call-offer-${introductionId}`)).textContent,
    ).toContain('Robin');
    // No input, no identifier field, no handle lookup. There is nothing on this
    // screen that takes a person as a value, because the server derives the
    // other party from the relationship and would refuse a request naming one.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sends the introduction and the medium, and nothing else', async () => {
    const double = await openCalls();
    await click(`call-video-${introductionId}`);
    await screen.findByTestId('call-current');

    const request = double.calls.find(
      (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'POST',
    );
    expect(request?.body).toEqual({ introductionId, medium: 'video' });
  });

  it('keeps voice and video as separate choices', async () => {
    const double = await openCalls();
    await click(`call-voice-${introductionId}`);
    await waitFor(() => {
      expect(screen.getByTestId('call-medium').textContent).toBe('Voice');
    });
    // Agreeing to be heard is not agreeing to be seen, so the medium is chosen
    // per call rather than carried forward from the last one.
    const request = double.calls.find(
      (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'POST',
    );
    expect(request?.body).toEqual({ introductionId, medium: 'voice' });
  });

  it('says plainly when there is nobody to call yet', async () => {
    await openCalls(admittedState());
    expect((await screen.findByTestId('calls-empty')).textContent).toContain(
      'You can call somebody once you both say you are interested',
    );
  });
});

describe('controls belong to a role, not to a screen', () => {
  it('offers the caller a withdrawal and no answer', async () => {
    await openCalls();
    await click(`call-voice-${introductionId}`);
    await screen.findByTestId('call-cancel');

    // Answering one's own outgoing call is not a thing the server permits, so
    // the control does not exist rather than existing and failing.
    expect(screen.queryByTestId('call-accept')).toBeNull();
    expect(screen.queryByTestId('call-reject')).toBeNull();
  });

  it('offers the recipient an answer and a decline', async () => {
    const double = await openCalls(withLiveCall({}));
    // A ringing call this person did not place. Reaching for the pair surfaces
    // it rather than opening a second call, which is what the server does.
    await click(`call-voice-${introductionId}`);

    await screen.findByTestId('call-accept');
    expect(screen.queryByTestId('call-cancel')).toBeNull();
    await click('call-accept');
    await waitFor(() => {
      expect(screen.getByTestId('call-state').textContent).toBe('Answered');
    });
    expect(
      double.calls.some((entry) => entry.path === '/v1/rtc/calls/acceptance'),
    ).toBe(true);
  });
});

describe('a finished call stays finished', () => {
  it('shows why it ended and offers nothing further', async () => {
    await openCalls();
    await click(`call-voice-${introductionId}`);
    await click('call-cancel');

    await waitFor(() => {
      expect(screen.getByTestId('call-state').textContent).toBe('Withdrawn');
    });
    expect(screen.getByTestId('call-end-reason').textContent).toBe('Withdrawn');
    expect(screen.queryByTestId('call-cancel')).toBeNull();
    expect(screen.queryByTestId('call-end')).toBeNull();
    expect(screen.queryByTestId('call-join')).toBeNull();
    await screen.findByTestId('call-dismiss');
  });

  it('never explains a platform ending beyond what the server disclosed', async () => {
    const double = await openCalls(
      withLiveCall({ role: 'caller', state: 'active' }),
    );
    await click(`call-voice-${introductionId}`);
    await screen.findByTestId('call-end');

    // Safety ends the call underneath them. The next thing they do reports it,
    // which is exactly how somebody finds out.
    const live = double.state.call;
    if (live === null) throw new Error('the pair had no call');
    double.state.call = {
      ...live,
      endReason: 'ended_by_platform',
      endedAt: at(60),
      state: 'ended',
    };
    await click('call-end');

    await waitFor(() => {
      expect(screen.getByTestId('call-end-reason').textContent).toBe(
        'Ended by VELORA',
      );
    });
    // A block and an enforcement are separate decisions with separate owners,
    // and telling the two apart here would publish the other person's. The
    // surface has no vocabulary finer than what arrived.
    const rendered = document.body.textContent;
    for (const forbidden of ['blocked', 'report', 'enforcement']) {
      expect(rendered).not.toContain(forbidden);
    }
    expect(
      double.calls.every((entry) => entry.path !== '/v1/safety/blocks'),
    ).toBe(true);
  });
});

describe('a credential is asked for, never kept', () => {
  it('requests a fresh one on every join', async () => {
    const double = await openCalls(withLiveCall({}));
    await click(`call-voice-${introductionId}`);
    await click('call-accept');
    await screen.findByTestId('call-join');

    await click('call-join');
    await waitFor(() => {
      expect(
        double.calls.filter(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toHaveLength(1);
    });

    await click('call-join');
    await waitFor(() => {
      // Two joins, two issuances. Reusing the first would carry an authorization
      // taken before whatever happened in between.
      expect(
        double.calls.filter(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toHaveLength(2);
    });
  });

  it('puts no credential anywhere it would outlive the call', async () => {
    const double = await openCalls(withLiveCall({}));
    await click(`call-voice-${introductionId}`);
    await click('call-accept');
    await click('call-join');
    await waitFor(() => {
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toBe(true);
    });

    // Not in the document, not in storage, not in the address. A credential a
    // third party will honour without asking again belongs in memory for the
    // length of a join and nowhere else.
    expect(document.body.textContent).not.toContain('join-');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('re-reads the call rather than trusting the issuance', async () => {
    const double = await openCalls(withLiveCall({}));
    await click(`call-voice-${introductionId}`);
    await click('call-accept');
    await click('call-join');

    await waitFor(() => {
      // Obtaining a credential says nothing about whether the other side is
      // still there, so the surface asks what the call's state actually is.
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'GET',
        ),
      ).toBe(true);
    });
  });
});
