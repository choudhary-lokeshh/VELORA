import type { NotificationPreference } from '@velora/consumer-client';
import {
  availabilityLabels,
  availabilityView,
  failureMessage,
} from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApi, useSession, useToast } from '../frame/providers';
import { openApplicationSettings } from '../device/permissions';
import { Screen } from '../frame/shell';
import {
  Badge,
  BlockedState,
  Button,
  Card,
  Divider,
  ErrorState,
  Field,
  Inline,
  Notice,
  RowSkeleton,
  Stack,
  Switch,
  Text,
  TextField,
} from '../design/primitives';
import { languageName } from './locale';
import { ProfilePhotos } from './photos';
import { MobileAiAssist } from './ai-assist';
import {
  useResource,
  useRevalidateOnForeground,
  useSingleFlight,
} from './resource';

/**
 * The three screens under You that change something about the person.
 *
 * Each is one address holding one decision, because a phone cannot show a long
 * settings page and somebody looking for one control should not scroll past
 * four they did not want.
 */

/* =============================== Profile ============================= */

/** The bound the contract publishes for a bio. */
const maximumBio = 500;

export function ProfileScreen({ onBack }: { readonly onBack: () => void }) {
  const api = useApi();
  const session = useSession();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const profile = session.account.profile;
  const held = profile.value;

  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [bio, setBio] = useState<string | undefined>(undefined);

  // Held only once somebody types. Until then the server's value is what is
  // shown, so a profile edited on another device is not overwritten by a stale
  // draft this screen was holding.
  const name = displayName ?? held?.displayName ?? '';
  const about = bio ?? held?.bio ?? '';
  const nameTooLong = name.trim().length > 80;
  const bioTooLong = about.trim().length > maximumBio;
  const changed =
    (displayName !== undefined && name !== (held?.displayName ?? '')) ||
    (bio !== undefined && about !== (held?.bio ?? ''));

  return (
    <Screen
      onBack={onBack}
      subtitle="What other people see. A photograph can be added; none is displayed anywhere yet."
      testID="profile-screen"
      title="Profile"
    >
      {profile.loading && held === undefined ? (
        <Card>
          <RowSkeleton rows={2} />
        </Card>
      ) : profile.error !== undefined && held === undefined ? (
        <ErrorState
          body={profile.error}
          testID="profile-failed"
          {...(profile.retryable ? { onRetry: profile.reload } : {})}
        />
      ) : (
        <Stack gap={5}>
          <Card>
            <Stack gap={4}>
              <Field
                error={
                  nameTooLong ? 'That is longer than a name can be.' : undefined
                }
                hint="How you appear everywhere in VELORA."
                label="Display name"
                testID="profile-name-field"
              >
                {(control) => (
                  <TextField
                    {...control}
                    invalid={nameTooLong}
                    onChangeText={setDisplayName}
                    testID="profile-name"
                    value={name}
                  />
                )}
              </Field>

              <Field
                count={{ current: about.trim().length, maximum: maximumBio }}
                error={
                  bioTooLong ? 'That is longer than a bio can be.' : undefined
                }
                hint="Optional. A few lines about you."
                label="About you"
                testID="profile-bio-field"
              >
                {(control) => (
                  <TextField
                    {...control}
                    invalid={bioTooLong}
                    multiline
                    onChangeText={setBio}
                    testID="profile-bio"
                    value={about}
                  />
                )}
              </Field>

              <MobileAiAssist
                capability="consumer_profile_bio"
                draft={about}
                onReplace={setBio}
                testID="profile-ai"
              />

              <Button
                busy={busy}
                disabled={!changed || nameTooLong || bioTooLong}
                icon="check"
                onPress={() => {
                  run(async () => {
                    const result = await api.saveProfile({
                      ...(about.trim().length === 0
                        ? {}
                        : { bio: about.trim() }),
                      displayName: name.trim(),
                      ...(held?.version === undefined
                        ? {}
                        : { expectedVersion: held.version }),
                      languages: held?.languages ?? [],
                    });
                    const failure = failureMessage(result);
                    if (failure !== undefined) {
                      toast.show(failure, 'critical');
                      return;
                    }
                    toast.show('Profile saved.', 'positive');
                    setDisplayName(undefined);
                    setBio(undefined);
                    session.account.reloadAll();
                  });
                }}
                testID="profile-save"
                tone="primary"
                wide
              >
                Save
              </Button>
            </Stack>
          </Card>

          <ProfilePhotos />

          {held === undefined ? null : (
            <Card>
              <Stack gap={3}>
                <Text variant="subheading" weight="semibold">
                  Languages
                </Text>
                <Text tone="secondary" variant="small">
                  Discovery uses these to find people you can actually talk to.
                </Text>
                <Inline gap={2} wrap>
                  {held.languages.length === 0 ? (
                    <Text tone="tertiary" variant="small">
                      None yet.
                    </Text>
                  ) : (
                    held.languages.map((code) => (
                      <Badge key={code} testID={`profile-language-${code}`}>
                        {languageName(code)}
                      </Badge>
                    ))
                  )}
                </Inline>
              </Stack>
            </Card>
          )}

          {held === undefined ||
          held.outstandingRequirements.length === 0 ? null : (
            <Notice
              testID="profile-requirements"
              title="Your profile is not complete yet"
              tone="caution"
            >
              {`Still needed: ${held.outstandingRequirements
                .map((requirement) => requirement.replaceAll('_', ' '))
                .join(', ')}.`}
            </Notice>
          )}
        </Stack>
      )}
    </Screen>
  );
}

