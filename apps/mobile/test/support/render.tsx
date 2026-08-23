import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsumerProviders } from '../../src/frame/providers';
import {
  createInMemorySecureTokenStore,
  type SecureTokenStore,
} from '../../src/auth/secure-storage';
import type { MobileApiDouble } from './api-double';

/**
 * Mounting one screen with everything the application would give it.
 *
 * The providers are real — the session manager, the generated client, the
 * account reads, the toasts — and only two things are substituted: `fetch`,
 * which answers the real contract paths from a stand-in, and the token store,
 * which is in memory and named so that no test can be read as evidence about a
 * platform keystore.
 *
 * Screens are mounted directly rather than through the router. A route file in
 * this application is four lines that pick a screen and hand it a callback, and
 * driving Expo Router in a unit test would assert the router rather than the
 * product.
 */

const apiBaseUrl = 'http://api.test';

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
  options: { readonly store?: SecureTokenStore } = {},
): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <ConsumerProviders
        apiBaseUrl={apiBaseUrl}
        fetchImplementation={double.fetch}
        store={options.store ?? createInMemorySecureTokenStore()}
        unavailable={null}
      >
        {ui}
      </ConsumerProviders>
    </SafeAreaProvider>,
  );
}
