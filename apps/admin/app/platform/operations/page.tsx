'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformOperations } from '../../../src/product/operations';

/**
 * What is stuck, what is failing, and what the platform could not ask.
 *
 * Every figure is a durable row a domain wrote because something went wrong, so
 * a count is a set of records rather than a gauge.
 */
export default function PlatformOperationsPage() {
  return (
    <AdminGate title="Operations">
      <PlatformOperations />
    </AdminGate>
  );
}
