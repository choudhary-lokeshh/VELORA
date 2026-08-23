'use client';

import { AdminGate } from '../../src/app/gate';
import { PageHeader } from '../../src/design/primitives';
import { Queues } from '../../src/product/queues';

export default function QueuesPage() {
  return (
    <AdminGate title="Queues">
      <PageHeader
        lede="Cases the platform has opened, in the queue that owns them. Nothing here names anybody."
        title="Queues"
      />
      <Queues />
    </AdminGate>
  );
}
