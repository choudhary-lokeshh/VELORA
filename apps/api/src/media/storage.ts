import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  localTestObjectPath,
  localTestPublicObjectPath,
} from './local-transport.js';
import {
  maximumMediaObjectBytes,
  mediaVariantKinds,
  type MediaImageFormat,
} from './policy.js';

/**
 * The media storage seam.
 *
 * The platform owns the record of an asset; an adapter owns the bytes. Nothing
 * above this interface knows whether objects live in object storage, on a
 * filesystem, or in a bucket somewhere, and no adapter knows anything about
 * accounts, creators, entitlement, or safety.
 *
 * No storage or delivery vendor is approved. `MEDIA_STORAGE_PROVIDER` defaults
 * to `unavailable`, which refuses every operation, and staging and production
 * reject any other value. See ADR-0023 and the media provider eligibility
 * register, which records that five assessed providers are merely *silent* on
 * the content Velora serves — which is the absence of an answer, not approval.
 */

/** A short-lived, object-bound capability to write exactly one object. */
export interface MediaUploadCapability {
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumBytes: number;
  readonly method: 'PUT';
  /**
   * The adapter's own handle for the capability, recorded server-side so a
   * crash between issuing and recording is recoverable. It never reaches a
   * client, because it is provider state and not a product fact.
   */
  readonly providerReference: string;
  readonly url: string;
}

/**
 * What the provider says about a stored object.
 *
 * `providerContentType` is evidence about storage and never about content: a
 * provider that echoes a client-supplied `Content-Type` is echoing the client.
 * It is recorded for reconciliation and is never the platform's answer to "what
 * is this file".
 */
export interface MediaObjectStat {
  readonly byteSize: number;
  readonly providerContentType: string | undefined;
}

/**
 * Reading bytes is bounded, and exceeding the bound is an outcome rather than
 * an exception. An object larger than the platform will decode is a refusal the
 * pipeline records against the asset, not a crash in a worker.
 */
export type MediaObjectRead =
  | { readonly bytes: Uint8Array; readonly kind: 'bytes' }
  | { readonly kind: 'absent' }
  | { readonly byteSize: number; readonly kind: 'too_large' };

/**
 * Deletion is idempotent, and the two ways it can succeed are distinguished.
 *
 * `already_absent` is reported rather than folded into `deleted` because
 * whether an absent object counts as deleted is a provider-semantics question
 * the platform must answer per adapter, with the provider's own documentation
 * behind it. Folding them here would decide it for every future adapter at
 * once, silently.
 */
export type MediaDeletionOutcome = 'already_absent' | 'deleted';

/** A short-lived credential bound to exactly one object. */
export interface MediaDeliveryGrant {
  readonly expiresAt: Date;
  readonly url: string;
}

/**
 * The outcome of asking a delivery layer to forget something.
 *
 * `unsupported` is a first-class answer. A provider with no purge mechanism
 * must not be represented as having purged, because the whole reason the
 * platform tracks purge outcomes is to keep a failed one visible.
 */
export type MediaPurgeOutcome =
  | { readonly code: string; readonly kind: 'failed' }
  | { readonly kind: 'purged' }
  | { readonly kind: 'unsupported' };

