'use client';

import { AppGate } from '../../../src/app/gate';
import { CheckoutCancelled } from '../../../src/product/checkout';

/** Where a payment provider sends somebody who did not finish. */
export default function CheckoutCancelledPage() {
  return (
    <AppGate narrow title="Payment">
      <CheckoutCancelled />
    </AppGate>
  );
}
