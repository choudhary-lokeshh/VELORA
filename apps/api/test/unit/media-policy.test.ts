import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  maximumMediaObjectBytes,
  mediaAssetLifecycles,
  mediaBacklogKinds,
  mediaBacklogThresholdMilliseconds,
  mediaDeliveryCredentialSeconds,
  mediaDriftAttentionMilliseconds,
  mediaDriftKinds,
  mediaObjectKey,
  mediaObligationKinds,
  mediaPurgeStallMilliseconds,
  mediaStallMilliseconds,
  mediaTransitionAllowed,
  mediaVariantKinds,
  requiredMediaVariants,
  mediaAssetClasses,
  stalledMediaLifecycles,
  transientMediaLifecycles,
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

/** Any origin. These suites assert signatures and refusals, never addresses. */
const localTestBaseUrl = 'http://127.0.0.1:4000';

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
      baseUrl: localTestBaseUrl,
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

describe('the backlogs an operator can be paged about', () => {
  it('has a class for every kind of work the platform can owe', () => {
    // A new obligation kind with no backlog class would be work that could pile
    // up invisibly, which is the exact failure this table exists to prevent. It
    // is asserted against the obligation vocabulary rather than against a list
    // written here, so adding a kind fails until somebody decides how late is
    // too late for it.
    for (const kind of mediaObligationKinds) {
      expect(mediaBacklogKinds as readonly string[]).toContain(
        `${kind}_pending`,
      );
    }
  });

  it('gives every class a threshold, and takes them from the machine', () => {
    for (const backlog of mediaBacklogKinds) {
      expect(
        mediaBacklogThresholdMilliseconds[backlog],
        backlog,
      ).toBeGreaterThan(0);
    }

    // Derived from the deadlines the platform already runs on rather than
    // chosen for a dashboard. A threshold shorter than the sweep's own bound
    // would page somebody about work that is proceeding normally, and a longer
    // one would stay quiet while reconciliation was already repairing.
    expect(mediaBacklogThresholdMilliseconds.purge_pending).toBe(
      mediaStallMilliseconds,
    );
    expect(mediaBacklogThresholdMilliseconds.lifecycle_stalled).toBe(
      mediaStallMilliseconds,
    );
    expect(mediaBacklogThresholdMilliseconds.purge_unanswered).toBe(
      mediaPurgeStallMilliseconds,
    );
    // The one exception, and it is measured against a person rather than a
    // worker: what is left open is the drift no automatic correction was safe
    // for, and only somebody deciding closes it.
    expect(mediaBacklogThresholdMilliseconds.drift_open).toBe(
      mediaDriftAttentionMilliseconds,
    );
    expect(mediaDriftAttentionMilliseconds).toBeGreaterThan(
      mediaStallMilliseconds,
    );
  });

  it('measures a stalled asset on the states the platform owes, not on every one in flight', () => {
    // `initiated` and `awaiting_upload` are somebody choosing a file. They are
    // transient, they are swept on their own far longer clock, and counting
    // them would report every upload in progress as a backlog.
    for (const lifecycle of stalledMediaLifecycles) {
      expect(transientMediaLifecycles as readonly string[]).toContain(
        lifecycle,
      );
    }
    expect(stalledMediaLifecycles as readonly string[]).not.toContain(
      'initiated',
    );
    expect(stalledMediaLifecycles as readonly string[]).not.toContain(
      'awaiting_upload',
    );
  });

  it('gives dead-lettered work no threshold at all', () => {
    // A dead letter is not a backlog draining slowly; it is work the platform
    // gave up on, actionable the instant it appears. A threshold would imply
    // there is an amount of it that is fine.
    for (const backlog of mediaBacklogKinds) {
      expect(backlog).not.toContain('dead_letter');
    }
  });
});

describe('the runbook and the vocabulary it describes', () => {
  /**
   * A runbook that names classes the platform no longer reports, or omits ones
   * it does, sends an operator looking for a row that is not there. The
   * document is the operator's authority for what a backlog means and what is
   * safe to do about it, so it is held to the vocabulary rather than trusted to
   * be updated alongside it.
   */
  const runbook = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../docs/operations/06-media-operations.md',
    ),
    'utf8',
  );

  it('documents every backlog class the platform reports', () => {
    for (const backlog of mediaBacklogKinds) {
      expect(runbook, backlog).toContain(`\`${backlog}\``);
    }
  });

  it('names no class the platform does not report', () => {
    // Every fenced `something_pending`, `..._open`, or `..._stalled` token in
    // the table is a class the screen must actually carry.
    const named = runbook.match(
      /`[a-z]+_(?:pending|open|stalled|unanswered)`/gu,
    );
    for (const token of named ?? []) {
      expect(mediaBacklogKinds as readonly string[], token).toContain(
        token.replaceAll('`', ''),
      );
    }
  });

  it('states that dead letters are not a backlog with an age', () => {
    // The one rule most likely to be quietly lost: a threshold on a dead letter
    // would imply there is an amount of abandoned work that is acceptable.
    expect(runbook).toContain('carry no age threshold');
  });

  it('documents every drift kind reconciliation can raise', () => {
    // A backlog tells an operator to wait or to look; a finding tells them what
    // follows, and each kind's answer is different — an original that is gone
    // cannot be conjured where a derivative can be rendered again. A kind
    // missing from the runbook arrives with no guidance at all.
    for (const kind of mediaDriftKinds) {
      expect(runbook, kind).toContain(`\`${kind}\``);
    }
  });

  it('names in its tables only vocabulary the platform reports', () => {
    // Anchored on the tables rather than on prose: the first cell of a fenced
    // row is where the runbook asserts a term exists, and a term listed there
    // that nothing raises sends somebody looking for a row that cannot appear.
    const vocabulary: readonly string[] = [
      ...mediaBacklogKinds,
      ...mediaDriftKinds,
    ];
    const tabled = runbook.split('\n').flatMap((line) => {
      const [, term] = /^\| `([a-z_]+)` \|/u.exec(line) ?? [];
      return term === undefined ? [] : [term];
    });
    expect(tabled.length).toBe(vocabulary.length);
    for (const term of tabled) {
      expect(vocabulary, term).toContain(term);
    }
  });
});
