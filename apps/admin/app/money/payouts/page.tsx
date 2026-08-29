'use client';

import { AdminGate } from '../../../src/app/gate';
import { PageHeader } from '../../../src/design/primitives';
import { MoneyNav } from '../../../src/product/money';
import { Payouts } from '../../../src/product/payouts';

export default function PayoutsPage() {
  return (
    <AdminGate title="Payouts">
      <PageHeader
        lede="Every payout instruction the platform holds. Nothing about where the money is going appears here, and nothing on this screen moves one."
        title="Payouts"
      />
      <MoneyNav />
      <Payouts />
    </AdminGate>
  );
}
