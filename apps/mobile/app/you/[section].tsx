import { router, useLocalSearchParams } from 'expo-router';

import { youPath } from '../../src/frame/links';
import { leave } from '../../src/frame/navigation';
import { Screen } from '../../src/frame/shell';
import { Button, EmptyState } from '../../src/design/primitives';
import {
  AvailabilityScreen,
  NoticePreferencesScreen,
  ProfileScreen,
} from '../../src/product/profile';
import { SafetyScreen } from '../../src/product/safety';
import { AccountScreen } from '../../src/product/you';

/**
 * The screens under You, one address each.
 *
 * One route rather than five files because they are five leaves of the same
 * menu and the alternative is five identical wrappers. An unknown section is a
 * dead link rather than a crash.
 */
export default function YouSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const onBack = () => {
    leave(router, youPath);
  };

  switch (section) {
    case 'account': {
      return <AccountScreen onBack={onBack} />;
    }
    case 'availability': {
      return <AvailabilityScreen onBack={onBack} />;
    }
    case 'notices': {
      return <NoticePreferencesScreen onBack={onBack} />;
    }
    case 'profile': {
      return <ProfileScreen onBack={onBack} />;
    }
    case 'safety': {
      return <SafetyScreen onBack={onBack} />;
    }
    default: {
      return (
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
      );
    }
  }
}
