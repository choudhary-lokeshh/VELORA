import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import sharp from 'sharp';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaObjectKey,
  mediaVariantKinds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import {
  InvalidMediaObjectKeyError,
  isMediaObjectKey,
  LocalTestMediaStorage,
} from '../../src/media/storage.js';
import * as fixture from '../support/media-fixtures.js';
import {
  connectDatabase,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * Adversarial regressions for the media platform.
 *
 * Each test here is an attack rather than a feature: it asserts that a
 * particular way of reaching bytes, forging an address, smuggling a payload
 * past inspection, or learning something from a log does not work. Where the
 * platform's honest answer is "this is exposed and here is exactly how far",
 * the test asserts the bound rather than pretending there is none.
 *
 * It deliberately does not repeat what the behaviour suites already attack.
 * Polyglots, pixel bombs, animation, quarantine finality, credential binding
 * across assets and variants, and cross-owner reads are covered where they were
 * built and are not re-asserted here. What is here is what a hostile read of
 * the finished platform turns up that nothing else asks.
 */

/** Any origin. These suites assert signatures and refusals, never addresses. */
const localTestBaseUrl = 'http://127.0.0.1:4000';

const databaseUrl = await provisionDatabase('velora_media_red_team');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-red-team-'));

let clock = new Date('2026-08-17T10:00:00.000Z');

const config = testServerConfig({
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
  MEDIA_MALWARE_SCANNER: 'local-test',
  MEDIA_STORAGE_PROVIDER: 'local-test',
});

const media = createMediaRuntime({
  config,
  database: database.drizzle,
  logger: silentLogger(),
  now: () => clock,
  performsByteWork: true,
});
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '66666666-6666-4666-8666-666666666666',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

async function readyAsset(bytes?: Uint8Array): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `red-${String(operation).padStart(4, '0')}`,
    ...owner,
  });
  if (created.kind !== 'upload_ready') throw new Error('expected an upload');
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  await storage.putObject(
    session?.object_key ?? '',
    bytes ?? (await fixture.image({ format: 'png' })),
  );
  await media.service.recordUpload({ assetId: created.asset.id, ...owner });
  await media.service.runInspections({ owner: 'red-team' });
  await media.service.runProcessing({ owner: 'red-team' });
  return created.asset.id;
}

const validKey = mediaObjectKey({
  assetId: '77777777-7777-4777-8777-777777777777',
  role: 'original',
});

