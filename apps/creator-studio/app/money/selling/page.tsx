'use client';

import { StudioGate } from '../../../src/app/gate';
import { Selling } from '../../../src/product/selling';

export default function SellingPage() {
  return (
    <StudioGate title="Selling">
      <Selling />
    </StudioGate>
  );
}
