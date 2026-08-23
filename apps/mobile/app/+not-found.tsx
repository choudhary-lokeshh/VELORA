import { router } from 'expo-router';

import { discoverPath } from '../src/frame/links';

import { Screen } from '../src/frame/shell';
import { Button, EmptyState } from '../src/design/primitives';

/**
 * An address this application does not have.
 *
 * Reached by a deep link that is wrong, stale, or for a build that no longer
 * has the route. It says the address is unknown and offers the way back, and it
 * deliberately reveals nothing about whether the object behind the link exists
 * — a "that conversation is private" page is an existence oracle.
 */
export default function NotFoundScreen() {
  return (
    <Screen testID="not-found" title="Not here">
      <EmptyState
        action={
          <Button
            icon="arrowLeft"
            onPress={() => {
              router.replace(discoverPath);
            }}
            testID="not-found-back"
            tone="primary"
          >
            Back to Discover
          </Button>
        }
        body="That link does not lead anywhere in VELORA. It may have been for something that has since gone."
        icon="compass"
        title="That page is not here"
      />
    </Screen>
  );
}