beforeEach(async () => {
  clock = new Date('2026-08-17T10:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('an object key cannot be talked into naming something else', () => {
  /**
   * Every one of these is refused by the *shape* rather than by a filter.
   *
   * Keys are server-generated, so a key that fails this is a defect or an
   * attack and never a legitimate request. The pattern is an allow-list of the
   * exact form this platform emits, which is why traversal has no input to work
   * with rather than being stripped out afterwards — there is no sanitising
   * step here to get wrong.
   */
  const forgeries: readonly (readonly [string, string])[] = [
    ['climbing out of the root', 'media/../../etc/passwd'],
    [
      'climbing out from inside a valid prefix',
      'media/77777777-7777-4777-8777-777777777777/original/../../../etc/passwd',
    ],
    ['an absolute path', '/etc/passwd'],
    ['a bare relative path', '../etc/passwd'],
    ['a single dot segment', `media/./77777777-7777-4777-8777-777777777777`],
    ['uppercase hex, which this platform never emits', validKey.toUpperCase()],
    ['a truncated random component', validKey.slice(0, -1)],
    ['an overlong random component', `${validKey}a`],
    [
      'a variant kind nobody defined',
      'media/77777777-7777-4777-8777-777777777777/variant/secret/v1/00000000000000000000000000000000',
    ],
    [
      'processing version zero',
      'media/77777777-7777-4777-8777-777777777777/variant/card/v0/00000000000000000000000000000000',
    ],
    [
      'a leading-zero processing version',
      'media/77777777-7777-4777-8777-777777777777/variant/card/v01/00000000000000000000000000000000',
    ],
    [
      'an unbounded processing version',
      'media/77777777-7777-4777-8777-777777777777/variant/card/v99999/00000000000000000000000000000000',
    ],
    [
      'a role nobody defined',
      'media/77777777-7777-4777-8777-777777777777/thumbnail/00000000000000000000000000000000',
    ],
    ['a key with no namespace at all', '00000000000000000000000000000000'],
    ['an empty key', ''],
    [
      'a trailing newline, which some engines treat as the end',
      `${validKey}\n`,
    ],
    ['a leading newline hiding a valid key', `\n${validKey}`],
    ['a null byte terminating a valid key', `${validKey}\u0000/etc/passwd`],
    ['a second key smuggled after a newline', `${validKey}\nmedia/x`],
    ['a query string appended to a valid key', `${validKey}?x=1`],
    ['a fragment appended to a valid key', `${validKey}#x`],
    ['percent-encoded traversal', 'media%2F..%2F..%2Fetc%2Fpasswd'],
    [
      'a UUID that is not one',
      'media/not-a-uuid/original/00000000000000000000000000000000',
    ],
    ['whitespace padding around a valid key', ` ${validKey} `],
  ];

  it('refuses every forged shape', () => {
    for (const [description, forged] of forgeries) {
      expect(isMediaObjectKey(forged), description).toBe(false);
    }
    // And the one the platform actually emits is accepted, so the assertion
    // above is not passing because everything is refused.
    expect(isMediaObjectKey(validKey)).toBe(true);
    for (const kind of mediaVariantKinds) {
      expect(
        isMediaObjectKey(
          mediaObjectKey({
            assetId: '77777777-7777-4777-8777-777777777777',
            processingVersion: 1,
            role: 'variant',
            variantKind: kind,
          }),
        ),
        kind,
      ).toBe(true);
    }
  });

  it('refuses a forged key at the adapter rather than at the caller', async () => {
    // The guard is inside the adapter, on every operation that names an object,
    // so a future caller that forgets to validate cannot reach a filesystem or
    // a provider with attacker-shaped input.
    for (const [description, forged] of forgeries) {
      for (const attempt of [
        () => storage.statObject(forged),
        () => storage.deleteObject(forged),
        () => storage.readObject({ maximumBytes: 1_000, objectKey: forged }),
        () => storage.purge(forged),
        () =>
          storage.authorizeDelivery({
            expiresAt: new Date(clock.getTime() + 60_000),
            objectKey: forged,
          }),
        () =>
          storage.createUploadCapability({
            expiresAt: new Date(clock.getTime() + 60_000),
            maximumBytes: 1_000,
            objectKey: forged,
          }),
        () =>
          storage.writeObject({
            bytes: new Uint8Array([1]),
            contentType: 'image/png',
            objectKey: forged,
          }),
      ]) {
        // Resolved into a value rather than asserted with `.rejects`, so that
        // a method which threw *synchronously* instead of rejecting would fail
        // here rather than escaping the assertion — which is exactly the
        // inconsistency this sweep found in two of these methods.
        const failure: unknown = await attempt().then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure, description).toBeInstanceOf(InvalidMediaObjectKeyError);
      }
      expect(() => storage.publicAddress(forged), description).toThrow(
        InvalidMediaObjectKeyError,
      );
    }
  });

  it('carries no key, and therefore nothing an attacker chose, out of the root', async () => {
    const assetId = await readyAsset();
    const objects = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects where asset_id = ${assetId}`,
    );

    // Nothing outside the media namespace was created, so even a key that
    // somehow passed the pattern could not have escaped: the containment check
    // in the adapter is the second lock and the pattern is the first.
    const entries = await readdir(directory);
    expect(entries).toEqual(['media']);
    for (const object of objects) {
      expect(object.object_key.startsWith('media/')).toBe(true);
      expect(object.object_key).not.toContain('..');
    }
  });

  it('refuses a name the platform never generated, even a well-formed one', async () => {
    // Correct shape, and no record anywhere claims it. The adapter will happily
    // answer about it because it is only an address — what matters is that the
    // platform never *serves* it, because delivery is authorised from a record
    // and not from a key. Key knowledge is worth nothing here, which is why the
    // random component exists.
    const invented = mediaObjectKey({
      assetId: crypto.randomUUID(),
      role: 'original',
    });
    expect(isMediaObjectKey(invented)).toBe(true);
    expect(await storage.statObject(invented)).toBeUndefined();
    expect(
      await rowsOf(
        database.sql`select 1 from media_objects where object_key = ${invented}`,
      ),
    ).toHaveLength(0);
  });
});

describe('a delivery credential cannot be extended, moved, or forged', () => {
  async function grantFor(assetId: string) {
    const [variant] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'variant'
                   order by variant_kind limit 1`,
    );
    const objectKey = variant?.object_key ?? '';
    const grant = await storage.authorizeDelivery({
      expiresAt: new Date(clock.getTime() + 300_000),
      objectKey,
    });
    const url = new URL(grant.url);
    return {
      expires: Number(url.searchParams.get('expires')),
      objectKey,
      signature: url.searchParams.get('signature') ?? '',
    };
  }

  it('refuses an expiry moved forward without a new signature', async () => {
    const parts = await grantFor(await readyAsset());
    expect(await storage.verifyDelivery({ at: clock, ...parts })).toBe(true);

    // The signature covers the object and the instant together, so buying more
    // time means forging the signature too.
    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: parts.expires + 86_400,
        objectKey: parts.objectKey,
        signature: parts.signature,
      }),
    ).toBe(false);
  });

  it('refuses a signature truncated, padded, or altered by one character', async () => {
    const parts = await grantFor(await readyAsset());
    const flipped = `${parts.signature.slice(0, -1)}${
      parts.signature.endsWith('0') ? '1' : '0'
    }`;

    for (const signature of [
      '',
      parts.signature.slice(0, -1),
      `${parts.signature}0`,
      flipped,
      parts.signature.toUpperCase(),
    ]) {
      expect(
        await storage.verifyDelivery({ at: clock, ...parts, signature }),
        signature.slice(0, 8),
      ).toBe(false);
    }
  });

  it('refuses a signature minted with a different key', async () => {
    const assetId = await readyAsset();
    const parts = await grantFor(assetId);
    // A second deployment, or a rotated key, or an attacker's own HMAC. None of
    // them can mint a credential this adapter honours.
    const impostor = new LocalTestMediaStorage({
      baseUrl: localTestBaseUrl,
      directory,
      signingKey: 'a-different-development-only-key',
    });
    const forged = new URL(
      (
        await impostor.authorizeDelivery({
          expiresAt: new Date(clock.getTime() + 300_000),
          objectKey: parts.objectKey,
        })
      ).url,
    );

    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: Number(forged.searchParams.get('expires')),
        objectKey: parts.objectKey,
        signature: forged.searchParams.get('signature') ?? '',
      }),
    ).toBe(false);
  });

  it('refuses an expiry that is not a number the platform could have written', async () => {
    const parts = await grantFor(await readyAsset());
    for (const expires of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 2,
      1.5,
      -1,
    ]) {
      expect(
        await storage.verifyDelivery({ at: clock, ...parts, expires }),
        String(expires),
      ).toBe(false);
    }
  });

  it('refuses a credential whose key is a forgery, before comparing anything', async () => {
    const parts = await grantFor(await readyAsset());
    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: parts.expires,
        objectKey: 'media/../../etc/passwd',
        signature: parts.signature,
      }),
    ).toBe(false);
  });
});

