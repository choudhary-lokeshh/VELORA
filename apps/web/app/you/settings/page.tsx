'use client';

import { AppGate } from '../../../src/app/gate';
import { Settings } from '../../../src/product/settings';

export default function SettingsPage() {
  return (
    <AppGate narrow title="Settings">
      <Settings />
    </AppGate>
  );
}
