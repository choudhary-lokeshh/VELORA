'use client';

import { StudioGate } from '../../src/app/gate';
import { Catalog } from '../../src/product/catalog';

export default function CatalogPage() {
  return (
    <StudioGate title="Catalog">
      <Catalog />
    </StudioGate>
  );
}
