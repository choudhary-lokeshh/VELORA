'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformLive } from '../../../src/product/live-ops';

/**
 * The matching pool in operational terms.
 *
 * No "users online" here: nothing can know it truthfully, and a made-up figure
 * would make every honest number beside it worth less.
 */
export default function PlatformLivePage() {
  return (
    <AdminGate title="Live">
      <PlatformLive />
    </AdminGate>
  );
}
