import { maximumMediaObjectBytes } from './policy.js';
import { sniffMediaFormat } from './sniff.js';
import { mediaContentTypes, type MediaObjectRead } from './storage.js';

/**
 * The transport the `local-test` storage adapter has instead of a provider.
 *
 * Every approved object-storage provider brings its own origin: the platform
 * issues a signed address and the client speaks to the provider directly. The
 * `local-test` adapter had no such origin, so it issued
 * `https://media.velora.invalid/...` — deliberately unroutable, and therefore
 * an upload no browser and no phone could ever perform. Onboarding requires a
 * photo in `ready`, a photo reaches `ready` only through an upload, so nothing
 * on this platform could be walked from a new account in local development at
 * all. The Android freeze report records the fixture that had to be written
 * straight into the database to get past it.
 *
 * This gives that adapter the missing half. It is a transport and nothing more:
 * it authorizes with the same HMAC the adapter already signs delivery grants
 * with, it decides what an object is from the object's own bytes, and it knows
 * nothing about accounts, profiles, entitlement, or safety — every one of those
 * decisions was already taken by the product route that issued the address.
 *
 * It is not part of the published API. The paths live outside `/v1` because a
 * provider's upload endpoint is not Velora's contract, and the routes exist
 * only when `MEDIA_STORAGE_PROVIDER` is `local-test` — which configuration
 * refuses outside `local` and `test`. In staging and production these objects
 * are never constructed, so there is nothing to reach.
 */

/** Signed reads and writes of one object. */
export const localTestObjectPath = '/local-test/media-objects';

/** Unsigned reads of an object whose address is already public by design. */
export const localTestPublicObjectPath = '/local-test/media-objects/public';

/**
 * What the transport needs of the adapter, and nothing else.
 *
 * Declared here rather than taken from the class so this module imports no
 * value from `storage.ts`, which imports the two path constants above.
 */
export interface LocalTestObjectStore {
  putObject(objectKey: string, bytes: Uint8Array): Promise<void>;
  readObject(input: {
    readonly maximumBytes: number;
    readonly objectKey: string;
  }): Promise<MediaObjectRead>;
  verifyDelivery(input: {
    readonly at: Date;
    readonly expires: number;
    readonly objectKey: string;
    readonly signature: string;
  }): Promise<boolean>;
  verifyUpload(input: {
    readonly at: Date;
    readonly expires: number;
    readonly objectKey: string;
    readonly signature: string;
  }): Promise<boolean>;
}

/**
 * Browsers preflight the upload, because it carries the two `x-velora-` headers
 * the capability names and uses `PUT`. The product API allows neither, and it
 * must not start doing so to make a development adapter work — so the transport
 * answers its own preflight, with an allowance that reaches these paths only.
 */
const allowedRequestHeaders = [
  'content-type',
  'x-velora-maximum-bytes',
  'x-velora-upload-expires-at',
].join(', ');
const allowedMethods = 'GET, PUT, OPTIONS';
const preflightMaximumAgeSeconds = '600';

function isTransportPath(pathname: string): boolean {
  return (
    pathname === localTestObjectPath || pathname === localTestPublicObjectPath
  );
}

export class LocalTestMediaTransport {
  constructor(
    private readonly dependencies: {
      readonly now: () => Date;
      readonly store: LocalTestObjectStore;
    },
  ) {}

  /** Whether a request is for this transport rather than the product API. */
  handles(request: Request): boolean {
    return isTransportPath(new URL(request.url).pathname);
  }

  /**
   * The transport's own preflight answer, or `undefined` when the request is
   * not for it — so the caller falls through to the product API's policy
   * rather than this one widening it.
   */
  preflight(
    request: Request,
    allowedOrigins: readonly string[],
    extraHeaders: Readonly<Record<string, string>>,
  ): Response | undefined {
    if (!this.handles(request)) return undefined;
    const origin = request.headers.get('origin');
    if (origin === null || !allowedOrigins.includes(origin)) {
      return new Response(null, {
        headers: { ...extraHeaders, vary: 'origin' },
        status: 403,
      });
    }
    return new Response(null, {
      headers: {
        ...extraHeaders,
        'access-control-allow-headers': allowedRequestHeaders,
        'access-control-allow-methods': allowedMethods,
        'access-control-allow-origin': origin,
        'access-control-max-age': preflightMaximumAgeSeconds,
        vary: 'origin',
      },
      status: 204,
    });
  }

