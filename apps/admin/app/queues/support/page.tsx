'use client';

import { AdminGate } from '../../../src/app/gate';
import { Support } from '../../../src/product/support';

export default function SupportPage() {
  return (
    <AdminGate title="Support">
      <Support />
    </AdminGate>
  );
}
