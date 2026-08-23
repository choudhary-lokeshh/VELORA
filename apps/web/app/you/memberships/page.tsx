'use client';

import { AppGate } from '../../../src/app/gate';
import { Memberships } from '../../../src/product/memberships';

export default function MembershipsPage() {
  return (
    <AppGate narrow title="Memberships">
      <Memberships />
    </AppGate>
  );
}
