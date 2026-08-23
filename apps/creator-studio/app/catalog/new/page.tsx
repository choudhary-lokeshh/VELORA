'use client';

import { StudioGate } from '../../../src/app/gate';
import { NewContent } from '../../../src/product/content-editor';

export default function NewContentPage() {
  return (
    <StudioGate narrow title="New draft">
      <NewContent />
    </StudioGate>
  );
}
