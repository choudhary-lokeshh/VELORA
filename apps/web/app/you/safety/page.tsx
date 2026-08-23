'use client';

import { AppGate } from '../../../src/app/gate';
import { Safety } from '../../../src/product/safety';

export default function SafetyPage() {
  return (
    <AppGate narrow title="Safety">
      <Safety />
    </AppGate>
  );
}
