'use client';

import { useState } from 'react';

import {
  acceptedProfileMediaTypes,
  maximumProfileMedia,
  maximumProfileMediaBytes,
} from '@velora/validation';
import type { ConsumerProfile } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import { useAccount, useApi, useToast } from '../app/providers';
import { ConfirmDialog } from '../design/dialog';
import { Icon, type IconName } from '../design/icons';
import {
  Badge,
  Button,
  ErrorMessage,
  Notice,
  StatusMessage,
  type Tone,
} from '../design/primitives';

/**
 * A profile's photos: asked for, uploaded, then inspected by the platform.
 *
 * The client never declares what it uploaded. It asks for a short-lived
 * capability, writes the bytes to it, and then asks the platform to look at the
 * object — which is what makes "this is a JPEG" a fact the server established
 * rather than a claim the browser made.
 *
 * Every failure along the way is reported as itself. A refused capability means
 * no storage provider is configured in this environment; a failed write means
 * the bytes never arrived; a rejected inspection means the object is not a
 * usable image. None of the three is allowed to look like success, and none of
 * them exposes a storage address, bucket, or key.
 *
 * **A ready photo is still not rendered anywhere, and that is not a bug on this
 * screen.** Consumer media has no durable address and no authorized delivery
 * route exists — `packages/validation` publishes image references with no URL
 * for exactly that reason — so no surface on this platform can show one yet.
 * Saying so is better than an image frame that never fills.
 */

type SlotState =
  | 'pending_upload'
  | 'checking'
  | 'preparing'
  | 'ready'
  | 'rejected'
  | 'removed';

const slotPresentation: Readonly<
  Record<
    SlotState,
    { readonly icon: IconName; readonly label: string; readonly tone: Tone }
  >
> = {
  checking: { icon: 'clock', label: 'Checking', tone: 'caution' },
  pending_upload: { icon: 'clock', label: 'Not uploaded', tone: 'neutral' },
  preparing: { icon: 'refresh', label: 'Preparing', tone: 'caution' },
  ready: { icon: 'check', label: 'Ready', tone: 'positive' },
  rejected: { icon: 'alert', label: 'Not accepted', tone: 'critical' },
  removed: { icon: 'trash', label: 'Removed', tone: 'neutral' },
};

/** Why an image was refused, in words somebody can act on. */
const rejectionReasons: Readonly<Record<string, string>> = {
  content_rejected: 'This image could not be used. Try a different one.',
  not_uploaded: 'The upload did not finish. Choose the photo again.',
  too_large: `That file is over ${String(
    Math.round(maximumProfileMediaBytes / (1024 * 1024)),
  )} MB. Try a smaller one.`,
  unsupported_type: 'That file is not a JPEG, PNG, or WebP image.',
};

type Progress = 'idle' | 'requesting' | 'uploading' | 'confirming';

const progressLabels: Readonly<Record<Exclude<Progress, 'idle'>, string>> = {
  confirming: 'Checking the photo…',
  requesting: 'Preparing the upload…',
  uploading: 'Uploading…',
};

