'use client';

import { WelcomeGate } from '../../src/app/gate';
import { Welcome } from '../../src/product/onboarding';

export default function WelcomePage() {
  return (
    <WelcomeGate>
      <Welcome />
    </WelcomeGate>
  );
}
