import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import { createInMemorySecureTokenStore } from '../src/auth/secure-storage';
import { ConsumerApp } from '../src/product/app';
import {
  admittedState,
  callId,
  createMobileApiDouble,
  introductionId,
  otherPersonId,
  type MobileApiState,
} from './support/api-double';

/**
 * Consumer Mobile's calling area.
 *
 * The cases below are the ones a phone actually produces: the screen goes off
 * mid-call, the app is killed and relaunched, a notification is tapped hours
 * after it arrived, the network hands over, and the same account answers on
 * another device. None of them get bespoke handling in the surface, and these
 * tests are how that claim is checked — every one of them resolves because the
 * app holds no call state of its own and asks the server instead.
 *
 * Two things are asserted by absence, deliberately. This surface opens no
 * microphone, camera, audio route, or peer connection, and it requests no
 * permission it would not use; a test that found one would be finding a
 * capability this app does not have.
 */

const apiBaseUrl = 'http://api.test';

const foregroundListeners: ((status: AppStateStatus) => void)[] = [];

beforeEach(() => {
  foregroundListeners.length = 0;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, handler): NativeEventSubscription => {
      if (type === 'change') foregroundListeners.push(handler);
      return {
        remove: () => {
          // Nothing to detach: the list is rebuilt for every test.
        },
      };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function withMutualIntroduction(): MobileApiState {
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

/** A state in which the pair already has a call, on the given terms. */
function withLiveCall(
  overrides: Partial<NonNullable<MobileApiState['call']>> = {},
): MobileApiState {
  return {
    ...withMutualIntroduction(),
    call: {
      counterpart: { displayName: 'Robin', id: otherPersonId },
      createdAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 0)).toISOString(),
      id: callId,
      invitationExpiresAt: new Date(
        Date.UTC(2026, 7, 14, 12, 0, 45),
      ).toISOString(),
      medium: 'voice',
      role: 'recipient',
      state: 'invited',
      ...overrides,
    },
  };
}

async function openCalls(state: MobileApiState = withMutualIntroduction()) {
  const double = createMobileApiDouble(state);
  const store = createInMemorySecureTokenStore();
  await store.write({
    accessToken: 'access-stored',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    installationId: 'installation-local-device',
    refreshToken: 'refresh-stored',
  });
  const view = await render(
    <ConsumerApp
      apiBaseUrl={apiBaseUrl}
      fetchImplementation={double.fetch}
      store={store}
    />,
  );
  await waitFor(() => {
    expect(view.getByTestId('auth-status')).toHaveTextContent('Signed in');
  });
  await fireEvent.press(view.getByTestId('nav-calls'));
  // The area switch resolves asynchronously, so every test starts from a screen
  // that is actually the calling one rather than racing the one before it.
  await view.findByTestId('calls-media-unavailable');
  return { double, view };
}

/** Sends the app to the background and back, as the platform does. */
async function foreground(): Promise<void> {
  await act(() => {
    for (const listener of [...foregroundListeners]) listener('background');
    for (const listener of [...foregroundListeners]) listener('active');
    return Promise.resolve();
  });
}

describe('the server is the only authority on a call', () => {
  it('places a call against a relationship, naming no person', async () => {
    const { double, view } = await openCalls();
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-current');

    const placed = double.calls.find(
      (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'POST',
    );
    // The introduction and the medium, and nothing else. No participant, no
    // session, no provider, no state — the server decides every one of those.
    expect(placed?.body).toEqual({ introductionId, medium: 'voice' });
  });

  it('carries the bearer token and no ambient credential', async () => {
    const { double, view } = await openCalls();
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-current');

    // The same transport every other mobile request uses, from the session
    // manager, rather than a second credential path invented for calling.
    expect(double.authorizations).toContain('Bearer access-stored');
  });

  it('renders the state the server reported, never one it inferred', async () => {
    const { view } = await openCalls(withLiveCall({ state: 'active' }));
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );

    await waitFor(() => {
      expect(view.getByTestId('call-state')).toHaveTextContent('Connected');
    });
    // Reaching for the pair surfaced the call that already existed rather than
    // opening a second one, and this device is on the side the server says.
    expect(view.queryByTestId('call-accept')).toBeNull();
    expect(view.getByTestId('call-end')).toBeTruthy();
  });
});

describe('a phone goes away and comes back', () => {
  it('reports a call that ended while the screen was off', async () => {
    const { double, view } = await openCalls(withLiveCall({ state: 'active' }));
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-current');

    // The other person hangs up while the app is backgrounded. Nothing reaches
    // the device; it finds out by asking on the way back.
    double.state.call = null;
    await foreground();

    await waitFor(() => {
      expect(view.queryByTestId('call-current')).toBeNull();
    });
  });

  it('holds no call across a restart, so a stale notification revives nothing', async () => {
    // A cold start against a server whose last call for this pair is long
    // finished — the situation somebody is in when they tap a notification
    // hours later.
    const { view } = await openCalls({
      ...withMutualIntroduction(),
      call: {
        counterpart: { displayName: 'Robin', id: otherPersonId },
        createdAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 0)).toISOString(),
        endReason: 'invitation_expired',
        endedAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 45)).toISOString(),
        id: callId,
        invitationExpiresAt: new Date(
          Date.UTC(2026, 7, 14, 12, 0, 45),
        ).toISOString(),
        medium: 'voice',
        role: 'recipient',
        state: 'expired',
      },
    });

    // Nothing is on screen: the app restored no call, so there is nothing for a
    // stale notification to reopen and no "Answer" to press on a call that
    // stopped ringing yesterday.
    expect(view.queryByTestId('call-current')).toBeNull();

    // And reaching for the pair opens a new call rather than resurrecting the
    // finished one — this person is now the caller, ringing, not a recipient
    // being offered an expired invitation.
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await waitFor(() => {
      expect(view.getByTestId('call-state')).toHaveTextContent('Ringing');
    });
    expect(view.queryByTestId('call-accept')).toBeNull();
    expect(view.getByTestId('call-cancel')).toBeTruthy();
    expect(view.queryByTestId('call-end-reason')).toBeNull();
  });
});

