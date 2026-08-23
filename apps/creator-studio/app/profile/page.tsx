'use client';

import { StudioGate } from '../../src/app/gate';
import { ProfileScreen } from '../../src/product/profile';

export default function ProfilePage() {
  return (
    <StudioGate narrow title="Public page">
      <ProfileScreen />
    </StudioGate>
  );
}
