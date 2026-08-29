'use client';

import { useParams } from 'next/navigation';

import { AdminGate } from '../../../../src/app/gate';
import { ClubScreen } from '../../../../src/product/clubs';

export default function ClubPage() {
  const parameters = useParams<{ clubId: string }>();
  return (
    <AdminGate title="Club">
      <ClubScreen clubId={parameters.clubId} />
    </AdminGate>
  );
}
