'use client';

import { AdminGate } from '../../src/app/gate';
import { Money } from '../../src/product/money';

export default function MoneyPage() {
  return (
    <AdminGate title="Money">
      <Money />
    </AdminGate>
  );
}
