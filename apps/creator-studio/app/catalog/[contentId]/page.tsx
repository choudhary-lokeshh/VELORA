'use client';

import { useParams } from 'next/navigation';

import { StudioGate } from '../../../src/app/gate';
import { EditContent } from '../../../src/product/content-editor';

export default function ContentPage() {
  const parameters = useParams<{ contentId: string }>();
  const contentId = parameters.contentId;
  return (
    <StudioGate narrow title="Item">
      <EditContent contentId={contentId} />
    </StudioGate>
  );
}
