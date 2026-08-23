'use client';

import { Suspense } from 'react';

import { Bootstrap, PublicGate } from '../src/app/gate';
import { Landing } from '../src/product/landing';

/**
 * The public entry.
 *
 * Somebody with a live session is moved into the product rather than shown a
 * door they are already through, and the gate needs the query string to honour a
 * deep link that came back through sign-in — which is why it waits behind a
 * boundary rather than blocking the whole page.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<Bootstrap />}>
      <PublicGate>
        <Landing />
      </PublicGate>
    </Suspense>
  );
}
