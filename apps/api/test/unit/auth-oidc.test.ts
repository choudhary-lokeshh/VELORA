import { afterAll, describe, expect, it } from 'bun:test';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';

import { OidcIdentityProvider } from '../../src/auth/oidc.js';
import { AllowlistedOutboundHttp } from '../../src/security/outbound-http.js';

/**
 * Provider contract proof, not cloud evidence.
 *
 * A conforming OpenID provider is stood up in this process so every branch of
 * the trust decision can be driven: a valid assertion, and then the same
 * assertion with exactly one thing wrong. Nothing here proves anything about a
 * real vendor's behaviour, and it is named so no passing run can be read that
 * way.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const signingKeyId = 'test-key';
const jwk = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  alg: 'RS256',
  kid: signingKeyId,
  use: 'sig',
};

const clientId = 'velora-test-client';
const clientSecret = 'velora-test-secret';

interface ProviderScript {
  discoveryIssuer: string | undefined;
  idToken: ((issuer: string) => string) | undefined;
  tokenStatus: number | undefined;
  seenAuthorization: string | undefined;
  seenBody: string | undefined;
}

const script: ProviderScript = {
  discoveryIssuer: undefined,
  idToken: undefined,
  seenAuthorization: undefined,
  seenBody: undefined,
  tokenStatus: undefined,
};

/** Filled once the socket has a port; every handler reads it, none defines it. */
let issuerAddress = '';

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = signBytes(
    'sha256',
    Buffer.from(signingInput, 'utf8'),
    privateKey,
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

const server: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const issuer = issuerAddress;
    if (url.pathname === '/.well-known/openid-configuration') {
      return Response.json({
        authorization_endpoint: `${issuer}/authorize`,
        issuer: script.discoveryIssuer ?? issuer,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint: `${issuer}/token`,
      });
    }
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    if (url.pathname === '/token') {
      script.seenAuthorization = request.headers.get('authorization') ?? '';
      script.seenBody = await request.text();
      if (script.tokenStatus !== undefined && script.tokenStatus !== 200) {
        return new Response('no', { status: script.tokenStatus });
      }
      const build = script.idToken ?? defaultIdToken;
      return Response.json({ id_token: build(issuer) });
    }
    return new Response('not found', { status: 404 });
  },
});

const issuer = `http://127.0.0.1:${String(server.port)}`;
issuerAddress = issuer;
const redirectUri = 'http://127.0.0.1:4000/v1/auth/oidc/callback';

