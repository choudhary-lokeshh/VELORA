import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  LocalTestMediaTransport,
  localTestObjectPath,
  localTestPublicObjectPath,
} from '../../src/media/local-transport.js';
import { mediaObjectKey } from '../../src/media/policy.js';
import { LocalTestMediaStorage } from '../../src/media/storage.js';

/**
 * The development adapter has to be walkable, and only walkable in development.
 *
 * Before this transport existed the adapter issued `media.velora.invalid`
 * addresses — deliberately unroutable — so no browser and no phone could ever
 * place bytes. Onboarding requires a photo in `ready`, so a new account could
 * not reach the product at all without a row written straight into the
 * database. That is what these assert is over: a real signed upload, a real
 * signed read, and refusals for every way of asking without the signature the
 * platform issued.
 */

const baseUrl = 'http://127.0.0.1:4000';
const signingKey = 'development-only-key';
const assetId = '2f1d6c58-2b6e-4a52-9e2f-6d0d3a1c9a11';
// A one-pixel PNG. Small, and a format the platform's own sniffer admits.
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

describe('the development media transport', () => {
  let directory: string;
  let storage: LocalTestMediaStorage;
  let transport: LocalTestMediaTransport;
  let objectKey: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'velora-transport-'));
    storage = new LocalTestMediaStorage({ baseUrl, directory, signingKey });
    transport = new LocalTestMediaTransport({
      now: () => new Date(),
      store: storage,
    });
    objectKey = mediaObjectKey({ assetId, role: 'original' });
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('accepts the bytes a capability was issued for, and serves them back', async () => {
    const capability = await storage.createUploadCapability({
      expiresAt: new Date(Date.now() + 60_000),
      maximumBytes: 8_388_608,
      objectKey,
    });
    expect(capability.url.startsWith(`${baseUrl}${localTestObjectPath}?`)).toBe(
      true,
    );

    const written = await transport.put(
      new Request(capability.url, {
        headers: { 'x-velora-maximum-bytes': '8388608' },
        method: 'PUT',
      }),
      png,
    );
    expect(written.status).toBe(200);

    const grant = await storage.authorizeDelivery({
      expiresAt: new Date(Date.now() + 60_000),
      objectKey,
    });
    const served = await transport.get(new Request(grant.url));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  });

  it('refuses an upload capability replayed as a delivery grant', async () => {
    // Different signed payloads, so permission to write one object is never
    // also permission to read it.
    const capability = await storage.createUploadCapability({
      expiresAt: new Date(Date.now() + 60_000),
      maximumBytes: 8_388_608,
      objectKey,
    });
    const served = await transport.get(new Request(capability.url));
    expect(served.status).toBe(403);
  });

  it('refuses a forged signature, a missing one, and an expired one', async () => {
    const valid = await storage.authorizeDelivery({
      expiresAt: new Date(Date.now() + 60_000),
      objectKey,
    });
    const forged = valid.url.replace(
      /signature=[0-9a-f]+/u,
      `signature=${'0'.repeat(64)}`,
    );
    expect((await transport.get(new Request(forged))).status).toBe(403);

    const unsigned = `${baseUrl}${localTestObjectPath}?key=${encodeURIComponent(objectKey)}&expires=99999999999`;
    expect((await transport.get(new Request(unsigned))).status).toBe(400);

    const expired = await storage.authorizeDelivery({
      expiresAt: new Date(Date.now() - 1_000),
      objectKey,
    });
    expect((await transport.get(new Request(expired))).status).toBe(403);
  });

  it('refuses bytes beyond the ceiling the capability names', async () => {
    const capability = await storage.createUploadCapability({
      expiresAt: new Date(Date.now() + 60_000),
      maximumBytes: 16,
      objectKey,
    });
    const refused = await transport.put(
      new Request(capability.url, {
        headers: { 'x-velora-maximum-bytes': '16' },
        method: 'PUT',
      }),
      new Uint8Array(64),
    );
    expect(refused.status).toBe(413);
  });

  it('will not serve an object whose bytes are not an admitted image', async () => {
    // The content type comes from the bytes, never from the uploader, so
    // something that is not an image has no type to be served as.
    const other = mediaObjectKey({
      assetId: '9a2b7c31-4d5e-4f60-8a71-2c3d4e5f6071',
      role: 'original',
    });
    await storage.putObject(other, new TextEncoder().encode('<svg/>'));
    const grant = await storage.authorizeDelivery({
      expiresAt: new Date(Date.now() + 60_000),
      objectKey: other,
    });
    expect((await transport.get(new Request(grant.url))).status).toBe(404);
  });

  it('answers its own preflight, and only for its own paths', () => {
    const preflight = (url: string) =>
      transport.preflight(
        new Request(url, {
          headers: {
            'access-control-request-method': 'PUT',
            origin: 'http://127.0.0.1:3000',
          },
          method: 'OPTIONS',
        }),
        ['http://127.0.0.1:3000'],
        {},
      );

    const allowed = preflight(`${baseUrl}${localTestObjectPath}`);
    expect(allowed?.status).toBe(204);
    expect(allowed?.headers.get('access-control-allow-methods')).toContain(
      'PUT',
    );
    expect(allowed?.headers.get('access-control-allow-headers')).toContain(
      'x-velora-maximum-bytes',
    );

    // A product path falls through to the product API's own policy, which does
    // not allow PUT and must not start doing so because of this adapter.
    expect(preflight(`${baseUrl}/v1/users/me/profile`)).toBeUndefined();
  });

  it('refuses a preflight from an origin nobody configured', () => {
    const refused = transport.preflight(
      new Request(`${baseUrl}${localTestObjectPath}`, {
        headers: {
          'access-control-request-method': 'PUT',
          origin: 'http://attacker.example',
        },
        method: 'OPTIONS',
      }),
      ['http://127.0.0.1:3000'],
      {},
    );
    expect(refused?.status).toBe(403);
    expect(refused?.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves a public derivative without a signature and nothing else', async () => {
    const address = storage.publicAddress(objectKey);
    expect(address?.startsWith(`${baseUrl}${localTestPublicObjectPath}?`)).toBe(
      true,
    );
    const served = await transport.getPublic(new Request(address ?? ''));
    expect(served.status).toBe(200);

    const absent = `${baseUrl}${localTestPublicObjectPath}?key=${encodeURIComponent(
      mediaObjectKey({
        assetId: '5c6d7e8f-1a2b-4c3d-8e4f-5a6b7c8d9e01',
        role: 'original',
      }),
    )}`;
    expect((await transport.getPublic(new Request(absent))).status).toBe(404);
    // A key that is not a key at all is refused rather than read.
    expect(
      (
        await transport.getPublic(
          new Request(
            `${baseUrl}${localTestPublicObjectPath}?key=../../etc/passwd`,
          ),
        )
      ).status,
    ).toBe(404);
  });
});
