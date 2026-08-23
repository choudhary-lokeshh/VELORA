'use client';

import { AdminGate } from '../../../src/app/gate';
import { Appeals } from '../../../src/product/appeals';

export default function AppealsPage() {
  return (
    <AdminGate title="Appeals">
      <Appeals />
    </AdminGate>
  );
}
