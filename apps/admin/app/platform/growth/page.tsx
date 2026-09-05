'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformGrowth } from '../../../src/product/growth';

/**
 * Acquisition, as an operations screen rather than a growth dashboard.
 *
 * It reports counts GROWTH owns and offers the two acts only an operator can
 * perform — scheduling a live window and withdrawing one. Nothing here names a
 * person, ranks anybody, or reports a rate.
 */
export default function PlatformGrowthPage() {
  return (
    <AdminGate title="Growth">
      <PlatformGrowth />
    </AdminGate>
  );
}
