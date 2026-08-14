import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  createInMemorySecureTokenStore,
  type SecureTokenStore,
} from '../src/auth/secure-storage';
import { ConsumerApp } from '../src/product/app';
import {
  admittedState,
  conversationId,
  createMobileApiDouble,
  otherPersonId,
  ownAccountId,
  type MobileApiState,
} from './support/api-double';

/**
 * The Consumer Mobile product areas, driven through the generated client
 * against a stand-in API that answers the real contract.
 *
 * Everything asserted here is behaviour a phone actually produces: a duplicate
 * tap, a retry after a lost response, a block that closes a conversation, an
 * availability window that ended while the app was suspended.
 *
 * Queries come from each render rather than from the library's module-level
 * `screen`, so a test always addresses the tree it mounted and never a
 * neighbour's.
 */

const apiBaseUrl = 'http://api.test';

// `render` resolves asynchronously in this version of the library, so every
// mount is awaited and the queries come from the resolved result.
type MountedApp = Awaited<ReturnType<typeof render>>;

async function launch(options?: {
  readonly signedIn?: boolean;
  readonly state?: MobileApiState;
  readonly store?: SecureTokenStore;
}) {
  const double = createMobileApiDouble(options?.state ?? admittedState());
  const store = options?.store ?? createInMemorySecureTokenStore();
  if (options?.signedIn !== false) {
    await store.write({
      accessToken: 'access-stored',
      // Far enough ahead that a launch does not rotate by accident.
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      installationId: 'installation-local-device',
      refreshToken: 'refresh-stored',
    });
  }
  const view = await render(
    <ConsumerApp
      apiBaseUrl={apiBaseUrl}
      fetchImplementation={double.fetch}
      store={store}
    />,
  );
  return { double, store, view };
}

/**
 * A launched app that has finished loading its account and reached the product.
 *
 * Waiting here rather than in each test is what a person does: the app is
 * opened, it settles, and only then is anything tapped.
 */
async function ready(options?: Parameters<typeof launch>[0]) {
  const launched = await launch(options);
  await waitFor(() => {
    expect(launched.view.getByTestId('nav-discovery')).toBeTruthy();
  });
  return launched;
}

describe('discovery', () => {
  it('removes a candidate only once the server accepts the decision', async () => {
    const { double, view } = await ready();
    const pass = await view.findByTestId(`pass-${otherPersonId}`);

    double.refuseNext('/v1/discovery/passes', 409, 'ACCOUNT_NOT_ELIGIBLE');
    await fireEvent.press(pass);
    await waitFor(() => {
      expect(view.getByTestId('discovery-notice')).toHaveTextContent(
        'Your account cannot do that in its current state.',
      );
    });
    // Refused, so the candidate is still there. Optimism never overrides the
    // server's answer.
    expect(view.getByTestId(`pass-${otherPersonId}`)).toBeTruthy();

    await fireEvent.press(view.getByTestId(`pass-${otherPersonId}`));
    await waitFor(() => {
      expect(view.queryByTestId(`pass-${otherPersonId}`)).toBeNull();
    });
  });

  it('turns a duplicate tap into one request', async () => {
    const { double, view } = await ready();
    const signal = await view.findByTestId(`signal-${otherPersonId}`);

    // Three taps in one frame, which is what an impatient finger produces and
    // what a state-held guard would let through.
    await act(() => {
      void fireEvent.press(signal);
      void fireEvent.press(signal);
      void fireEvent.press(signal);
      return Promise.resolve();
    });

    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) =>
            call.path === '/v1/discovery/introductions' &&
            call.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });
});

