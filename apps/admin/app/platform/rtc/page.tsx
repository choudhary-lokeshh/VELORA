'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformRtc } from '../../../src/product/platform';

export default function PlatformRtcPage() {
  return (
    <AdminGate title="Calling">
      <PlatformRtc />
    </AdminGate>
  );
}