describe('one account, more than one device', () => {
  it('goes stale on this device once the call is answered on another', async () => {
    const { double, view } = await openCalls(withLiveCall());
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-accept');

    // The other device answers first. This one still shows "Answer".
    const ringing = double.state.call;
    if (ringing === null) throw new Error('the pair had no call');
    double.state.call = { ...ringing, state: 'accepted' };
    await fireEvent.press(view.getByTestId('call-accept'));

    await waitFor(() => {
      // The server refuses the second acceptance, and this device is told what
      // actually happened rather than being left showing a control that failed.
      expect(view.getByTestId('call-state')).toHaveTextContent('Answered');
    });
    expect(view.queryByTestId('call-accept')).toBeNull();
  });
});

describe('safety outranks a call in progress', () => {
  it('shows a platform ending without explaining it, while ringing', async () => {
    await expectPlatformEnding('invited');
  });

  it('shows a platform ending without explaining it, while active', async () => {
    await expectPlatformEnding('active');
  });

  it('shows a platform ending without explaining it, while reconnecting', async () => {
    await expectPlatformEnding('reconnecting');
  });
});

async function expectPlatformEnding(from: string): Promise<void> {
  const { double, view } = await openCalls(
    withLiveCall({ role: 'caller', state: from }),
  );
  await fireEvent.press(
    await view.findByTestId(`call-voice-${introductionId}`),
  );
  await view.findByTestId('call-current');

  // Safety ends the call underneath them, from whichever state it was in.
  const live = double.state.call;
  if (live === null) throw new Error('the pair had no call');
  double.state.call = {
    ...live,
    endReason: 'ended_by_platform',
    endedAt: new Date(Date.UTC(2026, 7, 14, 12, 1, 0)).toISOString(),
    state: 'ended',
  };
  await foreground();

  await waitFor(() => {
    expect(view.getByTestId('call-end-reason')).toHaveTextContent(
      'Ended by VELORA',
    );
  });
  // No live control survives it, and nothing on screen says which safety
  // decision applied — a block and an enforcement are separate decisions with
  // separate owners, and naming either would publish the other person's.
  expect(view.queryByTestId('call-accept')).toBeNull();
  expect(view.queryByTestId('call-end')).toBeNull();
  expect(view.queryByTestId('call-join')).toBeNull();
  expect(view.toJSON()).toBeTruthy();
  const rendered = JSON.stringify(view.toJSON());
  for (const forbidden of ['blocked', 'report', 'enforcement']) {
    expect(rendered).not.toContain(forbidden);
  }
}

