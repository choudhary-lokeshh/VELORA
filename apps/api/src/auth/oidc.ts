import {
  constants as cryptoConstants,
  createPublicKey,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';

import type { OutboundHttpPort } from '../security/ports.js';
import type {
  FederatedIdentityProvider,
  IdentityAssertion,
} from './identity-provider.js';

/**
 * OpenID Connect relying party.
 *
 * The whole of the trust decision is here, and it is deliberately small enough
 * to read in one sitting: a browser is sent to the provider with a single-use
 * state, nonce, and PKCE challenge; the code that comes back is exchanged over
 * the back channel; and the ID token is believed only after its signature has
 * been verified against a key the provider published, its issuer and audience
 * match exactly, its lifetime is current, and its nonce is the one this
 * platform minted for this attempt. A decoded but unverified payload is never
 * consulted for anything.
 *
 * Every address this adapter fetches comes from the discovery document of the
 * one issuer in deployment configuration. Nothing a request carries contributes
 * to a URL, so there is no shape of input that turns this into a fetch of a
 * caller's choosing.
 *
 * The subject it returns is an external reference, never authorization. AUTH
 * maps it to an account through `auth_identities` exactly as it maps a local
 * subject, and every capability decision downstream is made from VELORA's own
 * records.
 */

/**
 * Signature algorithms this platform will verify, and no others.
 *
 * `none` is absent, which is the point: an ID token that names an unsigned
 * algorithm is refused by the same lookup that refuses a misspelt one, so there
 * is no branch where an unsigned token reaches the claim checks. The four here
 * cover every conforming provider without admitting the weak or the exotic.
 */
const signatureAlgorithms = new Set(['RS256', 'PS256', 'ES256', 'EdDSA']);

/** Discovery and keys are re-read on this cadence rather than per request. */
const documentLifetimeMilliseconds = 3_600_000;
/**
 * An unknown key identifier is the normal signal of a provider rotating keys,
 * and it is also what an attacker sends to make this platform fetch. Refreshing
 * at most this often makes the first useful and the second worthless.
 */
const keyRefreshFloorMilliseconds = 60_000;

/** Clock skew allowance on the ID token's own timestamps. */
const clockSkewMilliseconds = 60_000;

/**
 * The claims a subject is derived from. Everything else a provider sends is
 * ignored: VELORA asks for the `openid` scope and nothing more, so there is no
 * profile, no email, and no name in this exchange to store, log, or leak.
 */
interface IdTokenClaims {
  readonly aud: readonly string[];
  readonly azp?: string | undefined;
  readonly exp: number;
  readonly iat: number;
  readonly iss: string;
  readonly nonce?: string | undefined;
  readonly sub: string;
}

interface DiscoveryDocument {
  readonly authorizationEndpoint: string;
  readonly jwksUri: string;
  readonly tokenEndpoint: string;
}

export interface OidcIdentityProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * The approved outbound adapter. Every request this provider makes goes
   * through it, so TLS, redirect refusal, resolved-address validation, timeouts,
   * and response bounds are enforced in one reviewed place rather than three
   * times here.
   */
  readonly http: OutboundHttpPort;
  readonly issuer: string;
  readonly now?: () => Date;
  readonly redirectUri: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function decodeJson(body: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(body));
}

function readAudience(value: unknown): readonly string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') return undefined;
    entries.push(entry);
  }
  return entries;
}

function readClaims(value: unknown): IdTokenClaims | undefined {
  if (!isRecord(value)) return undefined;
  const audience = readAudience(value.aud);
  const { azp, exp, iat, iss, nonce, sub } = value;
  if (
    audience === undefined ||
    typeof exp !== 'number' ||
    typeof iat !== 'number' ||
    typeof iss !== 'string' ||
    typeof sub !== 'string' ||
    sub.length === 0
  ) {
    return undefined;
  }
  if (azp !== undefined && typeof azp !== 'string') return undefined;
  if (nonce !== undefined && typeof nonce !== 'string') return undefined;
  return {
    aud: audience,
    ...(azp === undefined ? {} : { azp }),
    exp,
    iat,
    iss,
    ...(nonce === undefined ? {} : { nonce }),
    sub,
  };
}

/**
 * A subject as it may be stored and compared.
 *
 * Deliberately not lowercased. An OpenID subject is an opaque, case-sensitive
 * identifier, and normalising its case would merge two accounts that the
 * provider considers distinct — the one failure in this file that would be
 * silent, permanent, and impossible to unpick afterwards.
 */
const subjectPattern = /^[\x21-\x7e]{1,255}$/u;

