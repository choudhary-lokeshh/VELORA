'use client';

import { Suspense } from 'react';

import { Bootstrap, PublicGate } from '../../src/app/gate';
import { SignIn } from '../../src/product/sign-in';

export default function SignInPage() {
  return (
    <Suspense fallback={<Bootstrap />}>
      <PublicGate>
        <SignIn />
      </PublicGate>
    </Suspense>
  );
}
