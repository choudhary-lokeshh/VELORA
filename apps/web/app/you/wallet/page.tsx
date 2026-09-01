'use client';

import { AppGate } from '../../../src/app/gate';
import { Wallet } from '../../../src/product/wallet';

export default function WalletPage() {
  return (
    <AppGate narrow title="Coins">
      <Wallet />
    </AppGate>
  );
}
