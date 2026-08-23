'use client';

import { AppGate } from '../../src/app/gate';
import { Discovery } from '../../src/product/discovery';

export default function DiscoverPage() {
  return (
    <AppGate title="Discover">
      <Discovery />
    </AppGate>
  );
}
