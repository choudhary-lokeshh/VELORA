'use client';

import { useParams } from 'next/navigation';

import { AdminGate } from '../../../../src/app/gate';
import { LiveEncounterScreen } from '../../../../src/product/live-ops';

/**
 * One encounter: state, health, and what followed from it.
 *
 * There is no media on this screen and no route from it to any. Watching
 * somebody's call is not a feature this product has.
 */
export default function LiveEncounterPage() {
  const parameters = useParams<{ encounterId: string }>();
  return (
    <AdminGate title="Encounter">
      <LiveEncounterScreen encounterId={parameters.encounterId} />
    </AdminGate>
  );
}
