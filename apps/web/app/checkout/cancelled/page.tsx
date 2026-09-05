import type { Metadata } from 'next';
import { AppGate } from '../../../src/app/gate';
import { CheckoutCancelled } from '../../../src/product/checkout';
import { privateMetadata } from '../../../src/seo/metadata';

/**
 * A real name for a browser tab and a history entry, and a refusal for
 * everything else.
 *
 * `noindex` is stated here as well as in the response header the middleware
 * stamps, because the two are read by different crawlers at different
 * moments and neither is worth relying on alone. Nothing behind this address
 * is visible without a session in any case; this is what stops it appearing
 * in a results page as a title with a sign-in form under it.
 */
export const metadata: Metadata = privateMetadata('Payment cancelled');

/** Where a payment provider sends somebody who did not finish. */
export default function CheckoutCancelledPage() {
  return (
    <AppGate narrow title="Payment">
      <CheckoutCancelled />
    </AppGate>
  );
}
