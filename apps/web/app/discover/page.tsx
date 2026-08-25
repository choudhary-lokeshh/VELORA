import { Suspense } from 'react';

import { resolveApiBaseUrl } from '../../src/api';
import { Bootstrap, AppGate } from '../../src/app/gate';
import { Discover } from '../../src/product/discover';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * The section is a query parameter, and reading one needs a boundary.
 *
 * Without it Next bails the whole page out to client rendering, which turns the
 * first paint into an empty shell and delays the feed behind hydration for no
 * benefit. The fallback is the same bootstrap state every other pre-answer
 * moment on this surface uses, so nothing new appears while it resolves.
 */
export default function DiscoverPage() {
  return (
    <AppGate title="Discover">
      <Suspense fallback={<Bootstrap />}>
        <Discover apiBaseUrl={resolveApiBaseUrl()} />
      </Suspense>
    </AppGate>
  );
}
