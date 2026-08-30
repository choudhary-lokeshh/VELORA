'use client';

import { Suspense } from 'react';

import { StudioGate } from '../../src/app/gate';
import { Catalog } from '../../src/product/catalog';

/**
 * The catalog keeps its filter in the address, which makes reading it
 * client-only; the boundary is explicit so the rest of the route can still be
 * prerendered.
 */
export default function CatalogPage() {
  return (
    <StudioGate title="Catalog">
      <Suspense fallback={null}>
        <Catalog />
      </Suspense>
    </StudioGate>
  );
}
