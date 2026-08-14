import {
  maximumProfileMediaBytes,
  type ProfileMediaContentType,
} from '@velora/validation';

import { sniffProfileMediaContentType } from './media-bytes.js';

/**
 * Profile media storage seam.
 *
 * The platform owns the record of an image; an adapter owns the bytes. Nothing
 * above this interface knows whether objects live in object storage, on a
 * filesystem, or in a process, and no adapter knows anything about consumer
 * accounts, discovery, or eligibility.
 *
 * No storage vendor is approved, so the default adapter refuses everything.
 * `docs/decisions/DECISIONS_REQUIRED.md` still carries the media storage and
 * scanning decision, and configuration refuses any other adapter in staging and
 * production.
 */

/** A short-lived, object-bound capability to write exactly one object. */
export interface ProfileMediaUploadTarget {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: 'PUT';
  readonly url: string;
}

/** Why an adapter refused a stored object. Mapped straight onto the record. */
export type ProfileMediaRefusal =
  'unsupported_type' | 'too_large' | 'content_rejected';

/**
 * What the platform learns about an object after it has been stored.
 *
 * A refusal carries no measurements, because there is nothing worth recording
 * about an object that will never be shown; an acceptance carries only facts the
 * adapter derived from the bytes themselves. `contentType` is decided from those
 * bytes, never from what a client claimed.
 *
 * An adapter that performs no content checks may only be used where there is no
 * real content to check, which configuration enforces.
 */
export type ProfileMediaObjectFacts =
  | {
      readonly byteSize: number;
      readonly checksum: string;
      readonly contentType: ProfileMediaContentType;
      readonly verdict: 'accepted';
    }
  | { readonly reason: ProfileMediaRefusal; readonly verdict: 'rejected' };

export interface ProfileMediaStoragePort {
  /** Recorded on the media row for audit and for routing a later recheck. */
  readonly name: string;
  createUploadTarget(input: {
    readonly expiresAt: Date;
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<ProfileMediaUploadTarget>;
  /**
   * Facts about a stored object, or `undefined` when nothing was ever written.
   * An object whose bytes are not a supported image is `rejected`, not absent.
   */
  inspect(objectKey: string): Promise<ProfileMediaObjectFacts | undefined>;
  remove(objectKey: string): Promise<void>;
}

export class ProfileMediaStorageUnavailableError extends Error {
  constructor() {
    super('No profile media storage provider is approved');
    this.name = 'ProfileMediaStorageUnavailableError';
  }
}

/**
 * The default. It stores nothing and inspects nothing, so an environment with no
 * approved provider cannot accept an image, and an account there cannot reach
 * the minimum discoverable profile. That is the intended outcome: it is better
 * for discovery to be empty than for it to run on unverified media.
 */
export class UnavailableProfileMediaStorage implements ProfileMediaStoragePort {
  readonly name = 'unavailable';

  createUploadTarget(): Promise<ProfileMediaUploadTarget> {
    return Promise.reject(new ProfileMediaStorageUnavailableError());
  }

  inspect(): Promise<ProfileMediaObjectFacts | undefined> {
    return Promise.reject(new ProfileMediaStorageUnavailableError());
  }

  remove(): Promise<void> {
    return Promise.reject(new ProfileMediaStorageUnavailableError());
  }
}

/**
 * Development and test adapter. Objects live in this process and disappear with
 * it.
 *
 * Two things about it are deliberately honest. Its upload target is not a real
 * transport: a caller places bytes by calling {@link put} directly, because
 * inventing an HTTP upload endpoint for a mock would put mock behaviour on a
 * production route. And its `accepted` verdict means only that the bytes are a
 * supported image within the size limit — it performs no malware scanning and no
 * content moderation, so it is never evidence about real user content.
 * Configuration refuses it outside local and test environments.
 */
export class LocalTestProfileMediaStorage implements ProfileMediaStoragePort {
  readonly name = 'local-test';

  private readonly objects = new Map<string, Uint8Array>();

  createUploadTarget(input: {
    readonly expiresAt: Date;
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<ProfileMediaUploadTarget> {
    return Promise.resolve({
      headers: {
        'x-velora-maximum-bytes': String(input.maximumBytes),
        'x-velora-upload-expires-at': input.expiresAt.toISOString(),
      },
      method: 'PUT',
      // A deliberately unroutable host. Nothing can accidentally depend on this
      // adapter behaving like a real upload endpoint.
      url: `https://media.velora.invalid/local-test/${encodeURIComponent(input.objectKey)}`,
    });
  }

  /** Stands in for the client's upload. Test and development use only. */
  put(objectKey: string, bytes: Uint8Array): void {
    this.objects.set(objectKey, bytes);
  }

  inspect(objectKey: string): Promise<ProfileMediaObjectFacts | undefined> {
    const bytes = this.objects.get(objectKey);
    if (bytes === undefined) return Promise.resolve(undefined);
    if (bytes.byteLength > maximumProfileMediaBytes) {
      return Promise.resolve({ reason: 'too_large', verdict: 'rejected' });
    }
    const contentType = sniffProfileMediaContentType(bytes);
    if (contentType === undefined) {
      return Promise.resolve({
        reason: 'unsupported_type',
        verdict: 'rejected',
      });
    }
    return Promise.resolve({
      byteSize: bytes.byteLength,
      checksum: digestOf(bytes),
      contentType,
      verdict: 'accepted',
    });
  }

  remove(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

function digestOf(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}
