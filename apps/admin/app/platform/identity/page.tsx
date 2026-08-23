'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformIdentity } from '../../../src/product/platform';

export default function PlatformIdentityPage() {
  return (
    <AdminGate title="Identity">
      <PlatformIdentity />
    </AdminGate>
  );
}
