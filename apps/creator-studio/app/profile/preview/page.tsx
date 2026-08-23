'use client';

import { StudioGate } from '../../../src/app/gate';
import { PublicPreview } from '../../../src/product/preview';

export default function PreviewPage() {
  return (
    <StudioGate narrow title="Preview">
      <PublicPreview />
    </StudioGate>
  );
}