/* ============================= Availability ========================== */

/**
 * How long an availability window runs when somebody opens one.
 *
 * A window always has an end, so nobody is left discoverable indefinitely by an
 * app they opened once. The device clock only chooses when to ask; the server
 * decides whether the window is still open, and this screen shows the server's
 * answer rather than counting down against a clock it does not trust.
 */
const availabilityWindowMilliseconds = 4 * 60 * 60 * 1000;

export function AvailabilityScreen({
  onBack,
}: {
  readonly onBack: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const load = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(load);
  useRevalidateOnForeground(availability.reload);

  const view = availabilityView(availability.value);
  const open = view === 'available';

  const save = (state: 'available' | 'unavailable') => {
    run(async () => {
      const result = await api.saveAvailability(
        state === 'available'
          ? {
              availableUntil: new Date(
                Date.now() + availabilityWindowMilliseconds,
              ).toISOString(),
              state,
            }
          : { state },
      );
      const failure = failureMessage(result);
      if (failure !== undefined) toast.show(failure, 'critical');
      else
        toast.show(
          state === 'available'
            ? 'You are visible in discovery for the next few hours.'
            : 'You are no longer visible in discovery.',
          'positive',
        );
      availability.reload();
    });
  };

  return (
    <Screen
      onBack={onBack}
      subtitle="Being available is what makes you visible to other people — and what lets you see them."
      testID="availability-screen"
      title="Availability"
    >
      {availability.loading && availability.value === undefined ? (
        <Card>
          <RowSkeleton rows={1} />
        </Card>
      ) : availability.error !== undefined &&
        availability.value === undefined ? (
        <ErrorState
          body={availability.error}
          testID="availability-failed"
          {...(availability.retryable ? { onRetry: availability.reload } : {})}
        />
      ) : (
        <Stack gap={5}>
          <Card>
            <Stack gap={4}>
              <View
                style={{
                  alignItems: 'center',
                  flexDirection: 'row',
                  gap: 12,
                }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="subheading" weight="semibold">
                    {availabilityLabels[view]}
                  </Text>
                  <Text
                    testID="availability-state"
                    tone="secondary"
                    variant="small"
                  >
                    {open
                      ? 'People can find you right now.'
                      : view === 'expired'
                        ? 'Your window ended. Nobody can find you until you open another.'
                        : 'Nobody can find you, and you cannot see anybody.'}
                  </Text>
                </View>
                <Switch
                  disabled={busy}
                  label="Available to meet"
                  onChange={(next) => {
                    save(next ? 'available' : 'unavailable');
                  }}
                  testID="availability-switch"
                  value={open}
                />
              </View>

              {open ? (
                <Button
                  busy={busy}
                  icon="refresh"
                  onPress={() => {
                    save('available');
                  }}
                  testID="availability-start"
                  tone="secondary"
                  wide
                >
                  Extend the window
                </Button>
              ) : null}
            </Stack>
          </Card>

          <Text tone="tertiary" variant="caption">
            Every window has an end, so opening one cannot leave you findable
            forever. VELORA decides when it closes, not this device.
          </Text>
        </Stack>
      )}
    </Screen>
  );
}

/* ============================ Notice preferences ===================== */

function preferenceKey(preference: NotificationPreference): string {
  return `${preference.category}:${preference.channel}`;
}

const channelLabels: Readonly<Record<string, string>> = {
  email: 'by email',
  push: 'on your phone',
  sms: 'by text message',
};

const categoryLabels: Readonly<Record<string, string>> = {
  account_security: 'Account security',
  call: 'Calls',
  direct_message: 'New messages',
  introduction: 'Introductions',
  marketing: 'News from VELORA',
  safety_legal: 'Safety and legal notices',
};

export function NoticePreferencesScreen({
  onBack,
}: {
  readonly onBack: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.notificationPreferences(signal),
    [api],
  );
  const preferences = useResource(load);
  const [saving, setSaving] = useState<string | undefined>(undefined);

  const rows = preferences.value?.preferences ?? [];
  const answered = !preferences.loading || preferences.value !== undefined;

  const set = (preference: NotificationPreference, enabled: boolean) => {
    const key = preferenceKey(preference);
    setSaving(key);
    void api
      .saveNotificationPreference({
        category: preference.category,
        channel: preference.channel,
        enabled,
      })
      .then((result) => {
        setSaving(undefined);
        const failure = failureMessage(result);
        if (failure !== undefined) toast.show(failure, 'critical');
        preferences.reload();
      });
  };

  return (
    <Screen
      onBack={onBack}
      subtitle="What VELORA tells you about, and where."
      testID="notice-preferences-screen"
      title="Notices"
    >
      {!answered ? (
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      ) : preferences.error !== undefined && rows.length === 0 ? (
        <ErrorState
          body={preferences.error}
          testID="notice-preferences-failed"
          {...(preferences.retryable ? { onRetry: preferences.reload } : {})}
        />
      ) : rows.length === 0 ? (
        <BlockedState
          body="There is nothing to decide yet. Notices you cannot switch off — account security, safety, and legal — are never offered as a choice."
          testID="notice-preferences-empty"
          title="Nothing to choose yet"
        />
      ) : (
        <Stack gap={5}>
          <Card padded={false}>
            <View style={{ paddingHorizontal: 16 }}>
              {rows.map((preference, index) => {
                const key = preferenceKey(preference);
                const category =
                  categoryLabels[preference.category] ??
                  preference.category.replaceAll('_', ' ');
                const channel =
                  channelLabels[preference.channel] ?? preference.channel;
                return (
                  <View key={key}>
                    {index === 0 ? null : <Divider />}
                    <View style={styles.preference}>
                      <View style={styles.preferenceBody}>
                        <Text variant="small" weight="medium">
                          {category}
                        </Text>
                        <Text tone="tertiary" variant="caption">
                          {`Reach me ${channel}.`}
                        </Text>
                      </View>
                      <Switch
                        disabled={saving !== undefined}
                        label={`${category}, ${channel}`}
                        onChange={(next) => {
                          set(preference, next);
                        }}
                        testID={`notice-${key}`}
                        value={preference.enabled}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>

          {/*
            What this says depends on what the build can actually do, because
            the two halves of push moved independently. The native build now
            exists, so a device token *can* be issued — but only once a provider
            is configured, and none is approved. The permission is therefore
            asked for only when there is something behind it: the control below
            appears when the registrar reports that a permission is the one
            thing missing, which cannot happen in a build with no provider. A
            prompt in any other state would teach somebody to grant a permission
            for nothing.
          */}
          <PushDeliveryNotice />
        </Stack>
      )}
    </Screen>
  );
}

/**
 * What this device can be reached on, said exactly.
 *
 * Four different situations used to read as one sentence about push being
 * unavailable, and only one of them is now true by default. They are separated
 * because a person can act on two of them and on neither of the others.
 */
function PushDeliveryNotice() {
  const session = useSession();
  const push = session.push;

  if (push.status === 'permission_required') {
    const blocked = push.permission === 'blocked';
    return (
      <Notice
        testID="notice-push-permission"
        title={
          blocked
            ? 'Android will not ask about notifications again'
            : 'Notifications are not switched on for this phone'
        }
        tone="caution"
      >
        <Stack gap={3}>
          <Text tone="secondary" variant="small">
            {blocked
              ? 'VELORA cannot show the notification dialog once it has been refused, so it has to be turned on in Android Settings.'
              : 'Android asks once per application. Nothing is sent until a delivery provider exists either way.'}
          </Text>
          <Button
            onPress={() => {
              if (blocked) void openApplicationSettings();
              else session.enablePush();
            }}
            size="small"
            testID="notice-push-enable"
            tone="secondary"
          >
            {blocked ? 'Open Settings' : 'Allow notifications'}
          </Button>
        </Stack>
      </Notice>
    );
  }

  if (push.status === 'registered') {
    return (
      <Notice testID="notice-push-registered" title="This phone is registered">
        VELORA can address this device. Whether anything arrives depends on a
        delivery provider, and every notice waits for you under Notices
        regardless.
      </Notice>
    );
  }

  return (
    <Notice
      testID="notice-delivery-blocked"
      title="Nothing is sent outside VELORA yet"
    >
      No email, push, or text provider is approved, and this build has none
      configured, so no device token is issued and no notification permission is
      asked for. These choices are stored and will apply the day a channel
      exists; until then every notice waits for you under Notices.
    </Notice>
  );
}

const styles = StyleSheet.create({
  preference: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  preferenceBody: { flex: 1, gap: 4 },
});
