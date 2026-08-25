import type { ConsumerProfile } from '@velora/consumer-client';
import { maximumProfileMedia } from '@velora/validation/profile-bounds';
import { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  useApi,
  useMediaAddressBook,
  useSession,
  useToast,
} from '../frame/providers';
import {
  openApplicationSettings,
  permissionExplanation,
} from '../device/permissions';
import {
  createPlatformImageSource,
  type ImageSource,
  type PickOutcome,
} from '../media/picker';
import {
  mediaRejectionReasons,
  mediaStateLabels,
  uploadProfilePhoto,
  type UploadStage,
} from '../media/upload';
import { Sheet } from '../design/sheet';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorMessage,
  Notice,
  Stack,
  StatusMessage,
  Text,
} from '../design/primitives';
import { Icon } from '../design/icons';
import { color, space } from '../design/tokens';
import { useMediaAddresses } from './imagery';

/**
 * Adding a photograph, on a phone that has a camera.
 *
 * The frozen interface had no control that would add one, and the reason given
 * was correct at the time: this application had no native build, so there was
 * no camera and no picker to offer. Both halves are now resolved — a ready
 * photograph is shown here as a thumbnail, obtained the way every other surface
 * obtains one, by exchanging its reference for a short-lived address that is
 * re-decided on every request.
 *
 * Where an environment has no approved delivery provider the exchange refuses,
 * and the screen says so instead of leaving a frame that never fills.
 *
 * Every refusal is its own state with its own sentence: a cancelled picker is
 * silent, a denied camera explains itself and offers to ask again, a
 * permanently denied camera sends somebody to Settings because Android will
 * not show the dialog again, an oversized file says how big is too big, and an
 * environment with no storage provider says nothing was lost.
 */

const stageLabels: Readonly<Record<UploadStage, string>> = {
  confirming: 'Checking the photo…',
  idle: '',
  requesting: 'Preparing the upload…',
  uploading: 'Uploading…',
};

const badgeTone: Readonly<
  Record<string, 'caution' | 'critical' | 'neutral' | 'positive'>
> = {
  checking: 'caution',
  pending_upload: 'neutral',
  preparing: 'caution',
  ready: 'positive',
  rejected: 'critical',
  removed: 'neutral',
};

