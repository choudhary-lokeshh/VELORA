'use client';

import { StudioGate } from '../../src/app/gate';
import { Earnings } from '../../src/product/earnings';

export default function MoneyPage() {
  return (
    <StudioGate title="Money">
      <Earnings />
    </StudioGate>
  );
}
