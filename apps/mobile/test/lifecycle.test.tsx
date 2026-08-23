import {
  act,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react-native';
import {
  AppState,
  Text,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import {
  createInMemorySecureTokenStore,
  type SecureTokenStore,
} from '../src/auth/secure-storage';
import { ConsumerGate } from '../src/frame/gate';
import {
  admittedState,
  createMobileApiDouble,
  type MobileApiState,
} from './support/api-double';
import { renderScreen } from './support/render';

/**
 * Consumer Mobile's launch and foreground lifecycle, through the gate that
 * decides what a person sees.
 *
 * A cold launch with stored tokens, an offline launch, a session the server has
 * ended, an account halfway up the onboarding ladder, and coming back to the
 * foreground. Nothing here claims anything about a physical device or a
 * platform keystore — the store is a test double and says so in its name.
 *
 * These live apart from the product suite because each Jest file gets its own
 * module registry: an app left mid-request by one suite cannot then render into
 * another's.
 */

/**
 * The app-state listeners the surface registered.
 *
 * The platform emitter is native, so the harness stands in for it and calls the
 * very listener the app installed. That keeps the assertion about the app's
 * behaviour rather than about a mock's internals.
 */
const foregroundListeners: ((status: AppStateStatus) => void)[] = [];

beforeEach(async () => {
  // Before mounting rather than after. Unmounting is asynchronous in this
  // version of the library, and a tree still coming down while the next test
  // mounts keeps its own app-state listeners and in-flight reads alive — which
  // is enough to hold the incoming tree's `waitFor` open until it times out.
  await cleanup();
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

/** Stands in for whichever destination the router would have mounted. */
function Product() {
  return <Text testID="product">Discover</Text>;
}

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
  const view = await renderScreen(
    <ConsumerGate>
      <Product />
    </ConsumerGate>,
    double,
    { store },
  );
  return { double, store, view };
}

/** Sends the app to the background and back, as the platform does. */
async function foreground(): Promise<void> {
  await act(() => {
    for (const listener of [...foregroundListeners]) listener('background');
    for (const listener of [...foregroundListeners]) listener('active');
    return Promise.resolve();
  });
}

describe('launch', () => {
  it('restores a stored session on a cold launch without anybody signing in', async () => {
    const { double, view } = await launch();
    await waitFor(() => {
      expect(view.getByTestId('product')).toBeTruthy();
    });
    // The stored access token is presented; nothing is re-authenticated.
    expect(double.authorizations).toContain('Bearer access-stored');
    expect(
      double.calls.some(
        (call) => call.path === '/v1/auth/local/mobile-sessions',
      ),
    ).toBe(false);
  });

  it('offers the welcome screen when there is nothing stored', async () => {
    const { view } = await launch({ signedIn: false });
    await waitFor(() => {
      expect(view.getByTestId('welcome-screen')).toBeTruthy();
    });
    // "You signed out" is a different sentence from "you have never been here",
    // and only the second is true on a first launch.
    expect(view.queryByTestId('auth-cause')).toBeNull();
  });

  it('signs in once the identity is typed, and only then', async () => {
    const { double, view } = await launch({ signedIn: false });
    await waitFor(() => {
      expect(view.getByTestId('welcome-screen')).toBeTruthy();
    });
    await fireEvent.changeText(
      view.getByTestId('auth-subject'),
      'person@velora.test',
    );
    await fireEvent.press(view.getByTestId('auth-sign-in'));

    await waitFor(() => {
      expect(view.getByTestId('product')).toBeTruthy();
    });
    expect(
      double.calls.filter(
        (call) =>
          call.path === '/v1/auth/local/mobile-sessions' &&
          call.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('will not sign in with nothing typed, and says why', async () => {
    const { double, view } = await launch({ signedIn: false });
    await waitFor(() => {
      expect(view.getByTestId('welcome-screen')).toBeTruthy();
    });

    await fireEvent.press(view.getByTestId('auth-sign-in'));

    expect(view.getByTestId('sign-in-field-error')).toBeTruthy();
    expect(
      double.calls.some(
        (call) => call.path === '/v1/auth/local/mobile-sessions',
      ),
    ).toBe(false);
  });

  it('keeps a stored session on an offline launch rather than claiming the person is out', async () => {
    const state = admittedState();
    state.offline = true;
    const { store, view } = await launch({ state });

    await waitFor(() => {
      expect(view.getByTestId('auth-unavailable')).toBeTruthy();
    });
    // The material survives, so coming back online does not mean signing in.
    expect(await store.read()).toBeDefined();
  });

  it('drops a session the server says has ended, and says which happened', async () => {
    const state = admittedState();
    state.sessionLive = false;
    const { store, view } = await launch({ state });

    await waitFor(() => {
      expect(
        view.getByText('Your session ended. Sign in again to carry on.'),
      ).toBeTruthy();
    });
    // Unknown, expired, revoked, and replayed are one answer by design, and the
    // only safe response is to hold nothing usable.
    expect(await store.read()).toBeUndefined();
  });
});

describe('the gate', () => {
  it('shows the onboarding ladder to somebody with no account yet', async () => {
    const state = admittedState();
    // Both reads 404 for somebody who has authenticated and never created an
    // account, because the API refuses to disclose which it is.
    state.account = null;
    state.onboarding = null;
    const { view } = await launch({ state });

    await waitFor(() => {
      expect(view.getByTestId('onboarding-screen')).toBeTruthy();
    });
    expect(view.getByTestId('create-account')).toBeTruthy();
    expect(view.queryByTestId('product')).toBeNull();
  });

  it('keeps somebody on the ladder until the server says it is finished', async () => {
    const state = admittedState();
    state.onboarding = {
      adultAssurance: 'none',
      adultAssuranceRefused: false,
      outstandingPolicies: [],
      outstandingProfile: [],
      step: 'adult_declaration',
    };
    const { view } = await launch({ state });

    await waitFor(() => {
      expect(view.getByTestId('declare-adult')).toBeTruthy();
    });
    expect(view.queryByTestId('product')).toBeNull();
  });

  /**
   * The window between a launch and the first answer is real and has a
   * duration. Rendering the product into it would put a signed-in surface in
   * front of somebody who is signed out.
   */
  it('shows neither the product nor a sign-in while the keystore is being read', async () => {
    const double = createMobileApiDouble(admittedState());
    // A store that never answers holds the surface in the one state that has a
    // real duration on a cold launch: the platform keystore has been asked and
    // has not replied.
    const pending: SecureTokenStore = {
      clear: () => Promise.resolve(undefined),
      kind: 'never-answers-test-double',
      read: async () => new Promise(() => undefined),
      write: () => Promise.resolve(undefined),
    };
    const view = await renderScreen(
      <ConsumerGate>
        <Product />
      </ConsumerGate>,
      double,
      { store: pending },
    );

    expect(view.getByTestId('launch')).toBeTruthy();
    expect(view.queryByTestId('product')).toBeNull();
    expect(view.queryByTestId('welcome-screen')).toBeNull();
  });
});

describe('foreground', () => {
  it('asks the server again when the app comes back', async () => {
    const { double, view } = await launch();
    await waitFor(() => {
      expect(view.getByTestId('product')).toBeTruthy();
    });
    const before = double.calls.filter(
      (call) => call.path === '/v1/users/me',
    ).length;

    await foreground();

    await waitFor(() => {
      expect(
        double.calls.filter((call) => call.path === '/v1/users/me').length,
      ).toBeGreaterThan(before);
    });
  });

  it('does not poll while nobody is looking', async () => {
    const { double, view } = await launch();
    await waitFor(() => {
      expect(view.getByTestId('product')).toBeTruthy();
    });
    const settled = double.calls.length;

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });

    // No timer, no heartbeat, no background traffic. The app asks when it is
    // foregrounded and when somebody acts, and otherwise it is silent.
    expect(double.calls.length).toBe(settled);
  });
});
