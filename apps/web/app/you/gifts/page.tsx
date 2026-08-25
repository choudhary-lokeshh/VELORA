'use client';

import { AppGate } from '../../../src/app/gate';
import { SentGifts } from '../../../src/product/gifts';

export default function SentGiftsPage() {
  return (
    <AppGate narrow title="Sent gifts">
      <SentGifts />
    </AppGate>
  );
}
