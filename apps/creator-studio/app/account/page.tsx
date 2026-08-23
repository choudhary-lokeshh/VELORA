'use client';

import { StudioGate } from '../../src/app/gate';
import { Account } from '../../src/product/account';

export default function AccountPage() {
  return (
    <StudioGate narrow title="Account">
      <Account />
    </StudioGate>
  );
}
