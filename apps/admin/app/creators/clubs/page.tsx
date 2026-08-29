'use client';

import { AdminGate } from '../../../src/app/gate';
import { PageHeader } from '../../../src/design/primitives';
import { CreatorNav } from '../../../src/product/creators';
import { Clubs } from '../../../src/product/clubs';

export default function ClubsPage() {
  return (
    <AdminGate title="Clubs">
      <PageHeader
        lede="The clubs creators sell, with how many memberships each holds. No member appears anywhere on this console."
        title="Clubs"
      />
      <CreatorNav />
      <Clubs />
    </AdminGate>
  );
}
