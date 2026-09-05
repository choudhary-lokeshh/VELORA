'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformOperators } from '../../../src/product/operators';

/**
 * Who may operate this platform.
 *
 * The one screen whose own capability is unbounded, which is why it is its own
 * capability, held by one role, and why every grant carries a reason.
 */
export default function PlatformOperatorsPage() {
  return (
    <AdminGate title="Operators">
      <PlatformOperators />
    </AdminGate>
  );
}
