'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformControls } from '../../../src/product/controls';

/**
 * The switches the platform obeys.
 *
 * Every one of them is read by server code on the path it governs, so this
 * screen changes what the API does rather than what the console draws.
 */
export default function PlatformControlsPage() {
  return (
    <AdminGate title="Controls">
      <PlatformControls />
    </AdminGate>
  );
}
