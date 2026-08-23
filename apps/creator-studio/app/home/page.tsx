'use client';

import { StudioGate } from '../../src/app/gate';
import { Home } from '../../src/product/home';

export default function HomePage() {
  return (
    <StudioGate title="Home">
      <Home />
    </StudioGate>
  );
}