export function ProfilePhotos({
  source,
}: {
  /** Injected by the tests. The platform picker is the default. */
  readonly source?: ImageSource;
}) {
  const api = useApi();
  const session = useSession();
  const toast = useToast();
  const picker = useMemo(() => source ?? createPlatformImageSource(), [source]);

  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState<string | undefined>(undefined);

  const profile: ConsumerProfile | undefined = session.account.profile.value;
  const slots = (profile?.media ?? []).filter(
    (item) => item.state !== 'removed',
  );
  const full = slots.length >= maximumProfileMedia;
  const working = stage !== 'idle';
  const book = useMediaAddressBook();
  const thumbnails = useMediaAddresses(
    slots.filter((item) => item.state === 'ready').map((item) => item.id),
    'avatar_large',
  );
  // Only once an exchange has actually happened. Before that the honest state
  // is "nothing to say yet" rather than either claim.
  const undeliverable =
    slots.some((item) => item.state === 'ready') && book.deliveryUnavailable();

  const accept = useCallback(
    async (outcome: PickOutcome) => {
      setBlocked(false);
      switch (outcome.kind) {
        case 'cancelled':
          // Backing out of a picker is the most ordinary thing that happens to
          // one. It is not an error and says nothing.
          return;
        case 'permission_required':
          setBlocked(outcome.permission === 'blocked');
          setError(permissionExplanation(outcome.permission, 'camera'));
          return;
        case 'too_large':
          setError(mediaRejectionReasons.too_large);
          return;
        case 'unsupported_type':
          setError(mediaRejectionReasons.unsupported_type);
          return;
        case 'failed':
          setError('The photo could not be opened. Try another one.');
          return;
        case 'picked':
        default:
          break;
      }

      setError(undefined);
      const result = await uploadProfilePhoto(outcome.image, {
        api,
        onStage: setStage,
      });
      switch (result.kind) {
        case 'accepted':
          toast.show('Photo received. We are checking it now.', 'positive');
          session.account.reloadAll();
          return;
        case 'storage_unavailable':
          setError(
            'Photo storage is not available in this environment yet. Nothing was lost.',
          );
          return;
        case 'too_large':
          setError(mediaRejectionReasons.too_large);
          return;
        case 'failed':
        default:
          setError(result.message);
      }
    },
    [api, session.account, toast],
  );

  const choose = (from: 'camera' | 'library') => {
    setChoosing(false);
    void (async () => {
      const outcome =
        from === 'camera'
          ? await picker.fromCamera()
          : await picker.fromLibrary();
      await accept(outcome);
    })();
  };

  const remove = (mediaId: string) => {
    setRemoving(undefined);
    void api.removeProfileMedia(mediaId).then((result) => {
      toast.show(
        result.kind === 'ok'
          ? 'Photo removed.'
          : 'That photo could not be removed.',
        result.kind === 'ok' ? 'positive' : 'critical',
      );
      session.account.reloadAll();
    });
  };

  return (
    <Card>
      <Stack gap={4}>
        <Text variant="subheading" weight="semibold">
          Photos
        </Text>

        {slots.length === 0 ? (
          <Text tone="secondary" variant="small">
            You have not added a photo yet. A profile needs one ready photo to
            appear in discovery.
          </Text>
        ) : (
          <Stack gap={3}>
            {slots.map((item, index) => (
              <View key={item.id}>
                {index === 0 ? null : <Divider />}
                <View style={styles.slot} testID={`profile-media-${item.id}`}>
                  {thumbnails.get(item.id) === undefined ? (
                    <Icon color={color.textSecondary} name="camera" size="md" />
                  ) : (
                    <Image
                      accessibilityIgnoresInvertColors
                      source={{ uri: thumbnails.get(item.id) ?? '' }}
                      style={styles.thumbnail}
                      testID={`profile-media-thumb-${item.id}`}
                    />
                  )}
                  <View style={styles.slotBody}>
                    <Badge tone={badgeTone[item.state] ?? 'neutral'}>
                      {mediaStateLabels[item.state] ?? item.state}
                    </Badge>
                    {item.state === 'rejected' ? (
                      <Text tone="tertiary" variant="caption">
                        {mediaRejectionReasons[item.rejectionReason ?? ''] ??
                          'This image could not be used.'}
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    onPress={() => {
                      setRemoving(item.id);
                    }}
                    size="small"
                    testID={`profile-media-remove-${item.id}`}
                    tone="ghost"
                  >
                    Remove
                  </Button>
                </View>
              </View>
            ))}
          </Stack>
        )}

        <Button
          disabled={full || working}
          icon="plus"
          onPress={() => {
            setChoosing(true);
          }}
          testID="profile-add-photo"
          tone="secondary"
          wide
        >
          {full
            ? `Maximum of ${String(maximumProfileMedia)} photos`
            : slots.length === 0
              ? 'Add a photo'
              : 'Add another photo'}
        </Button>

        {working ? (
          <StatusMessage testID="profile-photo-progress">
            {stageLabels[stage]}
          </StatusMessage>
        ) : null}

        {error === undefined ? null : (
          <Stack gap={2}>
            <ErrorMessage testID="profile-photo-error">{error}</ErrorMessage>
            {blocked ? (
              <Button
                onPress={() => {
                  void openApplicationSettings();
                }}
                size="small"
                testID="profile-photo-settings"
                tone="secondary"
              >
                Open Settings
              </Button>
            ) : null}
          </Stack>
        )}

        {!undeliverable ? null : (
          <Notice
            testID="media-delivery-blocked"
            title="Photos are stored, not shown here"
            tone="neutral"
          >
            This environment has no approved way to deliver an image, so no
            photograph is displayed on it — not yours and not anybody
            else&apos;s. What you add is kept and checked, and it appears
            wherever delivery is available.
          </Notice>
        )}
      </Stack>

      {choosing ? (
        <Sheet
          onClose={() => {
            setChoosing(false);
          }}
          testID="photo-source-sheet"
          title="Add a photo"
        >
          <Stack gap={3}>
            <Button
              icon="camera"
              onPress={() => {
                choose('camera');
              }}
              testID="photo-source-camera"
              tone="secondary"
              wide
            >
              Take a photo
            </Button>
            <Button
              icon="plus"
              onPress={() => {
                choose('library');
              }}
              testID="photo-source-library"
              tone="secondary"
              wide
            >
              Choose from your photos
            </Button>
            <Text tone="tertiary" variant="caption">
              JPEG, PNG, or WebP. VELORA looks at the photo before it is used.
            </Text>
          </Stack>
        </Sheet>
      ) : null}

      {removing === undefined ? null : (
        <Sheet
          onClose={() => {
            setRemoving(undefined);
          }}
          testID="remove-photo-sheet"
          title="Remove this photo?"
        >
          <Stack gap={4}>
            <Text tone="secondary" variant="small">
              It is deleted from your profile. If it was the only photo you
              have, you will stop appearing in discovery until you add another.
            </Text>
            <Button
              icon="trash"
              onPress={() => {
                remove(removing);
              }}
              testID="remove-photo-confirm"
              tone="danger"
              wide
            >
              Remove photo
            </Button>
          </Stack>
        </Sheet>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[2],
  },
  slotBody: {
    flex: 1,
    gap: space[1],
  },
  /*
   * The same box the icon occupies, so a row does not resize when a short-lived
   * address arrives and the list never jumps under somebody's finger.
   */
  thumbnail: {
    borderRadius: space[2],
    height: 40,
    width: 40,
  },
});
