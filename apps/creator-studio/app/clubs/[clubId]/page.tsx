'use client';

import { useParams } from 'next/navigation';

import { StudioGate } from '../../../src/app/gate';
import { ClubScreen } from '../../../src/product/club';

export default function ClubPage() {
  const parameters = useParams<{ clubId: string }>();
  const clubId = parameters.clubId;
  return (
    <StudioGate title="Club">
      <ClubScreen clubId={clubId} />
    </StudioGate>
  );
}
