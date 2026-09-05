'use client';

import { AdminGate } from '../../../src/app/gate';
import { MoneyReconciliation } from '../../../src/product/reconciliation';

/**
 * Whether the money adds up, and where it does not.
 *
 * Findings with published definitions and identifiers an operator can open —
 * never a health percentage.
 */
export default function MoneyReconciliationPage() {
  return (
    <AdminGate title="Reconciliation">
      <MoneyReconciliation />
    </AdminGate>
  );
}
