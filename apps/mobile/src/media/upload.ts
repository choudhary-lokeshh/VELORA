import type { ConsumerApi, ConsumerProfile } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { maximumProfileMediaBytes } from '@velora/validation/profile-bounds';

import type { PickedImage } from './picker';

/**
 * Putting one chosen photograph where the platform can inspect it.
 *
 * Three steps, in this order, and none of them optional:
 *
 * 1. Ask the platform for a short-lived, object-bound upload capability. It
 *    answers with an address, the exact headers to send, and a deadline.
 * 2. Write the bytes to that address, with those headers and no others.
 * 3. Tell the platform the object is there, so it can look at it.
 *
 * The client never declares what it uploaded. The type, the size, and whether
 * the object is acceptable at all are decided by the server from the stored
 * bytes, which is what makes "this is a JPEG" a fact rather than a claim. The
 * upload address is never shown, logged, or retained: it is an implementation
 * detail of whichever storage provider is configured, and no storage provider
 * is approved for VELORA yet, so in every deployed environment step 1 refuses
 * and the flow stops there — visibly, with a sentence about it, rather than by
 * appearing to work.
 *
 * **A photograph that reaches `ready` is still not shown anywhere.** The
 * consumer contract publishes image references with no address, because
 * authorized delivery needs a decision nobody has made. That is stated on the
 * screen rather than hidden behind an image frame that never fills, and it is
 * the same thing Consumer Web says.
 */

export type UploadStage = 'idle' | 'requesting' | 'uploading' | 'confirming';

export type UploadOutcome =
  | { readonly kind: 'accepted'; readonly profile: ConsumerProfile }
  /** No storage provider is configured in this environment. Nothing was lost. */
  | { readonly kind: 'storage_unavailable' }
  | { readonly kind: 'too_large'; readonly byteSize: number }
  | { readonly kind: 'failed'; readonly message: string };

export interface UploadDependencies {
  readonly api: ConsumerApi;
  /** Injected so a test can exercise the three steps without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly onStage?: (stage: UploadStage) => void;
}

/**
 * Reads a picked image into bytes the request can carry.
 *
 * React Native resolves a `file://` or `content://` URI through its own
 * networking stack, so `fetch` is how a chosen asset becomes a body. It is
 * done as one read rather than streamed because the contract caps a profile
 * image at eight megabytes, which is small enough to hold and simple enough to
 * be obviously correct.
 */
async function readBytes(
  image: PickedImage,
  read: typeof globalThis.fetch,
): Promise<Blob> {
  const response = await read(image.uri);
  if (!response.ok) {
    throw new Error('The chosen photo could not be read from the device.');
  }
  return response.blob();
}

export async function uploadProfilePhoto(
  image: PickedImage,
  dependencies: UploadDependencies,
): Promise<UploadOutcome> {
  const { api } = dependencies;
  const read = dependencies.fetch ?? globalThis.fetch;
  const stage = (next: UploadStage) => dependencies.onStage?.(next);

  stage('requesting');
  const capability = await api.createProfileMediaUpload();
  if (capability.kind !== 'ok') {
    stage('idle');
    if (
      capability.kind === 'refused' &&
      capability.code === 'DEPENDENCY_UNAVAILABLE'
    ) {
      return { kind: 'storage_unavailable' };
    }
    return {
      kind: 'failed',
      message:
        failureMessage(capability) ?? 'The upload could not be prepared.',
    };
  }

  stage('uploading');
  let body: Blob;
  try {
    body = await readBytes(image, read);
  } catch {
    stage('idle');
    return {
      kind: 'failed',
      // The written sentence, always: a filesystem error's own message names
      // paths and native codes, which is nothing a person can act on.
      message: 'The chosen photo could not be read from the device.',
    };
  }

  // The device may not have reported a size before the bytes were read. This
  // is the last point at which an oversized file can be stopped without
  // spending somebody's mobile data on it.
  if (body.size > maximumProfileMediaBytes) {
    stage('idle');
    return { byteSize: body.size, kind: 'too_large' };
  }

  try {
    const written = await read(capability.value.uploadUrl, {
      body,
      headers: capability.value.uploadHeaders,
      method: 'PUT',
    });
    if (!written.ok) throw new Error('upload rejected');
  } catch {
    stage('idle');
    // Never the address, never the provider's own message. Both are storage
    // implementation detail and neither helps the person holding the phone.
    return {
      kind: 'failed',
      message: 'The photo could not be uploaded. Try again.',
    };
  }

  stage('confirming');
  const confirmed = await api.completeProfileMediaUpload(
    capability.value.mediaId,
  );
  stage('idle');
  if (confirmed.kind !== 'ok') {
    return {
      kind: 'failed',
      message: failureMessage(confirmed) ?? 'The photo could not be checked.',
    };
  }
  return { kind: 'accepted', profile: confirmed.value };
}

/** What a media slot is doing, in words rather than in contract vocabulary. */
export const mediaStateLabels: Readonly<Record<string, string>> = {
  checking: 'Checking',
  pending_upload: 'Not uploaded',
  preparing: 'Preparing',
  ready: 'Ready',
  rejected: 'Not accepted',
  removed: 'Removed',
};

/** Why an image was refused, in words somebody can act on. */
export const mediaRejectionReasons: Readonly<Record<string, string>> = {
  content_rejected: 'This image could not be used. Try a different one.',
  not_uploaded: 'The upload did not finish. Choose the photo again.',
  too_large: `That file is over ${String(
    Math.round(maximumProfileMediaBytes / (1024 * 1024)),
  )} MB. Try a smaller one.`,
  unsupported_type: 'That file is not a JPEG, PNG, or WebP image.',
};
