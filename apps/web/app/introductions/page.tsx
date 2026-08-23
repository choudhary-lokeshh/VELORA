'use client';

import { AppGate } from '../../src/app/gate';
import { Introductions } from '../../src/product/introductions';

export default function IntroductionsPage() {
  return (
    <AppGate title="Introductions">
      <Introductions />
    </AppGate>
  );
}