describe('nothing a source carries survives into what is served', () => {
  it('strips every private block, not merely the one a test remembered', async () => {
    const { bytes, deviceMarker } = await fixture.imageWithPrivateMetadata();
    const assetId = await readyAsset(bytes);

    const objects = await rowsOf<{
      readonly object_key: string;
      readonly role: string;
    }>(
      database.sql`select object_key, role from media_objects where asset_id = ${assetId}`,
    );
    const variants = objects.filter((one) => one.role === 'variant');
    expect(variants.length).toBeGreaterThan(0);

    for (const variant of variants) {
      const read = await storage.readObject({
        maximumBytes: 20_000_000,
        objectKey: variant.object_key,
      });
      if (read.kind !== 'bytes') throw new Error('expected derivative bytes');

      // Asked of the decoder rather than of a byte search, because a byte
      // search proves only that one spelling is absent.
      const metadata = await sharp(read.bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();

      // And the device name does not survive anywhere in the bytes either,
      // which catches a block the decoder does not surface.
      const haystack = Buffer.from(read.bytes).toString('latin1');
      expect(haystack).not.toContain(deviceMarker);
      expect(haystack).not.toContain('GPS');
    }

    // The original still has it. Stripping is a property of what the platform
    // *serves*, not a destruction of what somebody uploaded.
    const [original] = objects.filter((one) => one.role === 'original');
    const source = await storage.readObject({
      maximumBytes: 20_000_000,
      objectKey: original?.object_key ?? '',
    });
    if (source.kind !== 'bytes') throw new Error('expected the original');
    expect(Buffer.from(source.bytes).toString('latin1')).toContain(
      deviceMarker,
    );
  });

  it('does not let a payload in metadata reach a derivative', async () => {
    // A script tag in a comment block is harmless in a JPEG and dangerous in
    // anything that renders the file as markup. The platform renders from
    // decoded pixels, so the payload has nowhere to travel.
    const payload = '<script>alert(1)</script>';
    const bytes = await fixture.imageWithTextPayload(payload);
    const assetId = await readyAsset(bytes);

    const [variant] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'variant' limit 1`,
    );
    const read = await storage.readObject({
      maximumBytes: 20_000_000,
      objectKey: variant?.object_key ?? '',
    });
    if (read.kind !== 'bytes') throw new Error('expected derivative bytes');
    expect(Buffer.from(read.bytes).toString('latin1')).not.toContain(payload);
  });
});

describe('bytes that arrive by another door are not adopted', () => {
  it('does not serve an object written straight into the store', async () => {
    // An attacker with write access to the bucket, or a stray process. The
    // bytes exist at a well-formed key and no record claims them.
    const planted = mediaObjectKey({
      assetId: crypto.randomUUID(),
      processingVersion: 1,
      role: 'variant',
      variantKind: 'card',
    });
    await storage.putObject(planted, new Uint8Array([1, 2, 3]));
    expect(await storage.statObject(planted)).toBeDefined();

    // Nothing in the platform knows about them, so nothing can authorise them:
    // every delivery decision starts from an asset record.
    expect(
      await rowsOf(
        database.sql`select 1 from media_objects where object_key = ${planted}`,
      ),
    ).toHaveLength(0);
    expect(await rowsOf(database.sql`select 1 from media_assets`)).toHaveLength(
      0,
    );
  });

  it('refuses to record an object under a key another asset already holds', async () => {
    const assetId = await readyAsset();
    const [original] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'original'`,
    );

    // Two assets cannot come to share bytes by sharing an address, so one
    // owner's media can never be overwritten or read through another's record.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `insert into media_objects (asset_id, created_at, id, object_key, provider, role, state, updated_at, verified_at)
           values ('${assetId}', now(), '${crypto.randomUUID()}', '${original?.object_key ?? ''}', 'local-test', 'variant', 'present', now(), now())`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a refused upload can still be taken away', () => {
  it('removes a quarantined asset rather than refusing at the database', async () => {
    operation += 1;
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `red-quar-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');
    const assetId = created.asset.id;
    const [session] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions
                   where asset_id = ${assetId} and state = 'issued'`,
    );
    await storage.putObject(session?.object_key ?? '', fixture.svg());
    await media.service.recordUpload({ assetId, ...owner });
    await media.service.runInspections({ owner: 'red-team' });
    expect(
      (
        await rowsOf<{ readonly lifecycle: string }>(
          database.sql`select lifecycle from media_assets where id = ${assetId}`,
        )
      )[0]?.lifecycle,
    ).toBe('quarantined');

    // The shape check used to be an equivalence between `quarantined` and
    // carrying a rejection reason, so moving off `quarantined` while keeping
    // the reason was a state the database refused — and the transition table
    // permits exactly that move. A person deleting a rejected upload, or an
    // account taking its media with it, hit a constraint violation.
    const removal = await media.service.requestDeletion({ assetId });
    expect(removal.kind).toBe('asset');
    await media.service.runDeletions({ owner: 'red-team' });

    const [asset] = await rowsOf<{
      readonly lifecycle: string;
      readonly rejection_reason: string | null;
    }>(
      database.sql`select lifecycle, rejection_reason from media_assets where id = ${assetId}`,
    );
    expect(asset?.lifecycle).toBe('deleted');
    // And it still says why it was refused. A deleted asset keeps the record of
    // what it was, which is what an appeal and an audit both need.
    expect(asset?.rejection_reason).toBe('unsupported_format');
  });

  it('still refuses a reason on an asset that was never refused', async () => {
    const assetId = await readyAsset();

    // The other half of what the equivalence used to buy, kept rather than
    // dropped in the fix: a `ready` asset carrying a refusal reason would be a
    // record that lies about its own history.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set rejection_reason = 'scan_refused' where id = '${assetId}'`,
        ),
      ),
    ).toBe(true);
  });
});

