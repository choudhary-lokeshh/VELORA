'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AdminGate, Bootstrap } from '../../src/app/gate';
import { Creators } from '../../src/product/creators';

function CreatorsView() {
  const parameters = useSearchParams();
  const selected = parameters.get('selected');
  return <Creators selectedId={selected ?? undefined} />;
}

/**
 * The selected creator lives in the address so a case that names a target can
 * be followed here and the browser's Back still works. `useSearchParams` makes
 * this subtree client-only, so the boundary is explicit.
 */
export default function CreatorsPage() {
  return (
    <AdminGate title="Creators">
      <Suspense fallback={<Bootstrap />}>
        <CreatorsView />
      </Suspense>
    </AdminGate>
  );
}
