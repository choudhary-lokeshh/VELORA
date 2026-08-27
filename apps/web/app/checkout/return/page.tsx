'use client';

import { AppGate } from '../../../src/app/gate';
import { CheckoutReturn } from '../../../src/product/checkout';

/**
 * Where a payment provider sends somebody who finished.
 *
 * It reads server state and nothing else. Arriving here is not a receipt and
 * cannot become one: there is no transition on this path, so somebody who types
 * this address by hand is told exactly what the platform already believed.
 */
export default function CheckoutReturnPage() {
  return (
    <AppGate narrow title="Payment">
      <CheckoutReturn />
    </AppGate>
  );
}
