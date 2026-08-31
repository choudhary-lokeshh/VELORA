import { router } from 'expo-router';

import { conversationPath, personPath } from '../../src/frame/links';
import { LiveScreen } from '../../src/product/live';

/**
 * Live discovery, the first tab and the primary destination.
 *
 * The screen owns no router. Continuing a mutual connection in the Inbox and
 * opening the person somebody just met are both navigations, and both are
 * decided here so the screen stays testable without one.
 */
export default function Live() {
  return (
    <LiveScreen
      onOpenConversation={(conversationId) => {
        router.push(conversationPath(conversationId));
      }}
      onOpenPerson={(personId) => {
        router.push(personPath(personId));
      }}
    />
  );
}
