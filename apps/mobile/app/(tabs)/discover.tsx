import { router, useLocalSearchParams } from 'expo-router';

import { creatorPath, youPath } from '../../src/frame/links';
import { personPath } from '../../src/frame/links';
import {
  DiscoverScreen,
  type DiscoverSection,
} from '../../src/product/discover';

/**
 * Discovery, in two halves that live in the address.
 *
 * Which section is being read travels as `?show=`, the same name Consumer Web
 * uses, so Back, a relaunch, and a deep link all restore the half somebody
 * was actually browsing. `setParams` rather than `push`: switching halves is
 * not a navigation anybody expects to unwind one press at a time.
 */
export default function Discover() {
  const { show } = useLocalSearchParams<{ show?: string }>();
  const section: DiscoverSection = show === 'creators' ? 'creators' : 'people';
  return (
    <DiscoverScreen
      onOpenCreator={(handle) => {
        router.push(creatorPath(handle));
      }}
      onOpenPerson={(personId) => {
        router.push(personPath(personId));
      }}
      onOpenYou={() => {
        router.push(youPath);
      }}
      onSection={(next) => {
        router.setParams({
          show: next === 'creators' ? 'creators' : undefined,
        });
      }}
      section={section}
    />
  );
}
