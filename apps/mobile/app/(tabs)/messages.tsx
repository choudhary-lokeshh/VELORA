import { router } from 'expo-router';

import { conversationPath, introductionsPath } from '../../src/frame/links';
import { MessagesScreen } from '../../src/product/messages';

export default function Messages() {
  return (
    <MessagesScreen
      onOpen={(conversationId) => {
        router.push(conversationPath(conversationId));
      }}
      onOpenIntroductions={() => {
        router.push(introductionsPath);
      }}
    />
  );
}
