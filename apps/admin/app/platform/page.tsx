'use client';

import { AdminGate } from '../../src/app/gate';
import { PlatformMedia } from '../../src/product/platform';

export default function PlatformPage() {
  return (
    <AdminGate title="Media">
      <PlatformMedia />
    </AdminGate>
  );
}
