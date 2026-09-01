import {
  accountStanding,
  accountStandingLabels,
} from '@velora/consumer-client';
import { StyleSheet, View } from 'react-native';

import { useMediaAddressBook, useSession } from '../frame/providers';
import { portraitReferences, useMediaAddresses } from './imagery';
import { formatFullDate } from './locale';
import { Screen } from '../frame/shell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  ListRow,
  Notice,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { Icon, type IconName } from '../design/icons';
import type { YouSection } from '../frame/links';
import { color, space } from '../design/tokens';
import { profileMediaLabels, profileMediaState } from '@velora/consumer-client';

/**
 * You: the account, and everywhere that acts on it.
 *
 * The other four destinations are about other people, which is what the product
 * is for. This one holds the person's own profile, whether they are visible,
 * what VELORA has decided about their account, and how to leave — and it is a
 * hub of addresses rather than one long settings page, because a phone screen
 * cannot hold a long settings page and a person looking for one control should
 * not scroll past four they did not want.
 */

interface Entry {
  readonly caption: string;
  readonly icon: IconName;
  readonly id: YouSection;
  readonly label: string;
}

const entries: readonly Entry[] = [
  {
    caption:
      'Your name, what you say about yourself, and the languages you speak.',
    icon: 'user',
    id: 'profile',
    label: 'Profile',
  },
  {
    caption: 'Whether people can find you right now.',
    icon: 'compass',
    id: 'availability',
    label: 'Availability',
  },
  {
    caption: 'Clubs you have been let into, and anything you are paying for.',
    icon: 'lock',
    id: 'memberships',
    label: 'Memberships',
  },
  {
    caption: 'Gifts you have sent to creators, and what happened to each one.',
    icon: 'sparkle',
    id: 'gifts',
    label: 'Gifts',
  },
  {
    caption: 'Your balance and what you have spent it on.',
    icon: 'globe',
    id: 'wallet',
    label: 'Coins',
  },
  {
    caption: 'What VELORA tells you about, and where.',
    icon: 'bell',
    id: 'notices',
    label: 'Notices',
  },
  {
    caption: 'Who you have blocked, what you have reported, and your standing.',
    icon: 'shield',
    id: 'safety',
    label: 'Safety',
  },
  {
    caption: 'This device, your other devices, and signing out.',
    icon: 'lock',
    id: 'account',
    label: 'Account',
  },
];

export function YouScreen({
  onOpen,
}: {
  readonly onOpen: (id: YouSection) => void;
}) {
  const session = useSession();
  const { account, profile } = session.account;
  const current = account.value;
  const person = profile.value;
  const answered = !account.loading || current !== undefined;

  /*
   * The person's own photograph, asked for the same way every other card in
   * the product asks for somebody else's. Without this a person saw their
   * initials here while everybody in Discover had a face, which reads as
   * something being wrong with their account rather than as a design.
   */
  const book = useMediaAddressBook();
  /*
   * The first slot that is actually ready, not simply the first slot. A
   * person's own profile carries everything they have added, including one
   * still being checked and one that was refused, and asking for an address
   * for either mints a credential for an image nothing is going to render.
   */
  const ready = (person?.media ?? []).filter((item) => item.state === 'ready');
  const portraits = useMediaAddresses(
    portraitReferences(ready.length === 0 ? [] : [{ media: ready }]),
    'avatar_large',
  );
  const portrait = [...portraits.values()][0];
  const mediaState = profileMediaState(person);
  /*
   * Only once an exchange has actually happened, and only when there is
   * something it could have delivered. The same rule the photo screen uses,
   * for the same reason: before that, the honest state is "nothing to say
   * yet" rather than either claim.
   */
  const undeliverable = mediaState === 'ready' && book.deliveryUnavailable();
  /*
   * The contract's media labels are written for different slots: three end a
   * sentence ("Upload another.", "Checking the photo…") and three are a
   * fragment ("Image ready"). Ending one that already ends gives "Upload
   * another.." and "Checking the photo….", which read as a typo rather than
   * as a state.
   */
  const stated = /[.!?…]$/u.test(profileMediaLabels[mediaState])
    ? profileMediaLabels[mediaState]
    : `${profileMediaLabels[mediaState]}.`;

  return (
    <Screen
      onRefresh={session.account.reloadAll}
      refreshing={account.loading && current !== undefined}
      subtitle="Your account, and everything that acts on it."
      testID="you-screen"
      title="You"
    >
      <Stack gap={5}>
        {!answered ? (
          <Card>
            <RowSkeleton rows={1} />
          </Card>
        ) : account.error !== undefined && current === undefined ? (
          <ErrorState
            body={account.error}
            testID="account-failed"
            {...(account.retryable
              ? { onRetry: session.account.reloadAll }
              : {})}
          />
        ) : (
          <Card testID="you-identity">
            <View style={styles.identity}>
              <Avatar
                displayName={person?.displayName ?? 'You'}
                seed={current?.id ?? 'you'}
                size="large"
                source={portrait}
                testID="you-portrait"
              />
              <View style={styles.identityText}>
                <Text
                  accessibilityRole="header"
                  numberOfLines={2}
                  variant="heading"
                  weight="semibold"
                >
                  {person?.displayName ?? 'No display name yet'}
                </Text>
                {current === undefined ? null : (
                  <Badge
                    testID="account-standing"
                    tone={
                      accountStanding(current) === 'active'
                        ? 'positive'
                        : 'caution'
                    }
                  >
                    {accountStandingLabels[accountStanding(current)]}
                  </Badge>
                )}
              </View>
            </View>
          </Card>
        )}

        {/*
          What the server says about this person's own photograph, and nothing
          more than that. This used to assert that "nobody sees a photograph
          anywhere in the product" on every build, which is false wherever
          delivery is configured — the photograph was on the card above it and
          on every face in Discover while the sentence claimed otherwise. The
          platform-wide claim now appears only when the last exchange actually
          refused for that reason, which is the one condition under which it is
          true.
        */}
        <Notice testID="profile-media-state" title="Your photo">
          {undeliverable
            ? `${stated} This environment has no approved way to deliver an image, so it is stored and checked and shown nowhere — not yours and not anybody else's.`
            : stated}
        </Notice>

        <Card padded={false} testID="you-menu">
          <View style={styles.rows}>
            {entries.map((entry, index) => (
              <View key={entry.id}>
                {index === 0 ? null : <Divider />}
                <ListRow
                  leading={
                    <View style={styles.mark}>
                      <Icon
                        color={color.textSecondary}
                        name={entry.icon}
                        size="md"
                      />
                    </View>
                  }
                  onPress={() => {
                    onOpen(entry.id);
                  }}
                  testID={`you-${entry.id}`}
                >
                  <Text weight="medium">{entry.label}</Text>
                  <Text tone="tertiary" variant="caption">
                    {entry.caption}
                  </Text>
                </ListRow>
              </View>
            ))}
          </View>
        </Card>
      </Stack>
    </Screen>
  );
}

