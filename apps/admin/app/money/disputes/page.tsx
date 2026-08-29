'use client';

import { AdminGate } from '../../../src/app/gate';
import { PageHeader } from '../../../src/design/primitives';
import { Disputes, MoneyNav } from '../../../src/product/money';

export default function DisputesPage() {
  return (
    <AdminGate title="Disputes">
      <PageHeader
        lede="Claims somebody's bank is making against a payment. Nothing in this product originates one, and VELORA cannot answer one yet."
        title="Disputes"
      />
      <MoneyNav />
      <Disputes />
    </AdminGate>
  );
}
