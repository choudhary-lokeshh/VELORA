'use client';

import { AdminGate } from '../../../src/app/gate';
import { PageHeader } from '../../../src/design/primitives';
import { Audit } from '../../../src/product/audit';
import { QueueNav } from '../../../src/product/queues';

export default function DecisionsPage() {
  return (
    <AdminGate title="Decisions">
      <PageHeader
        eyebrow="Queues"
        lede="Every decision the platform has settled, newest first, with the operator session that made each. Nothing here names an operator or a subject."
        title="Decisions"
      />
      <QueueNav />
      <Audit
        emptyBody="No case has been decided on this platform."
        emptyTitle="Nothing decided"
        lede="What was done, under which reason, against which kind of target."
        stream="decision"
        title="Settled decisions"
      />
    </AdminGate>
  );
}