describe('what the platform says out loud gives nothing away', () => {
  it('puts no key, address, digest, or byte of content in a log line', async () => {
    const records: unknown[] = [];
    const talkative = createMediaRuntime({
      config,
      database: database.drizzle,
      logger: silentLogger(records),
      now: () => clock,
      performsByteWork: true,
    });

    // Drive the whole pipeline, including the paths that fail: a refusal is
    // where a careless implementation reaches for the provider's own message.
    operation += 1;
    const created = await talkative.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `red-log-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');
    const assetId = created.asset.id;
    const [session] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions
                   where asset_id = ${assetId} and state = 'issued'`,
    );
    const objectKey = session?.object_key ?? '';
    await storage.putObject(objectKey, fixture.svg());
    await talkative.service.recordUpload({ assetId, ...owner });
    await talkative.service.runInspections({ owner: 'red-team' });
    await talkative.service.runProcessing({ owner: 'red-team' });
    await talkative.service.requestDeletion({ assetId });
    await talkative.service.runDeletions({ owner: 'red-team' });
    await talkative.service.runPurges({ owner: 'red-team' });

    const dump = JSON.stringify(records);
    expect(dump).not.toContain(objectKey);
    expect(dump).not.toContain(assetId);
    expect(dump).not.toContain(owner.ownerReference);
    expect(dump).not.toContain('media/');
    expect(dump).not.toContain('velora.invalid');
    expect(dump).not.toContain(created.capability.url);
    // The rejection reason is internal and machine-readable, and it stays
    // internal: it tells an attacker which control refused them.
    expect(dump).not.toContain('unsupported_format');
  });

  it('tells an uploader something coarser than it knows', async () => {
    operation += 1;
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `red-coarse-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');
    const [session] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions
                   where asset_id = ${created.asset.id} and state = 'issued'`,
    );
    await storage.putObject(session?.object_key ?? '', fixture.svg());
    await media.service.recordUpload({ assetId: created.asset.id, ...owner });
    await media.service.runInspections({ owner: 'red-team' });

    const [readiness] = await media.service.describeReadiness({
      assetIds: [created.asset.id],
    });
    // `unsupported_type` rather than `unsupported_format`: the internal set
    // distinguishes an undecodable file from a disguised one from a pixel bomb,
    // which is useful to an operator and useful to somebody probing what the
    // platform will accept.
    expect(readiness?.state).toBe('rejected');
    expect(readiness?.rejection).toBe('unsupported_type');
    const [asset] = await rowsOf<{ readonly rejection_reason: string }>(
      database.sql`select rejection_reason from media_assets where id = ${created.asset.id}`,
    );
    expect(asset?.rejection_reason).toBe('unsupported_format');
  });
});

