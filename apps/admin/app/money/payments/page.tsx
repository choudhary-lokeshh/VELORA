'use client';

import { AdminGate } from '../../../src/app/gate';
import { PageHeader } from '../../../src/design/primitives';
import { MoneyNav } from '../../../src/product/money';
import { Payments } from '../../../src/product/payments';

export default function PaymentsPage() {
  return (
    <AdminGate title="Payments">
      <PageHeader
        lede="Every payment the platform has taken, with the reference its provider quotes. Nothing here says who paid."
        title="Payments"
      />
      <MoneyNav />
      <Payments />
    </AdminGate>
  );
}
