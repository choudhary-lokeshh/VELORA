'use client';

import { AdminGate } from '../../../src/app/gate';
import { PlatformNotifications } from '../../../src/product/platform';

export default function PlatformNotificationsPage() {
  return (
    <AdminGate title="Notifications">
      <PlatformNotifications />
    </AdminGate>
  );
}
