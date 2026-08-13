import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token generation and storage digests.
 *
 * Every opaque credential Velora issues is 256 bits of CSPRNG output. Because
 * the secret itself carries full entropy, a plain SHA-256 lookup digest is
 * sufficient: recovering a token from its digest means inverting SHA-256 on a
 * uniformly random 256-bit preimage, and there is no smaller guessing space to
 * attack the way there is for a user-chosen password. A keyed digest (HMAC)
 * would add a key that must be provisioned, rotated, and present on the lookup
 * path, and it defends only against an attacker who has the database and can
 * mount a search the entropy already rules out. ADR-0017 requires hash-only
 * storage; this is the simplest construction that satisfies it soundly.
 *
 * ADR-0009 requires versioned token formats, so every token carries an explicit
 * version prefix and the digest covers the whole string, prefix included.
 */

const opaqueTokenVersion = 'v1';
const opaqueTokenEntropyBytes = 32;
const opaqueTokenPattern = /^v1\.[A-Za-z0-9_-]{43}$/u;

export function generateOpaqueToken(): string {
  return `${opaqueTokenVersion}.${randomBytes(opaqueTokenEntropyBytes).toString('base64url')}`;
}

export function isWellFormedOpaqueToken(value: string): boolean {
  return opaqueTokenPattern.test(value);
}

/** Lowercase hex SHA-256. The stored form of every credential. */
export function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Digest of a non-credential value that still must not be stored in the clear,
 * such as a recovery destination or a device reference.
 */
export function digestValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Stable digest of a structured argument set, for exact-action binding.
 *
 * Canonicalisation is explicit rather than `JSON.stringify`: a binding that
 * hashes an ambiguous representation is not a binding. Values that JSON would
 * silently flatten into the same text — a `Date` and an empty object, `NaN` and
 * `null` — are either encoded distinguishably or refused outright, so two
 * different argument sets can never share a digest.
 */
export function digestStructure(value: unknown): string {
  return digestValue(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': {
      return value ? 'true' : 'false';
    }
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new Error('Cannot bind a non-finite number');
      }
      // `-0` and `0` are the same value to a reader and must not differ here.
      return Object.is(value, -0) ? '0' : String(value);
    }
    case 'string': {
      return `s${JSON.stringify(value)}`;
    }
    case 'bigint': {
      return `n${value.toString()}`;
    }
    case 'object': {
      return canonicalObject(value);
    }
    default: {
      throw new Error(`Cannot bind a value of type ${typeof value}`);
    }
  }
}

function canonicalObject(value: object): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Cannot bind an invalid date');
    }
    return `d${value.toISOString()}`;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    // Maps, sets, class instances, and buffers have no unambiguous textual form
    // here. A caller that needs one converts it deliberately.
    throw new Error('Cannot bind a value that is not a plain object');
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}

/** Compares two equal-length hex digests without leaking position by timing. */
export function digestsEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