function defaultIdToken(providerIssuer: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken(
    { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
    {
      aud: clientId,
      exp: now + 300,
      iat: now,
      iss: providerIssuer,
      nonce: 'nonce-value',
      sub: 'provider-subject-1',
    },
  );
}

function providerUnderTest(): OidcIdentityProvider {
  // A new instance per case, so one case's cached discovery or key set never
  // decides another's outcome.
  return new OidcIdentityProvider({
    clientId,
    clientSecret,
    // The real adapter, with the one allowance local and test have: this
    // harness stands the provider up on loopback in this process.
    http: new AllowlistedOutboundHttp({ allowLoopback: true }),
    issuer,
    redirectUri,
  });
}

afterAll(async () => {
  await server.stop(true);
});

describe('OpenID authorization request', () => {
  it('carries the state, nonce, and PKCE challenge this platform minted', async () => {
    const address = await providerUnderTest().authorizationUrl({
      codeChallenge: 'challenge-value',
      nonce: 'nonce-value',
      state: 'state-value',
    });
    const url = new URL(address);
    expect(url.origin).toBe(issuer);
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('asks for the openid scope and nothing else', async () => {
    const address = await providerUnderTest().authorizationUrl({
      codeChallenge: 'challenge-value',
      nonce: 'nonce-value',
      state: 'state-value',
    });
    expect(new URL(address).searchParams.get('scope')).toBe('openid');
  });
});

describe('OpenID code exchange', () => {
  it('authenticates the client over the back channel and returns the subject', async () => {
    script.idToken = undefined;
    script.tokenStatus = undefined;
    const assertion = await providerUnderTest().completeAuthorization({
      code: 'auth-code',
      codeVerifier: 'verifier-value',
      nonce: 'nonce-value',
    });
    expect(assertion).toEqual({
      provider: 'oidc',
      providerSubject: 'provider-subject-1',
    });
    expect(script.seenAuthorization).toStartWith('Basic ');
    expect(script.seenBody).toContain('code_verifier=verifier-value');
    expect(script.seenBody).toContain('grant_type=authorization_code');
    // The secret authenticates the request and must never travel in the body.
    expect(script.seenBody).not.toContain(clientSecret);
  });

  it.each([
    [
      'an issuer that is not the configured one',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: clientId,
            exp: Math.floor(Date.now() / 1000) + 300,
            iat: Math.floor(Date.now() / 1000),
            iss: 'https://evil.example',
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'an audience belonging to another client',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: 'another-client',
            exp: Math.floor(Date.now() / 1000) + 300,
            iat: Math.floor(Date.now() / 1000),
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'multiple audiences with an authorized party that is not this client',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: [clientId, 'another-client'],
            azp: 'another-client',
            exp: Math.floor(Date.now() / 1000) + 300,
            iat: Math.floor(Date.now() / 1000),
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'a token that has already expired',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: clientId,
            exp: Math.floor(Date.now() / 1000) - 600,
            iat: Math.floor(Date.now() / 1000) - 900,
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'a token issued in the future',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: clientId,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000) + 900,
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'a nonce from another attempt',
      (): string =>
        signToken(
          { alg: 'RS256', kid: signingKeyId, typ: 'JWT' },
          {
            aud: clientId,
            exp: Math.floor(Date.now() / 1000) + 300,
            iat: Math.floor(Date.now() / 1000),
            iss: issuer,
            nonce: 'somebody-elses-nonce',
            sub: 'provider-subject-1',
          },
        ),
    ],
    [
      'an unsigned token',
      (): string => {
        const now = Math.floor(Date.now() / 1000);
        return `${encode({ alg: 'none', kid: signingKeyId, typ: 'JWT' })}.${encode(
          {
            aud: clientId,
            exp: now + 300,
            iat: now,
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        )}.`;
      },
    ],
    [
      'a token signed by a key the provider never published',
      (): string => {
        const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const now = Math.floor(Date.now() / 1000);
        const signingInput = `${encode({ alg: 'RS256', kid: signingKeyId, typ: 'JWT' })}.${encode(
          {
            aud: clientId,
            exp: now + 300,
            iat: now,
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        )}`;
        const signature = signBytes(
          'sha256',
          Buffer.from(signingInput, 'utf8'),
          other.privateKey,
        );
        return `${signingInput}.${signature.toString('base64url')}`;
      },
    ],
    [
      'a key identifier the provider never published',
      (): string => {
        const now = Math.floor(Date.now() / 1000);
        return signToken(
          { alg: 'RS256', kid: 'unknown-key', typ: 'JWT' },
          {
            aud: clientId,
            exp: now + 300,
            iat: now,
            iss: issuer,
            nonce: 'nonce-value',
            sub: 'provider-subject-1',
          },
        );
      },
    ],
  ])('refuses %s', async (_name, build) => {
    script.tokenStatus = undefined;
    script.idToken = () => build();
    expect(
      await providerUnderTest().completeAuthorization({
        code: 'auth-code',
        codeVerifier: 'verifier-value',
        nonce: 'nonce-value',
      }),
    ).toBeUndefined();
    script.idToken = undefined;
  });

  it('refuses when the provider will not exchange the code', async () => {
    script.idToken = undefined;
    script.tokenStatus = 400;
    expect(
      await providerUnderTest().completeAuthorization({
        code: 'auth-code',
        codeVerifier: 'verifier-value',
        nonce: 'nonce-value',
      }),
    ).toBeUndefined();
    script.tokenStatus = undefined;
  });

  it('refuses a discovery document that answers for another issuer', async () => {
    script.discoveryIssuer = 'https://evil.example';
    expect(
      await providerUnderTest().completeAuthorization({
        code: 'auth-code',
        codeVerifier: 'verifier-value',
        nonce: 'nonce-value',
      }),
    ).toBeUndefined();
    script.discoveryIssuer = undefined;
  });
});

describe('OpenID subject normalisation', () => {
  it('keeps a subject exactly as the provider spelled it', () => {
    expect(providerUnderTest().assert('AbC-123').providerSubject).toBe(
      'AbC-123',
    );
  });

  it('refuses a subject carrying whitespace or control characters', () => {
    expect(() => providerUnderTest().assert('a b')).toThrow();
    expect(() => providerUnderTest().assert('')).toThrow();
  });
});
