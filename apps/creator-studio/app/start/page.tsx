'use client';

import { ActivationGate } from '../../src/app/gate';
import { Activation } from '../../src/product/activation';

export default function StartPage() {
  return (
    <ActivationGate>
      <Activation />
    </ActivationGate>
  );
}