describe('the adapter in force is decided once, and not by a request', () => {
  it('cannot be selected by anything a caller supplies', () => {
    // Configuration alone, from a closed registry, at the composition root. No
    // route, header, query parameter, or request field reaches the choice — so
    // the development adapter cannot be activated from outside the process, and
    // a deployed environment with no approved provider refuses everything.
    const unavailable = createMediaRuntime({
      config: testServerConfig(),
      database: database.drizzle,
      logger: silentLogger(),
    });

    expect(unavailable.storage.name).toBe('unavailable');
    expect(unavailable.scanner.name).toBe('unavailable');
    // And it composes no byte work at all, so decoding hostile input is not
    // something this process could be talked into.
    expect(unavailable.reconciliation).toBeUndefined();
    expect(unavailable.storage.publicAddress('anything')).toBeUndefined();
  });

  it('refuses every operation when no provider is approved', async () => {
    const unavailable = createMediaRuntime({
      config: testServerConfig(),
      database: database.drizzle,
      logger: silentLogger(),
    });

    // Not a degraded mode: an environment with no approved storage cannot
    // accept media at all, which is the intended outcome rather than a gap.
    operation += 1;
    expect(
      await unavailable.service.createUpload({
        assetClass: profileImage,
        idempotencyKey: `red-none-${String(operation).padStart(4, '0')}`,
        ...owner,
      }),
    ).toEqual({ kind: 'storage_unavailable' });
  });
});
