import { router, useLocalSearchParams } from 'expo-router';

import { creatorPath } from '../../../../src/frame/links';
import { leave } from '../../../../src/frame/navigation';
import { ClubScreen } from '../../../../src/product/creator';

/**
 * One club, as its own address.
 *
 * The declared parent is the creator's own page rather than a truncation of
 * this path: `/c/<handle>/club` is not an address this application serves, and
 * a Back that lands on one is a perfectly valid link until somebody follows it.
 */
export default function ClubRoute() {
  const { handle, slug } = useLocalSearchParams<{
    handle: string;
    slug: string;
  }>();
  return (
    <ClubScreen
      handle={handle}
      onBack={() => {
        leave(router, creatorPath(handle));
      }}
      slug={slug}
    />
  );
}