export class OidcIdentityProvider implements FederatedIdentityProvider {
  readonly name = 'oidc';
  private readonly now: () => Date;
  private discovery:
    { document: DiscoveryDocument; readAt: number } | undefined;
  private keys:
    { keys: ReadonlyMap<string, KeyObject>; readAt: number } | undefined;

  constructor(private readonly options: OidcIdentityProviderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  assert(subject: string): IdentityAssertion {
    const trimmed = subject.trim();
    if (!subjectPattern.test(trimmed)) {
      throw new Error('OpenID subject is not acceptable');
    }
    return { provider: this.name, providerSubject: trimmed };
  }

  async authorizationUrl(input: {
    readonly codeChallenge: string;
    readonly nonce: string;
    readonly state: string;
  }): Promise<string> {
    const document = await this.discover();
    const url = new URL(document.authorizationEndpoint);
    // `set` rather than `append`: a discovery document that already carried one
    // of these would otherwise produce a request with the parameter twice, and
    // which one a provider reads is not something to leave to a provider.
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    // The narrowest scope that authenticates anybody. VELORA stores no email
    // address and displays no provider profile, so asking for one would be
    // collecting personal data with no purpose to justify it.
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async completeAuthorization(input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  }): Promise<IdentityAssertion | undefined> {
    let idToken: string | undefined;
    try {
      idToken = await this.exchange(input.code, input.codeVerifier);
    } catch {
      return undefined;
    }
    if (idToken === undefined) return undefined;
    const claims = await this.verifyIdToken(idToken);
    if (claims === undefined) return undefined;
    if (claims.nonce !== input.nonce) return undefined;
    try {
      return this.assert(claims.sub);
    } catch {
      return undefined;
    }
  }

  private async discover(): Promise<DiscoveryDocument> {
    const now = this.now().getTime();
    const cached = this.discovery;
    if (
      cached !== undefined &&
      now - cached.readAt < documentLifetimeMilliseconds
    ) {
      return cached.document;
    }
    const response = await this.options.http.execute({
      headers: { accept: 'application/json' },
      method: 'GET',
      url: new URL(`${this.options.issuer}/.well-known/openid-configuration`),
    });
    if (response.status !== 200) throw new Error('OpenID discovery failed');
    const body: unknown = decodeJson(response.body);
    if (!isRecord(body)) throw new Error('OpenID discovery document malformed');
    // The document must name the issuer back. A provider answering for a
    // different issuer than the one configured is either misconfigured or is
    // not the provider this deployment thinks it is reaching, and following it
    // would be following whoever answered.
    if (body.issuer !== this.options.issuer) {
      throw new Error('OpenID discovery issuer mismatch');
    }
    const document = {
      authorizationEndpoint: body.authorization_endpoint,
      jwksUri: body.jwks_uri,
      tokenEndpoint: body.token_endpoint,
    };
    if (
      typeof document.authorizationEndpoint !== 'string' ||
      typeof document.jwksUri !== 'string' ||
      typeof document.tokenEndpoint !== 'string'
    ) {
      throw new Error('OpenID discovery document is missing an endpoint');
    }
    const resolved: DiscoveryDocument = {
      authorizationEndpoint: document.authorizationEndpoint,
      jwksUri: document.jwksUri,
      tokenEndpoint: document.tokenEndpoint,
    };
    for (const endpoint of [
      resolved.authorizationEndpoint,
      resolved.jwksUri,
      resolved.tokenEndpoint,
    ]) {
      this.requireCompatibleEndpoint(endpoint);
    }
    this.discovery = { document: resolved, readAt: now };
    return resolved;
  }

  /**
   * An endpoint has to be at least as protected as the issuer that published
   * it. Providers legitimately serve their token endpoint from a different host
   * than their issuer, so same-origin would refuse working configurations; what
   * is never legitimate is a document served over TLS that then directs this
   * platform's client secret somewhere unencrypted.
   */
  private requireCompatibleEndpoint(endpoint: string): void {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('OpenID endpoint is not a URL');
    }
    const issuerProtocol = new URL(this.options.issuer).protocol;
    if (issuerProtocol === 'https:' && url.protocol !== 'https:') {
      throw new Error('OpenID endpoint downgrades the issuer transport');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('OpenID endpoint uses an unsupported scheme');
    }
  }

