import { router } from 'expo-router';

import { conversationPath } from '../../src/frame/links';
import { MessagesScreen } from '../../src/product/messages';

export default function Messages() {
  return (
    <MessagesScreen
      onOpen={(conversationId) => {
        router.push(conversationPath(conversationId));
      }}
    />
  );
}
