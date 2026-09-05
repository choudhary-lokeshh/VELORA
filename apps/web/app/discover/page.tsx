import type { Metadata } from 'next';
import { Suspense } from 'react';

import { resolveApiBaseUrl } from '../../src/api';
import { readLiveWindows } from '../../src/server/public-reads';
import { Bootstrap, AppGate } from '../../src/app/gate';
import { Discover } from '../../src/product/discover';
import { privateMetadata } from '../../src/seo/metadata';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * A real name for a browser tab and a history entry, and a refusal for
 * everything else.
 *
 * `noindex` is stated here as well as in the response header the middleware
 * stamps, because the two are read by different crawlers at different
 * moments and neither is worth relying on alone. Nothing behind this address
 * is visible without a session in any case; this is what stops it appearing
 * in a results page as a title with a sign-in form under it.
 */
export const metadata: Metadata = privateMetadata('Discover');

/**
 * The section is a query parameter, and reading one needs a boundary.
 *
 * Without it Next bails the whole page out to client rendering, which turns the
 * first paint into an empty shell and delays the feed behind hydration for no
 * benefit. The fallback is the same bootstrap state every other pre-answer
 * moment on this surface uses, so nothing new appears while it resolves.
 */
export default async function DiscoverPage() {
  // The scheduled times, read on the server beside the API endpoint. They are
  // the same answer for everybody, so there is nothing viewer-specific in them
  // and nothing to wait for a session to decide.
  const liveWindows = await readLiveWindows();
  return (
    <AppGate title="Discover">
      <Suspense fallback={<Bootstrap />}>
        <Discover apiBaseUrl={resolveApiBaseUrl()} liveWindows={liveWindows} />
      </Suspense>
    </AppGate>
  );
}
