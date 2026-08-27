import { router, useLocalSearchParams } from 'expo-router';

import { discoverPath } from '../../../src/frame/links';
import { leave } from '../../../src/frame/navigation';
import { CreatorScreen } from '../../../src/product/creator';

/**
 * A creator's public page.
 *
 * Reachable by deep link, which is why leaving it has an explicit parent: a
 * cold start on this address has nothing behind it, and popping an empty stack
 * on Android closes the application instead of leaving the screen.
 */
export default function CreatorRoute() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return (
    <CreatorScreen
      handle={handle}
      onBack={() => {
        leave(router, discoverPath);
      }}
      onOpenClub={(path) => {
        router.push(path);
      }}
    />
  );
}
