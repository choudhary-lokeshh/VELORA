'use client';

import { StudioGate } from '../../../src/app/gate';
import { ReceivedGifts } from '../../../src/product/gifts';

export default function ReceivedGiftsPage() {
  return (
    <StudioGate title="Received gifts">
      <ReceivedGifts />
    </StudioGate>
  );
}
