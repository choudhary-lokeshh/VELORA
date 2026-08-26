import { router } from 'expo-router';

import { conversationPath, introductionsPath } from '../../src/frame/links';
import { NoticesScreen } from '../../src/product/notices';

export default function Notices() {
  return (
    <NoticesScreen
      onOpenConversation={(conversationId) => {
        router.push(conversationPath(conversationId));
      }}
      onOpenIntroductions={() => {
        router.push(introductionsPath);
      }}
    />
  );
}
