'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformSecurity } from '../../../src/product/platform';

export default function PlatformSecurityPage() {
  return (
    <AdminGate title="Security">
      <PlatformSecurity />
    </AdminGate>
  );
}
