'use client';

import { AdminGate } from '../../src/app/gate';
import { Overview } from '../../src/product/overview';

export default function OverviewPage() {
  return (
    <AdminGate title="Overview">
      <Overview />
    </AdminGate>
  );
}