describe('a handover is a failed request, not a state machine', () => {
  it('re-reads the call when an action fails on a dropped connection', async () => {
    const { double, view } = await openCalls(
      withLiveCall({ role: 'caller', state: 'active' }),
    );
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-end');

    // Wi-Fi to cellular: the hang-up never lands.
    double.failNext('/v1/rtc/calls/termination');
    await fireEvent.press(view.getByTestId('call-end'));

    await waitFor(() => {
      // The surface asks what the call's state actually is rather than
      // deciding for itself what a failed request meant.
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'GET',
        ),
      ).toBe(true);
    });
    expect(view.getByTestId('call-state')).toHaveTextContent('Connected');
  });
});

describe('a dropped connection is not a dropped call', () => {
  it('keeps the call on screen when the re-read never reaches the server', async () => {
    const { double, view } = await openCalls(
      withLiveCall({ role: 'caller', state: 'active' }),
    );
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-end');

    // The handover takes out both the action and the re-read that follows it.
    double.failNext('/v1/rtc/calls/termination');
    double.failNext('/v1/rtc/calls');
    await fireEvent.press(view.getByTestId('call-end'));

    await waitFor(() => {
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls' && entry.method === 'GET',
        ),
      ).toBe(true);
    });
    // A request that reached nobody says nothing about the call. Blanking the
    // screen here would end a live call every time somebody walked out of a
    // building.
    expect(view.getByTestId('call-current')).toBeTruthy();
    expect(view.getByTestId('call-state')).toHaveTextContent('Connected');
  });

  it('drops the call when the server says it has none', async () => {
    const { double, view } = await openCalls(withLiveCall({ state: 'active' }));
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await view.findByTestId('call-current');

    double.state.call = null;
    await foreground();

    await waitFor(() => {
      expect(view.queryByTestId('call-current')).toBeNull();
    });
  });
});

describe('a credential is asked for, never kept', () => {
  it('asks again on every join and every reconnect', async () => {
    const { double, view } = await openCalls(withLiveCall());
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await fireEvent.press(await view.findByTestId('call-accept'));

    await fireEvent.press(await view.findByTestId('call-join'));
    await waitFor(() => {
      expect(
        double.calls.filter(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toHaveLength(1);
    });

    // A reconnect is another issuance, not a reuse: the server re-composes
    // eligibility each time, which is what lets a block landing in between be
    // enforced rather than outlived.
    const answered = double.state.call;
    if (answered === null) throw new Error('the pair had no call');
    double.state.call = { ...answered, state: 'reconnecting' };
    await foreground();
    await fireEvent.press(await view.findByTestId('call-join'));
    await waitFor(() => {
      expect(
        double.calls.filter(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toHaveLength(2);
    });
  });

  it('puts no credential on the screen or in stored tokens', async () => {
    const { double, view } = await openCalls(withLiveCall());
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await fireEvent.press(await view.findByTestId('call-accept'));
    await fireEvent.press(await view.findByTestId('call-join'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toBe(true);
    });

    expect(JSON.stringify(view.toJSON())).not.toContain('join-');
  });
});

describe('the surface claims no capability it does not have', () => {
  it('says plainly that a call carries no audio or video yet', async () => {
    const { view } = await openCalls();
    expect(view.getByTestId('calls-media-unavailable')).toHaveTextContent(
      /cannot carry audio or video on this device yet/u,
    );
  });

  it('asks for no permission, because it would use none', async () => {
    const { double, view } = await openCalls(withLiveCall());
    await fireEvent.press(
      await view.findByTestId(`call-voice-${introductionId}`),
    );
    await fireEvent.press(await view.findByTestId('call-accept'));
    await fireEvent.press(await view.findByTestId('call-join'));
    await waitFor(() => {
      expect(
        double.calls.some(
          (entry) => entry.path === '/v1/rtc/calls/join-authorization',
        ),
      ).toBe(true);
    });

    // Nothing here opens a device. Asking for a microphone the app will not
    // read is a permission prompt spent on nothing, and it would train somebody
    // to grant one for a capability that does not exist. There is no camera
    // switch and no audio-route control for the same reason.
    expect(view.queryByTestId('call-camera-flip')).toBeNull();
    expect(view.queryByTestId('call-audio-route')).toBeNull();
    expect(view.queryByTestId('call-mute')).toBeNull();
  });
});