export function ProfilePhotos({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const api = useApi();
  const account = useAccount();
  const toast = useToast();
  const profile: ConsumerProfile | undefined = account.profile.value;
  const [progress, setProgress] = useState<Progress>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [removeBusy, setRemoveBusy] = useState(false);

  const slots = (profile?.media ?? []).filter(
    (item) => item.state !== 'removed',
  );
  const full = slots.length >= maximumProfileMedia;
  const working = progress !== 'idle';

  const upload = async (file: File) => {
    setError(undefined);
    if (file.size > maximumProfileMediaBytes) {
      setError(rejectionReasons.too_large);
      return;
    }

    setProgress('requesting');
    const target = await api.createProfileMediaUpload();
    if (target.kind !== 'ok') {
      setProgress('idle');
      setError(
        target.kind === 'refused' && target.code === 'DEPENDENCY_UNAVAILABLE'
          ? 'Photo storage is not available in this environment yet. Nothing was lost.'
          : failureMessage(target),
      );
      return;
    }

    setProgress('uploading');
    try {
      const response = await fetch(target.value.uploadUrl, {
        body: file,
        headers: target.value.uploadHeaders,
        method: 'PUT',
      });
      if (!response.ok) throw new Error('upload rejected');
    } catch {
      // The address itself is never shown. It is an implementation detail of
      // whichever provider is configured, and there is no approved provider.
      setProgress('idle');
      setError('The photo could not be uploaded. Try again.');
      return;
    }

    setProgress('confirming');
    const confirmed = await api.completeProfileMediaUpload(
      target.value.mediaId,
    );
    setProgress('idle');
    const failure = failureMessage(confirmed);
    setError(failure);
    if (failure === undefined) {
      toast.show('Photo received. We are checking it now.', 'positive');
    }
    account.reloadAll();
  };

  const remove = (mediaId: string) => {
    setRemoveBusy(true);
    void api
      .removeProfileMedia(mediaId)
      .then((result) => {
        const failure = failureMessage(result);
        toast.show(
          failure ?? 'Photo removed.',
          failure === undefined ? 'positive' : 'critical',
        );
        account.reloadAll();
      })
      .finally(() => {
        setRemoveBusy(false);
        setRemoving(undefined);
      });
  };

  return (
    <div className="v-stack v-stack--4">
      {slots.length === 0 ? null : (
        <ul className="v-media-list" data-testid="profile-media-list">
          {slots.map((item) => {
            const presentation = slotPresentation[item.state];
            return (
              <li
                className="v-media-item"
                data-state={item.state}
                data-testid={`profile-media-${item.id}`}
                key={item.id}
              >
                <Icon name={presentation.icon} size="lg" />
                <Badge tone={presentation.tone}>{presentation.label}</Badge>
                {item.state === 'rejected' ? (
                  <p className="v-caption v-quiet">
                    {rejectionReasons[item.rejectionReason ?? ''] ??
                      'This image could not be used.'}
                  </p>
                ) : null}
                <Button
                  data-testid={`profile-media-remove-${item.id}`}
                  onClick={() => {
                    setRemoving(item.id);
                  }}
                  size="sm"
                  tone="ghost"
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="v-media-slot">
        <Icon name="camera" size="lg" />
        <p className="v-small v-muted">
          {full
            ? `You have added the maximum of ${String(maximumProfileMedia)} photos.`
            : 'JPEG, PNG, or WebP.'}
        </p>
        <label className="v-btn v-btn--secondary" htmlFor="profile-photo">
          {slots.length === 0 ? 'Choose a photo' : 'Add another photo'}
          <input
            accept={acceptedProfileMediaTypes.join(',')}
            className="v-media-slot__input"
            data-testid="profile-photo"
            disabled={full || working}
            id="profile-photo"
            name="photo"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              event.target.value = '';
              if (file !== undefined) void upload(file);
            }}
            type="file"
          />
        </label>

        {working ? (
          <StatusMessage testId="profile-photo-progress">
            {progressLabels[progress]}
          </StatusMessage>
        ) : null}
        {error === undefined ? null : (
          <ErrorMessage testId="profile-photo-error">{error}</ErrorMessage>
        )}
      </div>

      {compact ? null : (
        <Notice
          icon="lock"
          testId="media-delivery-blocked"
          title="Photos are stored, not shown"
          tone="quiet"
        >
          VELORA has no approved way to deliver an image yet, so no photo is
          displayed anywhere on this site — not yours and not anybody
          else&apos;s. What you upload is kept and checked, and it appears the
          day authorized delivery exists.
        </Notice>
      )}

      {removing === undefined ? null : (
        <ConfirmDialog
          busy={removeBusy}
          confirmLabel="Remove photo"
          onCancel={() => {
            setRemoving(undefined);
          }}
          onConfirm={() => {
            remove(removing);
          }}
          testId="remove-photo"
          title="Remove this photo?"
        >
          <p>
            It is deleted from your profile. If it was the only photo you have,
            you will stop appearing in discovery until you add another.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
