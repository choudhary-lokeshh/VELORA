import { Redirect } from 'expo-router';

import { discoverPath } from '../src/frame/links';

/**
 * Where a launch lands.
 *
 * Every destination is a named address — `/discover`, `/messages`, and so on —
 * so that a deep link and a notification can each name one. That leaves `/`
 * with nothing of its own, and a launch opens `/`. This gives it a home rather
 * than letting the application start on its own not-found page.
 *
 * It redirects rather than rendering Discover directly, so the address bar of
 * the router matches the tab the person is looking at and the platform restores
 * the right one on the next cold start.
 */
export default function Index() {
  return <Redirect href={discoverPath} />;
}
