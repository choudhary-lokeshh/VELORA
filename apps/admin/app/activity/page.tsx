'use client';

import { AdminGate } from '../../src/app/gate';
import { ActivityScreen } from '../../src/product/activity';

/**
 * What has been happening, composed from the domains that own each record.
 *
 * A destination rather than a panel on Overview, because an operator working an
 * incident lives in this screen — filtering, paging, narrowing — for as long as
 * the incident lasts.
 */
export default function ActivityPage() {
  return (
    <AdminGate title="Activity">
      <ActivityScreen />
    </AdminGate>
  );
}
