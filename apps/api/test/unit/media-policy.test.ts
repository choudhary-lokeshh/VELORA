import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  maximumMediaObjectBytes,
  mediaAssetLifecycles,
  mediaDeliveryCredentialSeconds,
  mediaObjectKey,
  mediaTransitionAllowed,
  mediaVariantKinds,
  requiredMediaVariants,
  mediaAssetClasses,
  type MediaAssetLifecycle,
} from '../../src/media/policy.js';
import {
  LocalTestMediaScanner,
  localTestInfectedMarker,
  MediaScannerUnavailableError,
  UnavailableMediaScanner,
} from '../../src/media/scanner.js';
import type { MediaScannerPort } from '../../src/media/scanner.js';
import { sniffMediaFormat } from '../../src/media/sniff.js';
import {
  InvalidMediaObjectKeyError,
  isMediaObjectKey,
  LocalTestMediaStorage,
  MediaStorageUnavailableError,
  UnavailableMediaStorage,
} from '../../src/media/storage.js';

const assetId = '11111111-2222-4333-8444-555555555555';

/**
 * The error a rejected call produced.
 *
 * Bun's `expect(...).rejects` matcher is typed as returning nothing, so
 * awaiting it is both a lint error and a silent no-op waiting to happen.
 * Catching the value and asserting on it keeps the assertion real.
 */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('media lifecycle vocabulary', () => {
  it('shares no value with any publication vocabulary', () => {
    // The single invariant this domain rests on. If one of these ever appears,
    // somebody has given MEDIA a word that can be spent as permission, and
    // every other control in the platform becomes decorative.
    for (const forbidden of [
      'approved',
      'published',
      'public',
      'visible',
      'live',
    ]) {
      expect(mediaAssetLifecycles as readonly string[]).not.toContain(
        forbidden,
      );
    }
  });

  it('refuses every transition that is not on the map', () => {
    expect(mediaTransitionAllowed('initiated', 'awaiting_upload')).toBe(true);
    expect(mediaTransitionAllowed('inspecting', 'quarantined')).toBe(true);
    expect(mediaTransitionAllowed('processing', 'ready')).toBe(true);

    // The ones that would matter. A quarantined object must never become
    // deliverable, an upload must never skip inspection, and a deleted asset
    // must never come back.
    expect(mediaTransitionAllowed('quarantined', 'ready')).toBe(false);
    expect(mediaTransitionAllowed('quarantined', 'inspected')).toBe(false);
    expect(mediaTransitionAllowed('uploaded', 'ready')).toBe(false);
    expect(mediaTransitionAllowed('uploaded', 'inspected')).toBe(false);
    expect(mediaTransitionAllowed('awaiting_upload', 'processing')).toBe(false);
    expect(mediaTransitionAllowed('deleted', 'ready')).toBe(false);
    expect(mediaTransitionAllowed('deleted', 'deleting')).toBe(false);
  });

  it('lets a takedown interrupt anything that is not already finished', () => {
    const unfinished = mediaAssetLifecycles.filter(
      (lifecycle) => lifecycle !== 'deleting' && lifecycle !== 'deleted',
    );
    for (const lifecycle of unfinished as readonly MediaAssetLifecycle[]) {
      expect(
        mediaTransitionAllowed(lifecycle, 'deleting'),
        `${lifecycle} -> deleting`,
      ).toBe(true);
    }
  });

  it('owes every class a derivative set drawn from the variant vocabulary', () => {
    for (const assetClass of mediaAssetClasses) {
      const variants = requiredMediaVariants[assetClass];
      expect(variants.length).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(mediaVariantKinds as readonly string[]).toContain(variant);
      }
      // A duplicate would mean processing the same derivative twice and then
      // owing two purges for one address.
      expect(new Set(variants).size).toBe(variants.length);
    }
  });

  it('holds the private delivery window at its locked value', () => {
    // ADR-0023 locks this. It is the maximum time an already-issued credential
    // outlives the authorization that produced it, so changing it changes a
    // published security claim and requires editing the ADR.
    expect(mediaDeliveryCredentialSeconds).toBe(300);
  });
});