describe('onboarding', () => {
  it('turns a duplicate tap on the ladder into one request', async () => {
    const { double, view } = await launch({
      state: {
        ...admittedState(),
        account: {
          createdAt: '2026-08-14T12:00:00.000Z',
          id: ownAccountId,
          status: 'pending_profile',
        },
        onboarding: {
          adultAssurance: 'none',
          adultAssuranceRefused: false,
          outstandingPolicies: [],
          outstandingProfile: [],
          step: 'adult_declaration',
        },
        profile: null,
      },
    });
    const declare = await view.findByTestId('declare-adult');

    // Two taps in one frame. A guard held in component state lets both through,
    // because neither has committed by the time the other reads it — and an
    // adult declaration sent twice is two writes for one decision.
    await act(() => {
      void fireEvent.press(declare);
      void fireEvent.press(declare);
      return Promise.resolve();
    });

    await waitFor(() => {
      expect(
        double.calls.filter(
          (call) =>
            call.path === '/v1/users/me/onboarding/adult-declaration' &&
            call.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });
});

describe('messaging', () => {
  async function openConversation(view: MountedApp) {
    await fireEvent.press(await view.findByTestId('nav-conversations'));
    await fireEvent.press(
      await view.findByTestId(`conversation-${conversationId}`),
    );
    await view.findByTestId('conversation-view');
  }

  it('retries a lost send with the same identifier and creates one message', async () => {
    const { double, view } = await ready();
    await openConversation(view);

    await fireEvent.changeText(view.getByTestId('message-input'), 'only once');
    double.failNext('/v1/messaging/messages');
    await fireEvent.press(view.getByTestId('message-send'));

    await waitFor(() => {
      expect(view.getByTestId('message-send-failed')).toBeTruthy();
    });
    await fireEvent.press(view.getByTestId('message-retry'));

    await waitFor(() => {
      expect(double.state.messages).toHaveLength(1);
    });
    const sends = double.calls.filter(
      (call) =>
        call.path === '/v1/messaging/messages' && call.method === 'POST',
    );
    expect(sends).toHaveLength(2);
    // Two attempts, one identifier. That is what makes the retry safe.
    expect(
      new Set(
        sends.map(
          (call) => (call.body as { clientMessageId: string }).clientMessageId,
        ),
      ).size,
    ).toBe(1);
  });

  it('does not offer a retry for a refusal that will refuse again', async () => {
    const { double, view } = await ready();
    await openConversation(view);

    await fireEvent.changeText(view.getByTestId('message-input'), 'too late');
    double.refuseNext('/v1/messaging/messages', 409, 'ACTION_NOT_PERMITTED');
    await fireEvent.press(view.getByTestId('message-send'));

    await waitFor(() => {
      expect(view.getByTestId('message-send-failed')).toHaveTextContent(
        'That is not possible right now.',
      );
    });
    expect(view.queryByTestId('message-retry')).toBeNull();
  });

  it('shows messages in the order the server assigned, not the device clock', async () => {
    const { double, view } = await ready();
    await openConversation(view);

    for (const text of ['first', 'second']) {
      await fireEvent.changeText(view.getByTestId('message-input'), text);
      await fireEvent.press(view.getByTestId('message-send'));
      await waitFor(() => {
        expect(
          view.getByTestId(`message-${String(double.state.messages.length)}`),
        ).toBeTruthy();
      });
    }
    expect(view.getByTestId('message-1')).toHaveTextContent('first');
    expect(view.getByTestId('message-2')).toHaveTextContent('second');
  });
});

describe('safety', () => {
  it('blocks and stops offering the candidate', async () => {
    const { view } = await ready();
    await fireEvent.press(await view.findByTestId('nav-safety'));
    await fireEvent.changeText(
      await view.findByTestId('safety-target'),
      otherPersonId,
    );
    await fireEvent.press(view.getByTestId('block-submit'));

    await waitFor(() => {
      expect(view.getByTestId('safety-notice')).toHaveTextContent(/^Blocked/u);
    });

    await fireEvent.press(view.getByTestId('nav-discovery'));
    await waitFor(() => {
      expect(view.queryByTestId(`pass-${otherPersonId}`)).toBeNull();
    });
  });

  it('does not keep the report narrative on the surface after sending it', async () => {
    const { view } = await ready();
    await fireEvent.press(await view.findByTestId('nav-safety'));
    await fireEvent.changeText(
      await view.findByTestId('safety-target'),
      otherPersonId,
    );
    await fireEvent.changeText(
      view.getByTestId('report-detail'),
      'private narrative',
    );
    await fireEvent.press(view.getByTestId('report-submit'));

    await waitFor(() => {
      expect(view.getByTestId('safety-notice')).toHaveTextContent(
        /^Report received/u,
      );
    });
    // Sent once, kept nowhere: the narrative is evidence, not something this
    // screen holds on to.
    expect(view.getByTestId('report-detail').props.value).toBe('');
  });
});

describe('availability', () => {
  it('reports an ended window as ended rather than as never chosen', async () => {
    const state = admittedState();
    state.availability = {
      availableUntil: new Date(Date.now() - 3_600_000).toISOString(),
      // What the person chose, and what the server now acts on.
      effectiveState: 'unavailable',
      state: 'available',
      updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
    };
    const { view } = await ready({ state });

    await fireEvent.press(await view.findByTestId('nav-profile'));
    await waitFor(() => {
      expect(view.getByTestId('availability-state')).toHaveTextContent(
        'Availability window ended',
      );
    });
  });
});
