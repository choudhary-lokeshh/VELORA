import { router } from 'expo-router';

import { personPath } from '../../src/frame/links';
import { DiscoverScreen } from '../../src/product/discover';

export default function Discover() {
  return (
    <DiscoverScreen
      onOpenPerson={(personId) => {
        router.push(personPath(personId));
      }}
    />
  );
}
