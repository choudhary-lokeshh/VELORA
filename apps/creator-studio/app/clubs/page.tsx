'use client';

import { StudioGate } from '../../src/app/gate';
import { Clubs } from '../../src/product/clubs';

export default function ClubsPage() {
  return (
    <StudioGate title="Private clubs">
      <Clubs />
    </StudioGate>
  );
}
