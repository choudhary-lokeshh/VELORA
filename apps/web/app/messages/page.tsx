'use client';

import { AppGate } from '../../src/app/gate';
import {
  MessagesLayout,
  NoConversationSelected,
} from '../../src/product/conversations';

export default function MessagesPage() {
  return (
    <AppGate title="Messages">
      <MessagesLayout>
        <NoConversationSelected />
      </MessagesLayout>
    </AppGate>
  );
}
