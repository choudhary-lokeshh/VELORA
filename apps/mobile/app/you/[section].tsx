import { router, useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

import {
  creatorPath,
  discoverPath,
  youPath,
  type YouSection,
} from '../../src/frame/links';
import { leave } from '../../src/frame/navigation';
import { Screen } from '../../src/frame/shell';
import { Button, EmptyState } from '../../src/design/primitives';
import {
  AvailabilityScreen,
  NoticePreferencesScreen,
  ProfileScreen,
} from '../../src/product/profile';
import { SentGiftsScreen } from '../../src/product/gifts';
import { MembershipsScreen } from '../../src/product/memberships';
import { SafetyScreen } from '../../src/product/safety';
import { SupportScreen } from '../../src/product/support';
import { WalletScreen } from '../../src/product/wallet';
import { AccountScreen } from '../../src/product/you';

/**
 * The screens under You, one address each.
 *
 * One route rather than one file each, because they are leaves of the same menu
 * and the alternative is a set of identical wrappers. An unknown section is a
 * dead link rather than a crash.
 *
 * A record keyed by `YouSection` rather than a switch, so this cannot become the
 * third copy of the section list that disagrees with the other two. It has
 * happened twice: the deep-link parser kept a private copy and refused
 * `you/memberships` for the days between that screen shipping and somebody
 * noticing, and the parser served no creator address at all while both creator
 * screens existed and were reachable by tapping. A switch would compile
 * perfectly with a section missing; a missing key here does not compile.
 *
 * `section` is still a bare string, because it arrives off an address rather
 * than from this module, so the lookup is a lookup and an unrecognised value
 * still lands on the dead-link screen below.
 */
const screens: Readonly<
  Record<YouSection, (onBack: () => void) => ReactElement>
> = {
  account: (onBack) => <AccountScreen onBack={onBack} />,
  availability: (onBack) => <AvailabilityScreen onBack={onBack} />,
  gifts: (onBack) => (
    <SentGiftsScreen
      onBack={onBack}
      onOpenCreator={(handle) => {
        router.push(creatorPath(handle));
      }}
      onOpenCreators={() => {
        router.push(`${discoverPath}?show=creators`);
      }}
    />
  ),
  help: (onBack) => <SupportScreen onBack={onBack} />,
  memberships: (onBack) => (
    <MembershipsScreen
      onBack={onBack}
      onOpenClub={(path) => {
        router.push(path);
      }}
    />
  ),
  notices: (onBack) => <NoticePreferencesScreen onBack={onBack} />,
  profile: (onBack) => <ProfileScreen onBack={onBack} />,
  safety: (onBack) => <SafetyScreen onBack={onBack} />,
  wallet: (onBack) => <WalletScreen onBack={onBack} />,
};

export default function YouSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const onBack = () => {
    leave(router, youPath);
  };

  const screen = Object.hasOwn(screens, section)
    ? screens[section as YouSection]
    : undefined;
  return screen === undefined ? (
    <Screen onBack={onBack} testID="you-unknown" title="Not here">
      <EmptyState
        action={
          <Button onPress={onBack} testID="you-unknown-back" tone="primary">
            Back to You
          </Button>
        }
        body="That link does not lead anywhere under You."
        icon="user"
        title="That page is not here"
      />
    </Screen>
  ) : (
    screen(onBack)
  );
}
