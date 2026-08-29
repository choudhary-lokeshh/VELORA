'use client';

import { AdminGate } from '../../src/app/gate';
import { Accounts } from '../../src/product/accounts';

export default function AccountsPage() {
  return (
    <AdminGate title="Accounts">
      <Accounts />
    </AdminGate>
  );
}
