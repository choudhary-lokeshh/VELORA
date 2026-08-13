import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';

import {
  authAssuranceSchema,
  authAudienceSchema,
  type AuthAssurance,
  type AuthAudience,
} from '@velora/validation';

import { authMechanismConstants } from './policy.js';

/**
 * Provider-neutral signing authority for Consumer Mobile access tokens.
 *
 * The signature is Ed25519 (`EdDSA`), not a shared secret. That is a trust
 * boundary, not a preference: a component that only needs to verify a token
 * holds the public key and cannot mint one, so a compromised or extracted
 * verifier is not a token factory. A symmetric algorithm would hand minting
 * authority to every replica, every future extracted service, and every surface
 * that ever needs to check a token. Ed25519 is also deterministic, so there is
 * no per-signature nonce to misuse, and Bun and Node implement it natively, so
 * no cryptographic dependency and no hand-rolled code enter the trust boundary.
 *
 * The signing key itself remains behind this port. No cloud KMS or managed
 * signing provider is selected; that decision is
 * `DEFER UNTIL PROVIDER INTEGRATION`, and the only implementation here is an
 * explicitly non-production local authority that staging and production reject
 * at configuration load.
 */

export interface AccessTokenClaims {
  readonly accountId: string;
  readonly assurance: AuthAssurance;
  readonly audience: AuthAudience;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly refreshFamilyId: string;
  readonly tokenId: string;
}

/** Verification-only capability: public key material and nothing else. */
export interface AccessTokenVerifier {
  readonly kind: string;
  /** Returns undefined for every rejection. Callers learn nothing else. */
  verify(token: string, now: Date): AccessTokenClaims | undefined;
  /** Key identifiers currently accepted, so rotation state is observable. */
  readonly verificationKeyIds: readonly string[];
}

export interface AccessTokenSigner extends AccessTokenVerifier {
  sign(claims: AccessTokenClaims): string;
  /** The key new tokens are signed with. Always one of the verification keys. */
  readonly signingKeyId: string;
}

const signingAlgorithm = 'EdDSA';
const signingCurve = 'Ed25519';
const tokenType = 'at+jwt';
/**
 * A compact JWS for these claims is a few hundred bytes. Anything far larger is
 * an attempt to make the parser do work, and is refused before decoding.
 */
