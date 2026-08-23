'use client';

import { AppGate } from '../../src/app/gate';
import { Notifications } from '../../src/product/notifications';

export default function NotificationsPage() {
  return (
    <AppGate title="Notices">
      <Notifications />
    </AppGate>
  );
}
