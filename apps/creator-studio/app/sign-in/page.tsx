'use client';

import { Suspense } from 'react';

import { Bootstrap, PublicGate } from '../../src/app/gate';
import { SignIn } from '../../src/product/sign-in';

/**
 * `useSearchParams` reads the requested destination, which makes this subtree
 * client-only; the boundary is explicit so the rest of the route can still be
 * prerendered.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={<Bootstrap />}>
      <PublicGate>
        <SignIn />
      </PublicGate>
    </Suspense>
  );
}
