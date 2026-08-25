'use client';

import { useEffect, useRef, useState } from 'react';

import type { CreatorApi, MediaVariant } from '@velora/creator-client';

import { useMediaAddressBook } from '../app/providers';

/**
 * Turning the image references a creator's own projections carry into something
 * the browser can load.
 *
 * The same exchange every other surface makes, with one difference worth
 * knowing: Studio sends its own credential, and the platform decides per asset
 * what that credential is worth. A published page's imagery comes back because
 * it is public; a draft page's does not, which is exactly what a visitor would
 * see and is why the preview screen can be trusted to show what it claims.
 */
export function useMediaAddresses(
  references: readonly string[],
  variant: MediaVariant,
): ReadonlyMap<string, string> {
  const book = useMediaAddressBook();
  const [addresses, setAddresses] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // Joined rather than compared by identity: a projection rebuilds its arrays
  // on every render, so an effect keyed on the array itself would run forever.
  const key = references.join(',');
  const latest = useRef(0);

  useEffect(() => {
    const wanted = key.length === 0 ? [] : key.split(',');
    if (wanted.length === 0) {
      setAddresses(new Map());
      return;
    }
    latest.current += 1;
    const generation = latest.current;
    void book
      .resolve(wanted, variant)
      .then((resolved) => {
        // A slower earlier request must not overwrite a newer answer.
        if (generation === latest.current) setAddresses(resolved);
      })
      .catch(() => {
        // An address that cannot be obtained is not an error a creator can act
        // on. What is already on screen stays there.
      });
  }, [book, key, variant]);

  return addresses;
}

/** What an upload is doing, in the order it happens. */
export type UploadStage = 'idle' | 'requesting' | 'uploading' | 'confirming';

export interface UploadOutcome {
  readonly error: string | undefined;
  readonly stage: UploadStage;
}

/**
 * The three calls every image on this platform goes through.
 *
 * Written once because the page slots and the catalog items differ only in
 * which pair of endpoints they name. The client never says what it uploaded: it
 * asks for a capability, writes the bytes to the address the platform issued,
 * and then asks the platform to look at the object. Each step reports itself, so
 * a refused capability, a write that never arrived, and a refused inspection are
 * three different sentences rather than one shrug.
 */
export async function uploadImage(input: {
  readonly confirm: (mediaId: string) => Promise<{ readonly kind: string }>;
  readonly file: File;
  readonly onStage: (stage: UploadStage) => void;
  readonly reserve: () => ReturnType<CreatorApi['startProfileMediaUpload']>;
}): Promise<string | undefined> {
  input.onStage('requesting');
  const reserved = await input.reserve();
  if (reserved.kind !== 'ok') {
    input.onStage('idle');
    return reserved.kind === 'refused' &&
      reserved.code === 'DEPENDENCY_UNAVAILABLE'
      ? 'Image storage is not available in this environment yet.'
      : 'That image could not be started. Try again.';
  }
  const capability = reserved.value;

  if (input.file.size > capability.maximumBytes) {
    input.onStage('idle');
    const megabytes = Math.floor(capability.maximumBytes / (1024 * 1024));
    return `That image is larger than ${String(megabytes)} MB.`;
  }

  input.onStage('uploading');
  try {
    const written = await fetch(capability.uploadUrl, {
      body: input.file,
      headers: capability.uploadHeaders,
      method: capability.method,
    });
    if (!written.ok) {
      input.onStage('idle');
      return 'The image did not finish uploading. Try again.';
    }
  } catch {
    input.onStage('idle');
    return 'The image did not finish uploading. Try again.';
  }

  input.onStage('confirming');
  const confirmed = await input.confirm(capability.mediaId);
  input.onStage('idle');
  return confirmed.kind === 'ok'
    ? undefined
    : 'The platform could not check that image. Try again.';
}

/** What each stage is called, for somebody watching it happen. */
export const uploadStageLabels: Readonly<Record<UploadStage, string>> = {
  confirming: 'Checking the image…',
  idle: '',
  requesting: 'Preparing the upload…',
  uploading: 'Uploading…',
};