  private async exchange(
    code: string,
    codeVerifier: string,
  ): Promise<string | undefined> {
    const document = await this.discover();
    const body = new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.options.redirectUri,
    });
    // `client_secret_basic`, which every conforming provider supports and which
    // keeps the secret out of a body that some providers log.
    const credential = Buffer.from(
      `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`,
      'utf8',
    ).toString('base64');
    const response = await this.options.http.execute({
      body: new TextEncoder().encode(body.toString()),
      headers: {
        accept: 'application/json',
        authorization: `Basic ${credential}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      url: new URL(document.tokenEndpoint),
    });
    if (response.status !== 200) return undefined;
    const parsed: unknown = decodeJson(response.body);
    if (!isRecord(parsed)) return undefined;
    const idToken = parsed.id_token;
    return typeof idToken === 'string' ? idToken : undefined;
  }

  private async verifyIdToken(
    token: string,
  ): Promise<IdTokenClaims | undefined> {
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

    let header: unknown;
    let payload: unknown;
    try {
      header = decodeSegment(headerSegment);
      payload = decodeSegment(payloadSegment);
    } catch {
      return undefined;
    }
    if (!isRecord(header)) return undefined;
    const algorithm = header.alg;
    const keyId = header.kid;
    if (typeof algorithm !== 'string' || !signatureAlgorithms.has(algorithm)) {
      return undefined;
    }
    if (typeof keyId !== 'string' || keyId.length === 0) return undefined;

    const key = await this.signingKey(keyId);
    if (key === undefined) return undefined;

    const signed = `${headerSegment}.${payloadSegment}`;
    let verified = false;
    try {
      verified = verifySignature(
        algorithm,
        Buffer.from(signed, 'utf8'),
        key,
        Buffer.from(signatureSegment, 'base64url'),
      );
    } catch {
      return undefined;
    }
    if (!verified) return undefined;

    const claims = readClaims(payload);
    if (claims === undefined) return undefined;
    if (claims.iss !== this.options.issuer) return undefined;
    if (!claims.aud.includes(this.options.clientId)) return undefined;
    // With more than one audience the specification requires an authorized
    // party, and it has to be this client: a token minted for somebody else and
    // merely mentioning this client is not a token for this client.
    if (claims.aud.length > 1 && claims.azp !== this.options.clientId) {
      return undefined;
    }
    const now = this.now().getTime();
    if (claims.exp * 1000 <= now - clockSkewMilliseconds) return undefined;
    if (claims.iat * 1000 > now + clockSkewMilliseconds) return undefined;
    return claims;
  }

  private async signingKey(keyId: string): Promise<KeyObject | undefined> {
    const now = this.now().getTime();
    const cached = this.keys;
    if (cached !== undefined) {
      const key = cached.keys.get(keyId);
      if (key !== undefined) return key;
      if (now - cached.readAt < keyRefreshFloorMilliseconds) return undefined;
    }
    const refreshed = await this.readKeys();
    this.keys = { keys: refreshed, readAt: now };
    return refreshed.get(keyId);
  }

  private async readKeys(): Promise<ReadonlyMap<string, KeyObject>> {
    const document = await this.discover();
    const response = await this.options.http.execute({
      headers: { accept: 'application/json' },
      method: 'GET',
      url: new URL(document.jwksUri),
    });
    if (response.status !== 200) throw new Error('OpenID key set unavailable');
    const body: unknown = decodeJson(response.body);
    if (!isRecord(body) || !Array.isArray(body.keys)) {
      throw new Error('OpenID key set malformed');
    }
    const keys = new Map<string, KeyObject>();
    for (const entry of body.keys as readonly unknown[]) {
      if (!isRecord(entry)) continue;
      const keyId = entry.kid;
      if (typeof keyId !== 'string' || keyId.length === 0) continue;
      // A key whose declared use is encryption is not a key this platform will
      // verify a signature with, whatever the token's header says.
      if (entry.use !== undefined && entry.use !== 'sig') continue;
      try {
        keys.set(
          keyId,
          createPublicKey({ format: 'jwk', key: entry as never }),
        );
      } catch {
        // One unusable key in a set is a provider's business, not a reason to
        // stop verifying tokens signed by the others.
      }
    }
    return keys;
  }
}

/**
 * Signature verification per JWS algorithm.
 *
 * Two details here are the ones that quietly break an implementation. ECDSA in
 * JWS is the raw `r || s` pair, not the DER structure Node verifies by default,
 * so `ieee-p1363` is required or every valid ES256 token is rejected. And PS256
 * needs its padding and salt length named, or the same key verifies under the
 * wrong scheme.
 */
function verifySignature(
  algorithm: string,
  message: Buffer,
  key: KeyObject,
  signature: Buffer,
): boolean {
  switch (algorithm) {
    case 'EdDSA': {
      return verifyBytes(null, message, key, signature);
    }
    case 'ES256': {
      return verifyBytes(
        'sha256',
        message,
        { dsaEncoding: 'ieee-p1363', key },
        signature,
      );
    }
    case 'PS256': {
      return verifyBytes(
        'sha256',
        message,
        {
          key,
          padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        signature,
      );
    }
    case 'RS256': {
      return verifyBytes('sha256', message, key, signature);
    }
    default: {
      return false;
    }
  }
}
