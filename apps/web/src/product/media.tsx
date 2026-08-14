'use client';

import { useRef, useState } from 'react';

import type { ConsumerApi, ConsumerProfile } from '@velora/consumer-client';
import {
  failureMessage,
  profileMediaLabels,
  profileMediaState,
} from '@velora/consumer-client';
import { ErrorMessage, StatusMessage } from './ui';

/**
 * A profile photo: asked for, uploaded, and then inspected by the platform.
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
 * them exposes a storage address, bucket, or key: those are provider details,
 * and there is no approved provider to have them.
 *
 * Nothing here claims the image was scanned or moderated. No such capability
 * exists, and the rejection reasons the contract publishes are structural.
 *
 * The same component serves admission and the profile screen, because it is the
 * same job. Somebody whose outstanding requirement is an image must be able to
 * supply one where they are told about it.
 */
export function ProfilePhoto({
  api,
  busy,
  onFinished,
  profile,
}: {
  readonly api: ConsumerApi;
  readonly busy: boolean;
  readonly onFinished: () => void;
  readonly profile: ConsumerProfile | undefined;
}) {
  const [state, setState] = useState<
    'idle' | 'requesting' | 'uploading' | 'confirming' | 'done'
  >('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setError(undefined);
    setState('requesting');
    const target = await api.createProfileMediaUpload();
    if (target.kind !== 'ok') {
      setState('idle');
      setError(
        target.kind === 'refused' && target.code === 'DEPENDENCY_UNAVAILABLE'
          ? 'Photo storage is not available in this environment yet.'
          : failureMessage(target),
      );
      return;
    }

    setState('uploading');
    try {
      const response = await fetch(target.value.uploadUrl, {
        body: file,
        headers: target.value.uploadHeaders,
        method: 'PUT',
      });
      if (!response.ok) throw new Error('upload rejected');
    } catch {
      // The address itself is never shown. It is an implementation detail of
      // whichever provider is configured, and in every deployed environment
      // today there is no provider at all.
      setState('idle');
      setError('The photo could not be uploaded. Try again.');
      return;
    }

    setState('confirming');
    const confirmed = await api.completeProfileMediaUpload(
      target.value.mediaId,
    );
    setState('done');
    setError(failureMessage(confirmed));
    onFinished();
  };

  const working = state === 'uploading' || state === 'confirming';

  return (
    <div>
      <StatusMessage testId="profile-media-state">
        {profileMediaLabels[profileMediaState(profile)]}
      </StatusMessage>
      <label htmlFor="profile-photo">Choose a photo</label>
      <input
        accept="image/jpeg,image/png,image/webp"
        data-testid="profile-photo"
        disabled={busy || working}
        id="profile-photo"
        name="photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void upload(file);
        }}
        ref={input}
        type="file"
      />
      {state === 'idle' || state === 'done' ? null : (
        <StatusMessage testId="profile-photo-progress">
          {state === 'requesting'
            ? 'Preparing upload…'
            : state === 'uploading'
              ? 'Uploading…'
              : 'Checking the photo…'}
        </StatusMessage>
      )}
      {error === undefined ? null : (
        <ErrorMessage testId="profile-photo-error">{error}</ErrorMessage>
      )}
    </div>
  );
}
