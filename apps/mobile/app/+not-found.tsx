import { router } from 'expo-router';

import { livePath } from '../src/frame/links';
import { leave } from '../src/frame/navigation';
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
  // Pop when there is somewhere to pop to — a wrong link followed from inside
  // the product should hand back the screen it was followed from, scrolled
  // where it was. The fallback for a cold start is Live, which is where a
  // launch lands, rather than a feed this person never chose.
  const back = () => {
    leave(router, livePath);
  };
  return (
    <Screen onBack={back} testID="not-found" title="Not here">
      <EmptyState
        action={
          <Button
            icon="arrowLeft"
            onPress={back}
            testID="not-found-back"
            tone="primary"
          >
            Go back
          </Button>
        }
        body="That link does not lead anywhere in VELORA. It may have been for something that has since gone."
        icon="compass"
        title="That page is not here"
      />
    </Screen>
  );
}