describe('media object keys', () => {
  it('generates keys nothing outside the platform contributed to', () => {
    const original = mediaObjectKey({ assetId, role: 'original' });
    const variant = mediaObjectKey({
      assetId,
      processingVersion: 1,
      role: 'variant',
      variantKind: 'avatar_small',
    });

    expect(isMediaObjectKey(original)).toBe(true);
    expect(isMediaObjectKey(variant)).toBe(true);
    // Two calls never collide, so a key cannot be computed from an identifier
    // that travels to clients.
    expect(mediaObjectKey({ assetId, role: 'original' })).not.toBe(original);
  });

  it('rejects every key a caller could have influenced', () => {
    for (const hostile of [
      `media/${assetId}/original/../../etc/passwd`,
      `media/${assetId}/original/..%2f..%2fetc`,
      '../../etc/passwd',
      '/etc/passwd',
      `media/${assetId}/original/`,
      `media/${assetId}/original/not-hex`,
      `media/${assetId}/variant/avatar_small/v1/short`,
      `media/${assetId}/variant/unknown_kind/v1/${'a'.repeat(32)}`,
      `media/${assetId}/original/${'a'.repeat(32)}\n`,
      `media/${assetId}/original/${'a'.repeat(32)}?x=1`,
      '',
    ]) {
      expect(isMediaObjectKey(hostile), hostile).toBe(false);
    }
  });
});

describe('the storage adapter that refuses', () => {
  it('refuses every operation, so no deployed environment can accept media', async () => {
    const storage = new UnavailableMediaStorage();
    const attempts = [
      () => storage.authorizeDelivery(),
      () => storage.createUploadCapability(),
      () => storage.deleteObject(),
      () => storage.purge(),
      () => storage.readObject(),
      () => storage.statObject(),
      () => storage.writeObject(),
    ];

    for (const attempt of attempts) {
      expect(await rejection(attempt)).toBeInstanceOf(
        MediaStorageUnavailableError,
      );
    }
  });
});

describe('the development storage adapter', () => {
  let directory: string;
  let storage: LocalTestMediaStorage;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'velora-media-'));
    storage = new LocalTestMediaStorage({
      directory,
      signingKey: 'development-only-key',
    });
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('stores, measures, reads, and deletes idempotently', async () => {
    const key = mediaObjectKey({ assetId, role: 'original' });
    expect(await storage.statObject(key)).toBeUndefined();
    expect(
      await storage.readObject({ maximumBytes: 1024, objectKey: key }),
    ).toEqual({ kind: 'absent' });

    await storage.putObject(key, new Uint8Array([1, 2, 3, 4]));
    expect(await storage.statObject(key)).toEqual({
      byteSize: 4,
      providerContentType: undefined,
    });
    expect(
      await storage.readObject({ maximumBytes: 1024, objectKey: key }),
    ).toEqual({ bytes: new Uint8Array([1, 2, 3, 4]), kind: 'bytes' });

    expect(await storage.deleteObject(key)).toBe('deleted');
    // Deleting twice is a documented success, not a failure to swallow.
    expect(await storage.deleteObject(key)).toBe('already_absent');
  });

  it('refuses an oversized read instead of allocating it', async () => {
    const key = mediaObjectKey({ assetId, role: 'original' });
    await storage.putObject(key, new Uint8Array(64));

    expect(
      await storage.readObject({ maximumBytes: 32, objectKey: key }),
    ).toEqual({ byteSize: 64, kind: 'too_large' });
    await storage.deleteObject(key);
  });

  it('will not write beyond the platform ceiling', async () => {
    const error = await rejection(() =>
      storage.writeObject({
        bytes: new Uint8Array(maximumMediaObjectBytes + 1),
        contentType: 'image/webp',
        objectKey: mediaObjectKey({
          assetId,
          processingVersion: 1,
          role: 'variant',
          variantKind: 'card',
        }),
      }),
    );
    expect((error as Error).message).toContain('platform ceiling');
  });

  it('refuses a key it did not generate before touching the filesystem', async () => {
    for (const hostile of ['../../etc/passwd', 'media/../../etc/passwd']) {
      expect(
        await rejection(() => storage.statObject(hostile)),
        hostile,
      ).toBeInstanceOf(InvalidMediaObjectKeyError);
      expect(
        await rejection(() => storage.deleteObject(hostile)),
        hostile,
      ).toBeInstanceOf(InvalidMediaObjectKeyError);
    }
    // The refusal carries no key. A rejected key is attacker-supplied by
    // definition, and echoing it into a message is how a log becomes a surface.
    const error = new InvalidMediaObjectKeyError();
    expect(error.message).not.toContain('passwd');
  });

  it('binds a delivery grant to one object and one instant', async () => {
    const key = mediaObjectKey({
      assetId,
      processingVersion: 1,
      role: 'variant',
      variantKind: 'display',
    });
    const other = mediaObjectKey({
      assetId,
      processingVersion: 1,
      role: 'variant',
      variantKind: 'card',
    });
    const at = new Date('2026-08-16T12:00:00.000Z');
    const expiresAt = new Date(
      at.getTime() + mediaDeliveryCredentialSeconds * 1000,
    );

    const grant = await storage.authorizeDelivery({
      expiresAt,
      objectKey: key,
    });
    const parsed = new URL(grant.url);
    const signature = parsed.searchParams.get('signature') ?? '';
    const expires = Number(parsed.searchParams.get('expires'));

    expect(
      await storage.verifyDelivery({ at, expires, objectKey: key, signature }),
    ).toBe(true);

    // A credential minted for one variant does not open another.
    expect(
      await storage.verifyDelivery({
        at,
        expires,
        objectKey: other,
        signature,
      }),
    ).toBe(false);
    // Nor does a tampered expiry, because the instant is signed.
    expect(
      await storage.verifyDelivery({
        at,
        expires: expires + 3600,
        objectKey: key,
        signature,
      }),
    ).toBe(false);
    // Nor a tampered signature.
    expect(
      await storage.verifyDelivery({
        at,
        expires,
        objectKey: key,
        signature: signature.replace(/^./u, (first) =>
          first === '0' ? '1' : '0',
        ),
      }),
    ).toBe(false);
    // And it stops working the moment it expires, which is the whole bound on
    // revocation exposure for private media.
    expect(
      await storage.verifyDelivery({
        at: new Date(expiresAt.getTime() + 1),
        expires,
        objectKey: key,
        signature,
      }),
    ).toBe(false);
  });

  it('reports that it cannot purge rather than claiming it did', async () => {
    // There is no cache in front of a directory. Reporting a purge would be a
    // lie a real adapter's tests would then be written against.
    expect(
      await storage.purge(mediaObjectKey({ assetId, role: 'original' })),
    ).toEqual({ kind: 'unsupported' });
  });
});

