'use client';

import { AppGate } from '../../src/app/gate';
import { You } from '../../src/product/profile';

export default function YouPage() {
  return (
    <AppGate narrow title="You">
      <You />
    </AppGate>
  );
}
