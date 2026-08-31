import { Redirect } from 'expo-router';

import { livePath } from '../src/frame/links';

/**
 * Where a launch lands.
 *
 * Every destination is a named address — `/live`, `/discover`, `/messages`, and
 * so on — so that a deep link and a notification can each name one. That leaves
 * `/` with nothing of its own, and a launch opens `/`. This gives it a home
 * rather than letting the application start on its own not-found page.
 *
 * Live since [ADR-0040](../../../docs/decisions/ADR-0040-random-live-discovery.md):
 * meeting one person who is here now is the reason to open the product, and
 * Discover is one tap away. This redirect is what actually decides it — the
 * tab navigator's own anchor does not, because a launch opens `/` and lands
 * here first. That was proved on a device: the bar was already drawn with Live
 * first and the application still opened on Discover every time.
 *
 * It redirects rather than rendering Live directly, so the router's address
 * matches the tab the person is looking at and the platform restores the right
 * one on the next cold start.
 */
export default function Index() {
  return <Redirect href={livePath} />;
}