describe('format admission', () => {
  it('accepts exactly the three formats on the list', () => {
    expect(sniffMediaFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'jpeg',
    );
    expect(
      sniffMediaFormat(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('png');
    expect(
      sniffMediaFormat(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ),
    ).toBe('webp');
  });

  it('refuses everything else, including things a decoder would take', () => {
    const cases: readonly (readonly [string, readonly number[]])[] = [
      ['svg', [0x3c, 0x73, 0x76, 0x67]],
      ['gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
      ['tiff', [0x49, 0x49, 0x2a, 0x00]],
      ['bmp', [0x42, 0x4d]],
      ['pdf', [0x25, 0x50, 0x44, 0x46]],
      ['zip', [0x50, 0x4b, 0x03, 0x04]],
      ['html', [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]],
      ['empty', []],
      [
        'riff-not-webp',
        [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20],
      ],
      ['truncated-png', [0x89, 0x50, 0x4e, 0x47]],
    ];
    for (const [name, bytes] of cases) {
      expect(sniffMediaFormat(new Uint8Array(bytes)), name).toBeUndefined();
    }
  });
});

describe('the scanner that refuses', () => {
  it('never reports a verdict, because it has none to report', async () => {
    // Called through the port, because the port is what inspection holds.
    const scanner: MediaScannerPort = new UnavailableMediaScanner();
    expect(
      await rejection(() =>
        scanner.scan({ bytes: new Uint8Array([1]), objectKey: 'unused' }),
      ),
    ).toBeInstanceOf(MediaScannerUnavailableError);
  });

  it('recognises the development marker and nothing else', async () => {
    const scanner: MediaScannerPort = new LocalTestMediaScanner();
    expect(
      await scanner.scan({
        bytes: new TextEncoder().encode('an ordinary file'),
        objectKey: 'unused',
      }),
    ).toBe('clean');
    expect(
      await scanner.scan({
        bytes: new TextEncoder().encode(
          `before${localTestInfectedMarker}after`,
        ),
        objectKey: 'unused',
      }),
    ).toBe('infected');
    // A marker split across the boundary is not a marker.
    expect(
      await scanner.scan({
        bytes: new TextEncoder().encode(localTestInfectedMarker.slice(0, -1)),
        objectKey: 'unused',
      }),
    ).toBe('clean');
  });
});