const maximumAccessTokenBytes = 4_096;

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeSegment(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

interface SignedHeader {
  readonly alg: string;
  readonly crv: string;
  readonly kid: string;
  readonly typ: string;
}

interface SignedPayload {
  readonly asr: string;
  readonly aud: string;
  readonly exp: number;
  readonly fid: string;
  readonly iat: number;
  readonly iss: string;
  readonly jti: string;
  readonly sub: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readHeader(value: unknown): SignedHeader | undefined {
  if (!isRecord(value)) return undefined;
  const { alg, crv, kid, typ } = value;
  if (
    typeof alg !== 'string' ||
    typeof crv !== 'string' ||
    typeof kid !== 'string' ||
    typeof typ !== 'string'
  ) {
    return undefined;
  }
  return { alg, crv, kid, typ };
}

function readPayload(value: unknown): SignedPayload | undefined {
  if (!isRecord(value)) return undefined;
  const { asr, aud, exp, fid, iat, iss, jti, sub } = value;
  if (
    typeof asr !== 'string' ||
    typeof aud !== 'string' ||
    !Number.isFinite(exp) ||
    typeof exp !== 'number' ||
    typeof fid !== 'string' ||
    !Number.isFinite(iat) ||
    typeof iat !== 'number' ||
    typeof iss !== 'string' ||
    typeof jti !== 'string' ||
    typeof sub !== 'string'
  ) {
    return undefined;
  }
  return { asr, aud, exp, fid, iat, iss, jti, sub };
}

/** Stable identifier for a public key, published as `kid`. */
export function accessTokenKeyId(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')
    .slice(0, 16);
}

export interface Ed25519AuthorityOptions {
  /**
   * Public keys that are no longer used for signing but whose tokens must still
   * verify, so a key can be rotated without invalidating live access tokens.
   * Dropping a key from this set is the emergency revocation seam.
   */
  readonly additionalVerificationKeys?: readonly KeyObject[];
  readonly issuer: string;
  readonly signingKey: KeyObject;
}

export class Ed25519AccessTokenAuthority implements AccessTokenSigner {
  readonly kind = 'local-development-ed25519';
  readonly signingKeyId: string;
  private readonly issuer: string;
  private readonly signingKey: KeyObject;
  private readonly verificationKeys: ReadonlyMap<string, KeyObject>;

  constructor(options: Ed25519AuthorityOptions) {
    if (
      options.signingKey.type !== 'private' ||
      options.signingKey.asymmetricKeyType !== 'ed25519'
    ) {
      throw new Error(
        'Access-token signing key must be an Ed25519 private key',
      );
    }
    this.issuer = options.issuer;
    this.signingKey = options.signingKey;

    const signingPublicKey = createPublicKey(options.signingKey);
    this.signingKeyId = accessTokenKeyId(signingPublicKey);
    const keys = new Map<string, KeyObject>([
      [this.signingKeyId, signingPublicKey],
    ]);
    for (const key of options.additionalVerificationKeys ?? []) {
      if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
        throw new Error('Access-token verification key must be Ed25519 public');
      }
      keys.set(accessTokenKeyId(key), key);
    }
    this.verificationKeys = keys;
  }

  static withGeneratedKey(issuer: string): Ed25519AccessTokenAuthority {
    return new Ed25519AccessTokenAuthority({
      issuer,
      signingKey: generateKeyPairSync('ed25519').privateKey,
    });
  }

  get verificationKeyIds(): readonly string[] {
    return [...this.verificationKeys.keys()];
  }

  sign(claims: AccessTokenClaims): string {
    const header: SignedHeader = {
      alg: signingAlgorithm,
      crv: signingCurve,
      kid: this.signingKeyId,
      typ: tokenType,
    };
    const payload: SignedPayload = {
      asr: claims.assurance,
      aud: claims.audience,
      exp: Math.floor(claims.expiresAt.getTime() / 1000),
      fid: claims.refreshFamilyId,
      iat: Math.floor(claims.issuedAt.getTime() / 1000),
      iss: this.issuer,
      jti: claims.tokenId,
      sub: claims.accountId,
    };
    const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
    return `${signingInput}.${this.signature(signingInput)}`;
  }

  verify(token: string, now: Date): AccessTokenClaims | undefined {
    if (token.length > maximumAccessTokenBytes) return undefined;
    const segments = token.split('.');
    if (segments.length !== 3) return undefined;
    const [headerSegment, payloadSegment, signatureSegment] = segments;
    if (
      headerSegment === undefined ||
      payloadSegment === undefined ||
      signatureSegment === undefined ||
      signatureSegment.length === 0
    ) {
      return undefined;
    }

    let header: SignedHeader | undefined;
    let payload: SignedPayload | undefined;
    try {
      header = readHeader(decodeSegment(headerSegment));
      payload = readPayload(decodeSegment(payloadSegment));
    } catch {
      return undefined;
    }
    if (header === undefined || payload === undefined) return undefined;
    // The algorithm is pinned by this verifier, never selected by the token.
    if (
      header.alg !== signingAlgorithm ||
      header.crv !== signingCurve ||
      header.typ !== tokenType
    ) {
      return undefined;
    }
    const key = this.verificationKeys.get(header.kid);
    if (key === undefined) return undefined;

    // Every decision below is inside the guard: a hostile token must produce a
    // rejection, never an exception that becomes a server error.
    let signed = false;
    try {
      signed = verifyBytes(
        null,
        Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8'),
        key,
        Buffer.from(signatureSegment, 'base64url'),
      );
    } catch {
      return undefined;
    }
    if (!signed) return undefined;

    if (payload.iss !== this.issuer) return undefined;
    const audience = authAudienceSchema.safeParse(payload.aud);
    const assurance = authAssuranceSchema.safeParse(payload.asr);
    if (!audience.success || !assurance.success) return undefined;

    const skew = authMechanismConstants.signedTokenClockSkewMilliseconds;
    const expiresAt = new Date(payload.exp * 1000);
    const issuedAt = new Date(payload.iat * 1000);
    if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(issuedAt.getTime())) {
      return undefined;
    }
    if (expiresAt.getTime() <= now.getTime()) return undefined;
    if (issuedAt.getTime() > now.getTime() + skew) return undefined;
    if (expiresAt.getTime() <= issuedAt.getTime()) return undefined;

    return {
      accountId: payload.sub,
      assurance: assurance.data,
      audience: audience.data,
      expiresAt,
      issuedAt,
      refreshFamilyId: payload.fid,
      tokenId: payload.jti,
    };
  }

  private signature(signingInput: string): string {
    return signBytes(
      null,
      Buffer.from(signingInput, 'utf8'),
      this.signingKey,
    ).toString('base64url');
  }
}
