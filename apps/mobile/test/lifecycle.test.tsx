import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import {
  createInMemorySecureTokenStore,
  type SecureTokenStore,
} from '../src/auth/secure-storage';
import { ConsumerApp } from '../src/product/app';
import {
  admittedState,
  createMobileApiDouble,
  type MobileApiState,
} from './support/api-double';

/**
 * Consumer Mobile's launch and foreground lifecycle.
 *
 * A cold launch with stored tokens, an offline launch, a session the server has
 * ended, and coming back to the foreground. Nothing here claims anything about
 * a physical device or a platform keystore — the store is a test double and
 * says so in its name.
 *
 * These live apart from the product-area suite because each Jest file gets its
 * own module registry: an app left mid-request by one suite cannot then render
 * into another's.
 *
 * Queries come from each render rather than from the library's module-level
 * `screen`, so a test always addresses the tree it mounted.
 */

const apiBaseUrl = 'http://api.test';

// `render` resolves asynchronously in this version of the library, so every
// mount is awaited and the queries come from the resolved result.
/**
 * The app-state listeners the surface registered.
 *
 * The platform emitter is native, so the harness stands in for it and calls the
 * very listener the app installed. That keeps the assertion about the app's
 * behaviour rather than about a mock's internals.
 */
const foregroundListeners: ((status: AppStateStatus) => void)[] = [];

beforeEach(() => {
  foregroundListeners.length = 0;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, handler): NativeEventSubscription => {
      if (type === 'change') {
        foregroundListeners.push(handler);
      }
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
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed in');
    });
    // The stored access token is presented; nothing is re-authenticated.
    expect(double.authorizations).toContain('Bearer access-stored');
    expect(
      double.calls.some(
        (call) => call.path === '/v1/auth/local/mobile-sessions',
      ),
    ).toBe(false);
  });

  it('reports being signed out when there is nothing stored', async () => {
    const { view } = await launch({ signedIn: false });
    await waitFor(() => {
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed out');
    });
    expect(view.getByTestId('auth-cause')).toHaveTextContent('initial');
  });

  it('creates one session however fast the sign-in control is tapped', async () => {
    const { double, view } = await launch({ signedIn: false });
    await waitFor(() => {
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed out');
    });
    const signIn = view.getByTestId('auth-sign-in');

    // Two taps in one frame. Both read a state-held guard as it was before
    // either committed, and two sessions for one press is credential material
    // this device never asked for and would not go on to hold.
    await act(() => {
      void fireEvent.press(signIn);
      void fireEvent.press(signIn);
      return Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed in');
    });
    expect(
      double.calls.filter(
        (call) =>
          call.path === '/v1/auth/local/mobile-sessions' &&
          call.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('keeps a stored session on an offline launch rather than claiming the person is out', async () => {
    const state = admittedState();
    state.offline = true;
    const { store, view } = await launch({ state });

    await waitFor(() => {
      expect(view.getByTestId('auth-status')).toHaveTextContent(
        'VELORA could not be reached',
      );
    });
    // The material survives, so coming back online does not mean signing in.
    expect(await store.read()).toBeDefined();
  });

  it('drops a session the server says has ended', async () => {
    const state = admittedState();
    state.sessionLive = false;
    const { store, view } = await launch({ state });

    await waitFor(() => {
      expect(view.getByTestId('auth-cause')).toHaveTextContent('session_ended');
    });
    // Unknown, expired, revoked, and replayed are one answer by design, and the
    // only safe response is to hold nothing usable.
    expect(await store.read()).toBeUndefined();
  });
});

describe('foreground', () => {
  it('asks the server again when the app comes back', async () => {
    const { double, view } = await launch();
    await waitFor(() => {
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed in');
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
      expect(view.getByTestId('auth-status')).toHaveTextContent('Signed in');
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
