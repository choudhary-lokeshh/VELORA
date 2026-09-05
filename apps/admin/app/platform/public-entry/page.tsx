'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformPublicEntry } from '../../../src/product/public-entry';

/**
 * Whether VELORA has a way in, and what is behind it.
 *
 * Both conditions that decide indexability are shown, because "not indexed" and
 * "indexed, and nobody is coming" need completely different responses.
 */
export default function PlatformPublicEntryPage() {
  return (
    <AdminGate title="Public entry">
      <PlatformPublicEntry />
    </AdminGate>
  );
}