  /** Accepts the bytes one signed capability was issued for. */
  async put(request: Request, bytes: Uint8Array): Promise<Response> {
    const grant = readGrant(request);
    if (grant === undefined) return refusal(400);
    if (
      !(await this.dependencies.store.verifyUpload({
        at: this.dependencies.now(),
        expires: grant.expires,
        objectKey: grant.objectKey,
        signature: grant.signature,
      }))
    ) {
      return refusal(403);
    }
    // The capability names its own ceiling and the platform has a hard one.
    // Neither is a suggestion, and the smaller wins.
    const declared = Number(request.headers.get('x-velora-maximum-bytes') ?? 0);
    const ceiling = Number.isSafeInteger(declared)
      ? Math.min(declared, maximumMediaObjectBytes)
      : maximumMediaObjectBytes;
    if (bytes.byteLength > ceiling) return refusal(413);
    await this.dependencies.store.putObject(grant.objectKey, bytes);
    return new Response(null, { status: 200 });
  }

  /** Serves an object to a caller holding a signed delivery grant. */
  async get(request: Request): Promise<Response> {
    const grant = readGrant(request);
    if (grant === undefined) return refusal(400);
    if (
      !(await this.dependencies.store.verifyDelivery({
        at: this.dependencies.now(),
        expires: grant.expires,
        objectKey: grant.objectKey,
        signature: grant.signature,
      }))
    ) {
      return refusal(403);
    }
    return this.serve(grant.objectKey);
  }

  /**
   * Serves an object whose address is public by construction.
   *
   * There is no signature to check, which is the point: a public derivative's
   * address is immutable and already handed to anyone who can see the page it
   * appears on. Authorization happened when the product route decided to put
   * that address in a response.
   */
  async getPublic(request: Request): Promise<Response> {
    const objectKey = new URL(request.url).searchParams.get('key');
    if (objectKey === null) return refusal(400);
    return this.serve(objectKey);
  }

  private async serve(objectKey: string): Promise<Response> {
    let read: MediaObjectRead;
    try {
      read = await this.dependencies.store.readObject({
        maximumBytes: maximumMediaObjectBytes,
        objectKey,
      });
    } catch {
      // A malformed key. The adapter refuses it rather than reading anything,
      // and a refused key is indistinguishable from an absent one here.
      return refusal(404);
    }
    if (read.kind !== 'bytes') return refusal(404);
    // What the bytes are, from the bytes. Nothing the uploader said about them
    // is consulted, here or anywhere else in this domain.
    const format = sniffMediaFormat(read.bytes);
    if (format === undefined) return refusal(404);
    return new Response(read.bytes, {
      headers: {
        'cache-control': 'private, max-age=60',
        'content-length': String(read.bytes.byteLength),
        'content-type': mediaContentTypes[format],
      },
      status: 200,
    });
  }
}

interface Grant {
  readonly expires: number;
  readonly objectKey: string;
  readonly signature: string;
}

function readGrant(request: Request): Grant | undefined {
  const parameters = new URL(request.url).searchParams;
  const objectKey = parameters.get('key');
  const expires = Number(parameters.get('expires'));
  const signature = parameters.get('signature');
  if (objectKey === null || signature === null) return undefined;
  if (!Number.isSafeInteger(expires)) return undefined;
  return { expires, objectKey, signature };
}

/**
 * An empty body with a status and nothing else.
 *
 * A provider's storage endpoint is not a product surface: it has no correlation
 * identifier to echo, no contract error body, and nothing it could say about
 * why it refused that would not also tell an unauthorized caller whether the
 * object exists.
 */
function refusal(status: number): Response {
  return new Response(null, { status });
}
