'use client';

import { useParams } from 'next/navigation';

import { AdminGate } from '../../../src/app/gate';
import { AccountDetailScreen } from '../../../src/product/account';

/**
 * One account, in operational terms.
 *
 * Reached from the accounts list, from a search, from an encounter, and from
 * almost every row of the activity stream — because "who is this" is the second
 * question an operator asks about anything.
 */
export default function AccountPage() {
  const parameters = useParams<{ accountId: string }>();
  return (
    <AdminGate title="Account">
      <AccountDetailScreen accountId={parameters.accountId} />
    </AdminGate>
  );
}
