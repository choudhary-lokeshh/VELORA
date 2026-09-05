import type { Metadata } from 'next';

import { AppGate } from '../../../src/app/gate';
import { Wallet } from '../../../src/product/wallet';
import { privateMetadata } from '../../../src/seo/metadata';

/**
 * A real name for a browser tab and a history entry, and a refusal for
 * everything else.
 *
 * `noindex` is stated here as well as in the response header the middleware
 * stamps, because the two are read by different crawlers at different moments
 * and neither is worth relying on alone.
 */
export const metadata: Metadata = privateMetadata('Coins');

export default function WalletPage() {
  return (
    <AppGate narrow title="Coins">
      <Wallet />
    </AppGate>
  );
}
