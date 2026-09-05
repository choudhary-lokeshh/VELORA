import type { Metadata } from 'next';
import { AppGate } from '../../../src/app/gate';
import {
  ConversationThread,
  MessagesLayout,
} from '../../../src/product/conversations';
import { privateMetadata } from '../../../src/seo/metadata';

/**
 * A real name for a browser tab and a history entry, and a refusal for
 * everything else.
 *
 * `noindex` is stated here as well as in the response header the middleware
 * stamps, because the two are read by different crawlers at different
 * moments and neither is worth relying on alone. Nothing behind this address
 * is visible without a session in any case; this is what stops it appearing
 * in a results page as a title with a sign-in form under it.
 */
export const metadata: Metadata = privateMetadata('Messages');

/**
 * One conversation, addressed rather than selected.
 *
 * The identifier is in the address, so the browser's Back leaves the
 * conversation, a link to it can be shared between this person's own devices,
 * and a notice about a message can open the thread it is about.
 */
export default async function ConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <AppGate title="Messages">
      <MessagesLayout selectedId={conversationId}>
        <ConversationThread conversationId={conversationId} />
      </MessagesLayout>
    </AppGate>
  );
}
