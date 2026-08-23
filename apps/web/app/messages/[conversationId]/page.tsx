'use client';

import { use } from 'react';

import { AppGate } from '../../../src/app/gate';
import {
  ConversationThread,
  MessagesLayout,
} from '../../../src/product/conversations';

/**
 * One conversation, addressed rather than selected.
 *
 * The identifier is in the address, so the browser's Back leaves the
 * conversation, a link to it can be shared between this person's own devices,
 * and a notice about a message can open the thread it is about.
 */
export default function ConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly conversationId: string }>;
}) {
  const { conversationId } = use(params);
  return (
    <AppGate title="Messages">
      <MessagesLayout selectedId={conversationId}>
        <ConversationThread conversationId={conversationId} />
      </MessagesLayout>
    </AppGate>
  );
}
