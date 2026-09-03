'use client';

import { AppGate } from '../../../src/app/gate';
import { Support } from '../../../src/product/support';

export default function HelpPage() {
  return (
    <AppGate narrow title="Help">
      <Support />
    </AppGate>
  );
}
