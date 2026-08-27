import { router, useLocalSearchParams } from 'expo-router';

import { messagesPath } from '../../src/frame/links';
import { leave } from '../../src/frame/navigation';
import { ConversationScreen } from '../../src/product/conversation';

/**
 * One conversation, as its own address.
 *
 * The identifier in the path buys nothing on its own: the screen reads the
 * conversations this account holds and finds it there, so a link to somebody
 * else's conversation renders "not here" without the server being asked
 * anything that could confirm it exists.
 */
export default function Conversation() {
  const { conversationId } = useLocalSearchParams<{
    conversationId: string;
  }>();

  return (
    <ConversationScreen
      conversationId={conversationId}
      onBack={() => {
        leave(router, messagesPath);
      }}
    />
  );
}
