'use client';

import { useState } from 'react';

import { acceptedProfileMediaTypes } from '@velora/validation/profile-bounds';

import { Icon, type IconName } from '../design/icons';
import {
  Badge,
  Button,
  ErrorMessage,
  StatusMessage,
  type Tone,
} from '../design/primitives';
import { uploadImage, uploadStageLabels, type UploadStage } from './imagery';

/**
 * The control a creator uses to put an image somewhere, and the tile that shows
 * what is there.
 *
 * Written once for both places it appears, because a page slot and a catalog
 * item differ only in which pair of endpoints they name and what an empty one
 * should say. What they share is everything that matters: the file never
 * declares itself, every stage of the upload reports itself, and a refusal is
 * its own sentence rather than a shrug.
 */

/** How far an image has got, as the platform reports it. */
type ImageState =
  | 'pending_upload'
  | 'checking'
  | 'preparing'
  | 'ready'
  | 'rejected'
  | 'removed';

const statePresentation: Readonly<
  Record<
    ImageState,
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

/** Why an image was refused, in words a creator can act on. */
const rejectionReasons: Readonly<Record<string, string>> = {
  content_rejected: 'This image could not be used. Try a different one.',
  not_uploaded: 'The bytes never arrived. Try uploading it again.',
  too_large: 'This image is larger than the platform accepts.',
  unsupported_type: 'That file is not a JPEG, PNG, or WebP.',
};

function isKnownState(value: string): value is ImageState {
  return Object.hasOwn(statePresentation, value);
}

export interface StudioImage {
  readonly id: string;
  readonly rejectionReason?: string | undefined;
  readonly state: string;
}

/**
 * One image, with its state and the control that removes it.
 *
 * The thumbnail replaces the icon rather than sitting beside it, so a tile is
 * the same size whether or not an address has arrived and a grid never reflows
 * under somebody's cursor.
 */
export function ImageTile({
  address,
  busy,
  image,
  onRemove,
  testId,
}: {
  readonly address: string | undefined;
  readonly busy: boolean;
  readonly image: StudioImage;
  readonly onRemove: () => void;
  readonly testId: string;
}) {
  // A state the platform introduced and this surface has not learned yet is
  // rendered as removed rather than crashing a page: unknown is not visible.
  const presentation: { icon: IconName; label: string; tone: Tone } =
    isKnownState(image.state)
      ? statePresentation[image.state]
      : statePresentation.removed;
  return (
    <li className="s-image-tile" data-state={image.state} data-testid={testId}>
      {address === undefined ? (
        <Icon name={presentation.icon} size="lg" />
      ) : (
        // A plain element rather than the framework's optimised one: the
        // address is issued per request, so nothing upstream can fetch it.
        <img
          alt=""
          className="s-image-tile__image"
          data-testid={`${testId}-thumb`}
          src={address}
        />
      )}
      <div className="s-image-tile__foot">
        <Badge tone={presentation.tone}>{presentation.label}</Badge>
        <Button
          data-testid={`${testId}-remove`}
          disabled={busy}
          onClick={onRemove}
          size="sm"
          tone="ghost"
        >
          Remove
        </Button>
      </div>
      {image.state === 'rejected' ? (
        <p className="s-caption s-quiet">
          {rejectionReasons[image.rejectionReason ?? ''] ??
            'This image could not be used.'}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The file control, and everything that happens after somebody chooses one.
 *
 * The three calls are the same three every image on this platform goes through.
 * The label is a `label` bound to a hidden input rather than a button that
 * clicks one, so it is reachable by keyboard and announced as what it is.
 */
export function ImageUpload({
  confirm,
  disabled,
  inputId,
  label,
  onUploaded,
  reserve,
  testId,
}: {
  readonly confirm: (mediaId: string) => Promise<{ readonly kind: string }>;
  readonly disabled: boolean;
  readonly inputId: string;
  readonly label: string;
  readonly onUploaded: () => void;
  readonly reserve: () => Promise<{
    readonly kind: string;
    readonly code?: string;
    readonly value?: {
      readonly maximumBytes: number;
      readonly mediaId: string;
      readonly method: 'PUT';
      readonly uploadHeaders: Record<string, string>;
      readonly uploadUrl: string;
    };
  }>;
  readonly testId: string;
}) {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const working = stage !== 'idle';

  return (
    <div className="s-stack s-stack--3">
      <label className="s-btn s-btn--secondary" htmlFor={inputId}>
        {label}
        <input
          accept={acceptedProfileMediaTypes.join(',')}
          className="s-file-input"
          data-testid={testId}
          disabled={disabled || working}
          id={inputId}
          name={inputId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = '';
            if (file === undefined) return;
            setError(undefined);
            void uploadImage({
              confirm,
              file,
              onStage: setStage,
              reserve: reserve as never,
            }).then((failure) => {
              setError(failure);
              if (failure === undefined) onUploaded();
            });
          }}
          type="file"
        />
      </label>
      {working ? (
        <StatusMessage testId={`${testId}-progress`}>
          {uploadStageLabels[stage]}
        </StatusMessage>
      ) : null}
      {error === undefined ? null : (
        <ErrorMessage testId={`${testId}-error`}>{error}</ErrorMessage>
      )}
    </div>
  );
}
