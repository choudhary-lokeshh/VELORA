import { router, useLocalSearchParams } from 'expo-router';

import { discoverPath } from '../../src/frame/links';
import { leave } from '../../src/frame/navigation';
import { PersonScreen } from '../../src/product/person';

/**
 * One person, as their own address.
 *
 * The identifier in the path buys nothing on its own. It goes to the server,
 * which decides on that request whether this reader may be shown anything at
 * all — so somebody who does not exist and somebody this reader may not see
 * come back identically, which is the required behaviour: telling the two
 * apart would disclose that the person exists.
 *
 * Discover is the parent, because a person is opened from it and there is no
 * listing of people to return to. A decision made here lands there too, since
 * the person it was about is no longer somebody to decide about.
 */
export default function Person() {
  const { personId } = useLocalSearchParams<{ personId: string }>();

  return (
    <PersonScreen
      onBack={() => {
        leave(router, discoverPath);
      }}
      onLeave={() => {
        // A decision leaves the way Back leaves: pop to wherever this person
        // was opened from — Discover, or the live encounter still running —
        // and fall back to Discover only when a deep link put nothing behind
        // this screen. Replacing unconditionally ejected a live encounter's
        // reader into a feed they had not been reading.
        leave(router, discoverPath);
      }}
      personId={personId}
    />
  );
}
