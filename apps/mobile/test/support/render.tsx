import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsumerProviders } from '../../src/frame/providers';
import {
  createInMemorySecureTokenStore,
  type SecureTokenStore,
} from '../../src/auth/secure-storage';
import {
  createInMemoryInstallationStore,
  createInstallationIdentity,
  type InstallationIdentity,
} from '../../src/device/installation';
import {
  createUnavailableDevicePushTokenSource,
  type DevicePushTokenSource,
} from '../../src/push/token';
import type { MobileApiDouble } from './api-double';

/**
 * Mounting one screen with everything the application would give it.
 *
 * The providers are real — the session manager, the generated client, the
 * account reads, the push registrar, the toasts — and only the platform edges
 * are substituted: `fetch`, which answers the real contract paths from a
 * stand-in; the token store, which is in memory and named so that no test can
 * be read as evidence about a platform keystore; the installation identity,
 * which is fixed so an assertion can name it; and the device push token
 * source, which is the same `unavailable` implementation every build without
 * an approved provider uses.
 *
 * Screens are mounted directly rather than through the router. A route file in
 * this application is four lines that pick a screen and hand it a callback, and
 * driving Expo Router in a unit test would assert the router rather than the
 * product.
 */

const apiBaseUrl = 'http://api.test';

/**
 * A fixed installation identifier, in the exact shape both contracts bound.
 * Fixed rather than random so a test can assert what was sent, and shaped
 * correctly so a test cannot pass against a value the server would refuse.
 */
export const testInstallationId =
  'android-2b1f4c8a-9d3e-4a7b-8c6d-5e4f3a2b1c0d';

export function testInstallationIdentity(): InstallationIdentity {
  return createInstallationIdentity({
    generate: () => testInstallationId,
    store: createInMemoryInstallationStore(),
  });
}

/** Safe-area insets a phone with a notch and a home indicator would report. */
const insets = { bottom: 34, left: 0, right: 0, top: 47 };
const frame = { height: 844, width: 390, x: 0, y: 0 };

/**
 * `render` resolves asynchronously in this version of the library, so every
 * mount is awaited and the queries come from the resolved result rather than
 * from the library's module-level `screen` — a test always addresses the tree
 * it mounted and never a neighbour's.
 */
export async function renderScreen(
  ui: ReactElement,
  double: MobileApiDouble,
  options: {
    readonly installation?: InstallationIdentity;
    readonly pushTokenSource?: DevicePushTokenSource;
    readonly store?: SecureTokenStore;
  } = {},
): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <ConsumerProviders
        apiBaseUrl={apiBaseUrl}
        fetchImplementation={double.fetch}
        installation={options.installation ?? testInstallationIdentity()}
        pushTokenSource={
          options.pushTokenSource ?? createUnavailableDevicePushTokenSource()
        }
        store={options.store ?? createInMemorySecureTokenStore()}
        unavailable={null}
      >
        {ui}
      </ConsumerProviders>
    </SafeAreaProvider>,
  );
}
