import { createConsumerApi } from '@velora/consumer-client';
import { maximumProfileMediaBytes } from '@velora/validation/profile-bounds';

import { inspectPickedImage } from '../src/media/picker';
import { uploadProfilePhoto, type UploadStage } from '../src/media/upload';
import { admittedState, createMobileApiDouble } from './support/api-double';

/**
 * Getting a photograph off the device and into the platform's hands.
 *
 * The three steps are asserted in order — capability, bytes, confirmation —
 * because the order is the contract: a client that wrote bytes without asking
 * for a capability would be uploading to an address it invented, and one that
 * skipped the confirmation would leave an object nobody ever inspected.
 *
 * The refusals matter more than the happy path. An environment with no
 * approved storage provider is the state every deployed environment is in, and
 * it has to say so rather than look like a failure somebody caused.
 */

const oneByte = new Uint8Array([0x01]);

function harness(options: { readonly storageAvailable?: boolean } = {}) {
  const state = admittedState();
  state.profile = {
    complete: false,
    discoverable: false,
    displayName: 'Alex',
    languages: ['en'],
    media: [],
    outstandingRequirements: ['ready_media'],
  };
  state.storageAvailable = options.storageAvailable ?? true;
  const double = createMobileApiDouble(state);

  const uploads: { body: unknown; headers: unknown; url: string }[] = [];
  /**
   * Stands in for two different things React Native's `fetch` does: reading a
   * `file://` asset off the device, and writing bytes to a storage address.
   */
  const fetchImplementation: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.startsWith('file://') || url.startsWith('content://')) {
      return new Response(oneByte, { status: 200 });
    }
    if (url.startsWith('http://storage.test/')) {
      uploads.push({ body: init?.body, headers: init?.headers, url });
      return new Response(null, { status: 200 });
    }
    return double.fetch(input, init);
  };

  return {
    api: createConsumerApi({
      apiBaseUrl: 'http://api.test',
      fetch: fetchImplementation,
      transport: {
        headers: () => Promise.resolve({ authorization: 'Bearer access-1' }),
      },
    }),
    double,
    fetchImplementation,
    state,
    uploads,
  };
}

const picked = {
  byteSize: 1,
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  uri: 'file:///device/photo.jpg',
};

describe('inspecting a chosen image before it is uploaded', () => {
  it('accepts what the contract accepts', () => {
    expect(inspectPickedImage(picked).kind).toBe('picked');
  });

  it('stops an oversized file before it costs somebody mobile data', () => {
    const outcome = inspectPickedImage({
      ...picked,
      byteSize: maximumProfileMediaBytes + 1,
    });
    expect(outcome.kind).toBe('too_large');
  });

  it('stops a file that is not one of the published types', () => {
    expect(
      inspectPickedImage({ ...picked, mimeType: 'application/pdf' }).kind,
    ).toBe('unsupported_type');
  });

  it('lets an unreported size or type through to the server', () => {
    // Android does not always report either, and neither is authority: the
    // platform decides from the stored bytes. Refusing here on a missing
    // field would refuse a perfectly good photograph.
    expect(
      inspectPickedImage({
        ...picked,
        byteSize: undefined,
        mimeType: undefined,
      }).kind,
    ).toBe('picked');
  });
});

describe('uploading a profile photograph', () => {
  it('asks for a capability, writes the bytes to it, then asks for an inspection', async () => {
    const { api, double, fetchImplementation, uploads } = harness();
    const stages: UploadStage[] = [];

    const outcome = await uploadProfilePhoto(picked, {
      api,
      fetch: fetchImplementation,
      onStage: (stage) => stages.push(stage),
    });

    expect(outcome.kind).toBe('accepted');
    const paths = double.calls
      .filter((call) => call.method === 'POST')
      .map((call) => call.path);
    expect(paths).toEqual([
      '/v1/users/me/profile/media',
      '/v1/users/me/profile/media/completion',
    ]);
    // The bytes went to the address the server issued, with the headers it
    // issued, and nothing else.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.headers).toEqual({
      'content-type': 'application/octet-stream',
    });
    expect(stages).toEqual(['requesting', 'uploading', 'confirming', 'idle']);
  });

  it('leaves the platform to decide what was uploaded', async () => {
    const { api, double, fetchImplementation } = harness();
    await uploadProfilePhoto(picked, { api, fetch: fetchImplementation });

    const request = double.calls.find(
      (call) => call.path === '/v1/users/me/profile/media',
    );
    // No declared type, no declared size, no filename. "This is a JPEG" is a
    // fact the server establishes from the bytes, never a claim the client
    // makes.
    expect(request?.body).toBeUndefined();
  });

  it('says an environment with no storage provider lost nothing', async () => {
    const { api, fetchImplementation } = harness({ storageAvailable: false });

    const outcome = await uploadProfilePhoto(picked, {
      api,
      fetch: fetchImplementation,
    });

    // Every deployed environment is in this state, and it is a capability gap
    // rather than something the person did.
    expect(outcome.kind).toBe('storage_unavailable');
  });

  it('never puts the storage address into what it reports', async () => {
    const { api, double, fetchImplementation } = harness();
    double.failNext('/v1/users/me/profile/media');

    const outcome = await uploadProfilePhoto(picked, {
      api,
      fetch: fetchImplementation,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).not.toContain('storage.test');
      expect(outcome.message).not.toContain('http');
    }
  });

  it('reports a photo it could not read off the device', async () => {
    const { api, double } = harness();
    const unreadable: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('file://')) return new Response(null, { status: 404 });
      return double.fetch(input, init);
    };

    const outcome = await uploadProfilePhoto(picked, {
      api,
      fetch: unreadable,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('stops an oversized file the picker did not measure', async () => {
    const { double } = harness();
    const oversized: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('file://')) {
        return new Response(new Uint8Array(maximumProfileMediaBytes + 1), {
          status: 200,
        });
      }
      return double.fetch(input, init);
    };
    const api = createConsumerApi({
      apiBaseUrl: 'http://api.test',
      fetch: oversized,
      transport: {
        headers: () => Promise.resolve({ authorization: 'Bearer access-1' }),
      },
    });

    const outcome = await uploadProfilePhoto(
      { ...picked, byteSize: undefined },
      { api, fetch: oversized },
    );

    // The last point at which it can be stopped without spending the upload.
    expect(outcome.kind).toBe('too_large');
  });
});