/**
 * The session, on this device and everywhere else.
 *
 * "Sign out everywhere" is a real and separate control rather than a variant of
 * the first. Somebody who has lost a phone needs to end every session and not
 * only the one in their hand, and burying that behind the ordinary sign-out
 * would be burying the one control that matters in that moment.
 */
export function AccountScreen({ onBack }: { readonly onBack: () => void }) {
  const session = useSession();
  const current = session.account.account.value;

  return (
    <Screen
      onBack={onBack}
      subtitle="This device, your other devices, and leaving."
      testID="account-screen"
      title="Account"
    >
      <Stack gap={5}>
        <Card>
          <Stack gap={3}>
            <Text variant="subheading" weight="semibold">
              This device
            </Text>
            <Text tone="secondary" variant="small">
              VELORA keeps this device signed in until you sign out or the
              session ends. The token is held in the platform keystore and never
              leaves it.
            </Text>
            {current === undefined ? null : (
              <Text testID="account-created" tone="tertiary" variant="caption">
                {`Account opened ${formatFullDate(current.createdAt)}`}
              </Text>
            )}
          </Stack>
        </Card>

        <Stack gap={3}>
          <Button
            busy={session.busy}
            icon="logOut"
            onPress={session.signOut}
            testID="auth-sign-out"
            tone="secondary"
            wide
          >
            Sign out on this device
          </Button>
          <Button
            busy={session.busy}
            icon="lock"
            onPress={session.signOutEverywhere}
            testID="auth-sign-out-everywhere"
            tone="danger"
            wide
          >
            Sign out everywhere
          </Button>
          <Text tone="tertiary" variant="caption">
            Signing out everywhere ends every session on every device, including
            this one. Use it if you have lost a device.
          </Text>
        </Stack>

        {/*
          Closing an account is defined in `docs/flows/account-deletion.md` and
          has no route on any surface, because every retention schedule it
          depends on is an open legal decision. Saying so is better than a
          control that would refuse.
        */}
        <Notice
          testID="account-closure-unavailable"
          title="Closing your account is not finished yet"
          tone="neutral"
        >
          VELORA cannot delete an account from here yet. What is kept, and for
          how long, is still being decided, and building the control before that
          answer exists would mean deleting under a rule nobody has approved.
        </Notice>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[4],
  },
  identityText: { alignItems: 'flex-start', flex: 1, gap: space[2] },
  mark: {
    alignItems: 'center',
    backgroundColor: color.surface3,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rows: { paddingHorizontal: space[4] },
});