export interface MediaStoragePort {
  /** Recorded on the object row for audit and for routing a later operation. */
  readonly name: string;
  /**
   * A credential for one object and one variant, valid until `expiresAt`.
   *
   * Issuing one is not an authorization decision. The caller has already made
   * that decision against current server truth; this only mints the token.
   */
  authorizeDelivery(input: {
    readonly expiresAt: Date;
    readonly objectKey: string;
  }): Promise<MediaDeliveryGrant>;
  createUploadCapability(input: {
    readonly expiresAt: Date;
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<MediaUploadCapability>;
  /** Idempotent. Absent is a documented success, not a failure. */
  deleteObject(objectKey: string): Promise<MediaDeletionOutcome>;
  /**
   * A permanent address for an object served to everybody, or `undefined` where
   * this provider serves no public class at all.
   *
   * Only ever called for a sanitized derivative. There is no arrangement under
   * which an original acquires one of these, and the delivery authority refuses
   * before it could ask.
   */
  publicAddress(objectKey: string): string | undefined;
  /** Asks the delivery layer to forget an address. Never assumed to have worked. */
  purge(objectKey: string): Promise<MediaPurgeOutcome>;
  readObject(input: {
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<MediaObjectRead>;
  /** Provider truth about one object, for verification and reconciliation. */
  statObject(objectKey: string): Promise<MediaObjectStat | undefined>;
  /** Writes a derivative the platform produced. */
  writeObject(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly objectKey: string;
  }): Promise<MediaObjectStat>;
}

export class MediaStorageUnavailableError extends Error {
  constructor() {
    super('No media storage provider is approved');
    this.name = 'MediaStorageUnavailableError';
  }
}

export class InvalidMediaObjectKeyError extends Error {
  constructor() {
    // Deliberately carries no key. A rejected key is attacker-supplied by
    // definition, and echoing it into a log is how a log becomes an injection
    // surface.
    super('Object key is not a server-generated media key');
    this.name = 'InvalidMediaObjectKeyError';
  }
}

/**
 * The exact shape of every key this platform generates.
 *
 * Adapters validate against it before touching a provider or a filesystem. Keys
 * are server-generated, so a key that fails this is a bug or an attack and
 * never a legitimate request — and because no path component is ever derived
 * from user input, traversal has no input to work with rather than being
 * filtered out afterwards.
 */
const uuidSegment =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const variantSegment = mediaVariantKinds.join('|');
const objectKeyPattern = new RegExp(
  `^media/${uuidSegment}/(?:original/[0-9a-f]{32}|variant/(?:${variantSegment})/v[1-9][0-9]{0,3}/[0-9a-f]{32})$`,
  'u',
);

export function isMediaObjectKey(value: string): boolean {
  return objectKeyPattern.test(value);
}

function requireObjectKey(value: string): string {
  if (!isMediaObjectKey(value)) throw new InvalidMediaObjectKeyError();
  return value;
}

/**
 * The default, and the only adapter any deployed environment may have.
 *
 * It stores nothing, reads nothing, and authorizes nothing, so an environment
 * with no approved provider cannot accept media at all. That is the intended
 * outcome: an empty profile is better than one running on bytes nobody vetted.
 */
export class UnavailableMediaStorage implements MediaStoragePort {
  readonly name = 'unavailable';

  authorizeDelivery(): Promise<MediaDeliveryGrant> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  createUploadCapability(): Promise<MediaUploadCapability> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  deleteObject(): Promise<MediaDeletionOutcome> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  publicAddress(): string | undefined {
    return undefined;
  }

  purge(): Promise<MediaPurgeOutcome> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  readObject(): Promise<MediaObjectRead> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  statObject(): Promise<MediaObjectStat | undefined> {
    return Promise.reject(new MediaStorageUnavailableError());
  }

  writeObject(): Promise<MediaObjectStat> {
    return Promise.reject(new MediaStorageUnavailableError());
  }
}

/**
 * Development and test adapter. Objects live in a directory and disappear with
 * it.
 *
 * It is filesystem-backed rather than in-process on purpose: inspection and
 * processing run in the worker and the API issues capabilities, and an
 * in-memory adapter would make two processes disagree about whether an object
 * exists — which is precisely the class of bug this platform exists to prevent.
 *
 * Three things about it are deliberately honest. Its addresses name this API
 * rather than a provider, because it has no provider: they are served by
 * {@link LocalTestMediaTransport}, which exists only when this adapter is
 * selected and sits outside `/v1` so no development behaviour lands on a
 * product route. Its upload and delivery credentials are real HMACs over the
 * object and the expiry, so the shape of a signed capability is exercised
 * rather than mocked. And it performs no malware scanning and no content
 * moderation whatsoever, so nothing it accepts is evidence about real user
 * content. Configuration refuses it outside local and test.
 */
export class LocalTestMediaStorage implements MediaStoragePort {
  readonly name = 'local-test';

  private readonly baseUrl: string;
  private readonly root: string;
  private readonly signingKey: string;

  constructor(input: {
    /** Where this API answers, as a client reaches it. No trailing slash. */
    readonly baseUrl: string;
    readonly directory: string;
    readonly signingKey: string;
  }) {
    this.baseUrl = input.baseUrl.replace(/\/+$/u, '');
    this.root = resolve(input.directory);
    this.signingKey = input.signingKey;
  }

  async authorizeDelivery(input: {
    readonly expiresAt: Date;
    readonly objectKey: string;
  }): Promise<MediaDeliveryGrant> {
    const objectKey = requireObjectKey(input.objectKey);
    const expires = Math.floor(input.expiresAt.getTime() / 1000);
    const signature = await this.sign(`${objectKey}:${String(expires)}`);
    return {
      expiresAt: input.expiresAt,
      url: this.address(localTestObjectPath, objectKey, expires, signature),
    };
  }

  /** Verifies a grant this adapter issued. Used by the local delivery path. */
  async verifyDelivery(input: {
    readonly at: Date;
    readonly expires: number;
    readonly objectKey: string;
    readonly signature: string;
  }): Promise<boolean> {
    if (!isMediaObjectKey(input.objectKey)) return false;
    if (!Number.isSafeInteger(input.expires)) return false;
    if (input.expires * 1000 <= input.at.getTime()) return false;
    const expected = await this.sign(
      `${input.objectKey}:${String(input.expires)}`,
    );
    // Length-independent comparison, so a rejected signature reveals nothing
    // about how much of it was right.
    return timingSafeEqual(expected, input.signature);
  }

  // `async`, so that a refused key arrives as a rejected promise rather than a
  // synchronous throw. The two are not interchangeable to a caller: a
  // synchronous throw escapes `objects.map((o) => storage.purge(o))` before
  // `Promise.all` ever sees it, abandoning the other calls, and slips past a
  // `.catch()` attached to the returned promise. Every other method on this
  // port rejects, and an interface whose error mode depends on which method you
  // called is one somebody eventually handles wrongly.
  async createUploadCapability(input: {
    readonly expiresAt: Date;
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<MediaUploadCapability> {
    const objectKey = requireObjectKey(input.objectKey);
    const expires = Math.floor(input.expiresAt.getTime() / 1000);
    // A different payload from the delivery grant, so a capability to write one
    // object can never be replayed as permission to read it.
    const signature = await this.sign(`upload:${objectKey}:${String(expires)}`);
    return {
      expiresAt: input.expiresAt,
      headers: {
        'x-velora-maximum-bytes': String(input.maximumBytes),
        'x-velora-upload-expires-at': input.expiresAt.toISOString(),
      },
      maximumBytes: input.maximumBytes,
      method: 'PUT',
      providerReference: `local-test:${objectKey}`,
      url: this.address(localTestObjectPath, objectKey, expires, signature),
    };
  }

  /** Verifies an upload capability this adapter issued. */
  async verifyUpload(input: {
    readonly at: Date;
    readonly expires: number;
    readonly objectKey: string;
    readonly signature: string;
  }): Promise<boolean> {
    if (!isMediaObjectKey(input.objectKey)) return false;
    if (!Number.isSafeInteger(input.expires)) return false;
    if (input.expires * 1000 <= input.at.getTime()) return false;
    const expected = await this.sign(
      `upload:${input.objectKey}:${String(input.expires)}`,
    );
    return timingSafeEqual(expected, input.signature);
  }

  /** Stands in for the client's upload. Test and development use only. */
  async putObject(objectKey: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async deleteObject(objectKey: string): Promise<MediaDeletionOutcome> {
    const path = this.pathFor(objectKey);
    const existing = await this.sizeOf(path);
    await rm(path, { force: true });
    return existing === undefined ? 'already_absent' : 'deleted';
  }

  publicAddress(objectKey: string): string | undefined {
    // Unsigned, like every other public address: the key already carries the
    // processing version and a random component, so a derivative that changes
    // is a different address rather than the same one behind a cache somebody
    // has to be trusted to forget.
    return `${this.baseUrl}${localTestPublicObjectPath}?key=${encodeURIComponent(
      requireObjectKey(objectKey),
    )}`;
  }

  // `async` for the reason `createUploadCapability` is.
  async purge(objectKey: string): Promise<MediaPurgeOutcome> {
    requireObjectKey(objectKey);
    // There is no cache in front of a directory. Reporting `purged` would be a
    // lie that a real adapter's tests would then be written against.
    return Promise.resolve({ kind: 'unsupported' });
  }

  async readObject(input: {
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<MediaObjectRead> {
    const path = this.pathFor(input.objectKey);
    const byteSize = await this.sizeOf(path);
    if (byteSize === undefined) return { kind: 'absent' };
    // Measured before anything is allocated, so an oversized object is refused
    // rather than read into memory and refused afterwards.
    if (byteSize > input.maximumBytes) return { byteSize, kind: 'too_large' };
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    return { bytes, kind: 'bytes' };
  }

  async statObject(objectKey: string): Promise<MediaObjectStat | undefined> {
    const byteSize = await this.sizeOf(this.pathFor(objectKey));
    if (byteSize === undefined) return undefined;
    // No content type. This adapter stores bytes and nothing beside them, which
    // is the honest answer: it has no provider metadata to report.
    return { byteSize, providerContentType: undefined };
  }

  async writeObject(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly objectKey: string;
  }): Promise<MediaObjectStat> {
    if (input.bytes.byteLength > maximumMediaObjectBytes) {
      throw new Error(
        'Refusing to write an object beyond the platform ceiling',
      );
    }
    await this.putObject(input.objectKey, input.bytes);
    return {
      byteSize: input.bytes.byteLength,
      providerContentType: input.contentType,
    };
  }

  private pathFor(objectKey: string): string {
    const key = requireObjectKey(objectKey);
    const path = resolve(join(this.root, key));
    // Belt and braces. The key pattern already makes this unreachable; a
    // containment check costs nothing and survives a future pattern edit.
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new InvalidMediaObjectKeyError();
    }
    return path;
  }

  private async sizeOf(path: string): Promise<number | undefined> {
    try {
      const entry = await stat(path);
      return entry.isFile() ? entry.size : undefined;
    } catch {
      return undefined;
    }
  }

  private address(
    path: string,
    objectKey: string,
    expires: number,
    signature: string,
  ): string {
    return `${this.baseUrl}${path}?key=${encodeURIComponent(objectKey)}&expires=${String(expires)}&signature=${signature}`;
  }

  private async sign(payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.signingKey),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload),
    );
    return [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
}

function timingSafeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

/** The content type a derivative of a given format is written with. */
export const mediaContentTypes: Readonly<Record<MediaImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
