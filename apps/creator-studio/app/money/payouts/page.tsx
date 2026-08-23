'use client';

import { StudioGate } from '../../../src/app/gate';
import { Payouts } from '../../../src/product/payouts';

export default function PayoutsPage() {
  return (
    <StudioGate title="Payouts">
      <Payouts />
    </StudioGate>
  );
}
