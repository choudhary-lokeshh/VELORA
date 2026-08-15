import { describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authAssuranceLevels } from '@velora/validation';

import {
  accessTokenKeyId,
  Ed25519AccessTokenAuthority,
} from '../../src/auth/access-token.js';
import {
  evaluateBrowserRequest,
  readBrowserRequestFacts,
} from '../../src/auth/browser-request.js';
import {
  AuthorizationError,
  requireAssurance,
  requireAudience,
  requireAuthenticated,
  requireFreshAssurance,
  type AuthContext,
} from '../../src/auth/context.js';
import {
  clearedSessionCookie,
  issuedSessionCookie,
  presentedSessionCookie,
  readCookie,
} from '../../src/auth/cookies.js';
import {
  LocalIdentityProvider,
  UnavailablePrivilegedAuthenticatorVerifier,
  type PrivilegedAuthenticatorVerifier,
} from '../../src/auth/identity-provider.js';
import {
  accessTokenLifetimeMilliseconds,
  assuranceAtLeast,
  browserSessionPolicy,
  durationMilliseconds,
  highImpactCooldownMilliseconds,
  lockedAuthLimits,
  minimumAssuranceByAudience,
  recoveryRateLimits,
  recoveryTokenLifetimeMilliseconds,
  refreshFamilyPolicy,
  stepUpAssuranceMaximumAgeMilliseconds,
} from '../../src/auth/policy.js';
import {
  testAuthRuntime,
  testConsumerOrigin,
  testCreatorOrigin,
  testServerConfig,
} from '../support/harness.js';
import {
  digestStructure,
  digestToken,
  digestValue,
  digestsEqual,
  generateOpaqueToken,
  isWellFormedOpaqueToken,
} from '../../src/auth/tokens.js';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('locked AUTH policy expressed in code', () => {
  it('derives every ADR-0017 session lifetime correctly', () => {
    expect(browserSessionPolicy.consumer_web).toEqual({
      absoluteMilliseconds: 30 * day,
      idleMilliseconds: 14 * day,
    });
    expect(browserSessionPolicy.creator_studio).toEqual({
      absoluteMilliseconds: 7 * day,
      idleMilliseconds: 8 * hour,
    });
    expect(browserSessionPolicy.platform_admin).toEqual({
      absoluteMilliseconds: 8 * hour,
      idleMilliseconds: 15 * minute,
    });
    expect(refreshFamilyPolicy).toEqual({
      absoluteMilliseconds: 90 * day,
      idleMilliseconds: 30 * day,
    });
    expect(accessTokenLifetimeMilliseconds).toBe(10 * minute);
    expect(recoveryTokenLifetimeMilliseconds).toBe(15 * minute);
    expect(highImpactCooldownMilliseconds).toBe(24 * hour);
    expect(stepUpAssuranceMaximumAgeMilliseconds).toBe(5 * minute);
  });

  it('derives every ADR-0017 recovery quota correctly', () => {
    expect(recoveryRateLimits).toEqual({
      perAccountPerDay: 5,
      perAccountPerHour: 3,
      perRequesterPerHour: 10,
    });
    expect(lockedAuthLimits.recoveryPerAccountPerHour).toBe(3);
  });

  it('refuses a malformed duration rather than guessing one', () => {
    for (const value of ['0d', '-1h', 'xh', '10', '1w'] as const) {
      expect(() =>
        durationMilliseconds(
          value as Parameters<typeof durationMilliseconds>[0],
        ),
      ).toThrow();
    }
  });

  it('orders assurance and gives the Admin audience a floor no other audience has', () => {
    expect(authAssuranceLevels).toEqual([
      'single_factor',
      'multi_factor',
      'phishing_resistant',
    ]);
    expect(assuranceAtLeast('phishing_resistant', 'single_factor')).toBe(true);
    expect(assuranceAtLeast('single_factor', 'multi_factor')).toBe(false);
    expect(minimumAssuranceByAudience.platform_admin).toBe(
      'phishing_resistant',
    );
    expect(minimumAssuranceByAudience.consumer_web).toBe('single_factor');
  });
});

describe('token generation and digests', () => {
  it('issues versioned tokens with at least 256 bits of entropy', () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const token = generateOpaqueToken();
      expect(isWellFormedOpaqueToken(token)).toBe(true);
      // 43 base64url characters carry 258 bits, so 32 random bytes survive
      // encoding without truncation.
      expect(token.split('.')[1]).toHaveLength(43);
      expect(Buffer.from(token.split('.')[1] ?? '', 'base64url')).toHaveLength(
        32,
      );
      tokens.add(token);
    }
    expect(tokens.size).toBe(500);
  });

  it('rejects tokens of another version or shape', () => {
    for (const candidate of [
      'v2.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'v1.short',
      'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '',
    ]) {
      expect(isWellFormedOpaqueToken(candidate)).toBe(false);
    }
  });

  it('digests deterministically and covers the version prefix', () => {
    const token = generateOpaqueToken();
    expect(digestToken(token)).toBe(digestToken(token));
    expect(digestToken(token)).toMatch(/^[0-9a-f]{64}$/u);
    expect(digestToken(token)).not.toBe(
      digestToken(token.replace('v1.', 'v2.')),
    );
    expect(digestToken(token)).not.toContain(token.split('.')[1]);
  });

  it('compares digests without an early length-sensitive exit', () => {
    const left = digestValue('left');
    expect(digestsEqual(left, left)).toBe(true);
    expect(digestsEqual(left, digestValue('right'))).toBe(false);
    expect(digestsEqual(left, left.slice(0, 10))).toBe(false);
  });

  it('digests structured arguments independently of key order', () => {
    expect(digestStructure({ a: 1, b: [2, { c: 3 }] })).toBe(
      digestStructure({ b: [2, { c: 3 }], a: 1 }),
    );
    expect(digestStructure({ a: 1 })).not.toBe(digestStructure({ a: '1' }));
    expect(digestStructure({ a: 1, b: undefined })).toBe(
      digestStructure({ a: 1 }),
    );
  });
});

describe('access-token signing authority', () => {
  const issuer = 'https://auth.velora.invalid';
  const currentKey = generateKeyPairSync('ed25519');
  const retiredKey = generateKeyPairSync('ed25519');
  const foreignKey = generateKeyPairSync('ed25519');

  const authority = new Ed25519AccessTokenAuthority({
    issuer,
    signingKey: currentKey.privateKey,
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const claims = {
    accountId: '11111111-1111-4111-8111-111111111111',
    assurance: 'single_factor',
    audience: 'consumer_mobile',
    expiresAt: new Date(now.getTime() + accessTokenLifetimeMilliseconds),
    issuedAt: now,
    refreshFamilyId: '22222222-2222-4222-8222-222222222222',
    tokenId: '33333333-3333-4333-8333-333333333333',
  } as const;

  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const decode = (value: string) =>
    JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  const parts = (token: string) => {
    const [header, payload, signature] = token.split('.');
    return {
      header: header ?? '',
      payload: payload ?? '',
      signature: signature ?? '',
    };
  };

  it('signs with EdDSA over Ed25519 and publishes the key identifier', () => {
    const token = authority.sign(claims);
    const header = decode(parts(token).header);
    expect(header.alg).toBe('EdDSA');
    expect(header.crv).toBe('Ed25519');
    expect(header.typ).toBe('at+jwt');
    expect(header.kid).toBe(authority.signingKeyId);
    expect(authority.signingKeyId).toBe(accessTokenKeyId(currentKey.publicKey));

    const verified = authority.verify(token, now);
    expect(verified?.accountId).toBe(claims.accountId);
    expect(verified?.audience).toBe('consumer_mobile');
    expect(verified?.refreshFamilyId).toBe(claims.refreshFamilyId);
  });

  it('verifies with public key material alone, which cannot mint a token', () => {
    // The verifier holds only the public key, which is the whole point of an
    // asymmetric signature: verification authority is not minting authority.
    const verifierOnly = new Ed25519AccessTokenAuthority({
      issuer,
      signingKey: foreignKey.privateKey,
      additionalVerificationKeys: [currentKey.publicKey],
    });
    const token = authority.sign(claims);
    expect(verifierOnly.verify(token, now)).toBeDefined();
    // A token the verifier mints with its own key is not accepted by the
    // authority that did not enrol it.
    expect(authority.verify(verifierOnly.sign(claims), now)).toBeUndefined();
  });

  it('accepts a retired key during overlapping rotation and refuses it afterwards', () => {
    const previous = new Ed25519AccessTokenAuthority({
      issuer,
      signingKey: retiredKey.privateKey,
    });
    const legacyToken = previous.sign(claims);

    const rotating = new Ed25519AccessTokenAuthority({
      additionalVerificationKeys: [retiredKey.publicKey],
      issuer,
      signingKey: currentKey.privateKey,
    });
    expect(rotating.verificationKeyIds).toHaveLength(2);
    expect(rotating.signingKeyId).toBe(accessTokenKeyId(currentKey.publicKey));
    // Tokens from before and after the rotation both verify.
    expect(rotating.verify(legacyToken, now)).toBeDefined();
    expect(rotating.verify(rotating.sign(claims), now)).toBeDefined();

    // Retiring the key is the emergency revocation seam: its tokens stop
    // verifying the moment it leaves the accepted set.
    const retired = new Ed25519AccessTokenAuthority({
      issuer,
      signingKey: currentKey.privateKey,
    });
    expect(retired.verify(legacyToken, now)).toBeUndefined();
  });

  it.each([
    [
      'algorithm downgraded to none',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), alg: 'none' })}.${parts(t).payload}.`,
    ],
    [
      'algorithm confused with HMAC',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), alg: 'HS256' })}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'curve substituted',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), crv: 'X25519' })}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'token type substituted',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), typ: 'JWT' })}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'key identifier unknown',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), kid: 'deadbeefdeadbeef' })}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'key identifier missing',
      (t: string) => {
        const { kid, ...rest } = decode(parts(t).header);
        void kid;
        return `${encode(rest)}.${parts(t).payload}.${parts(t).signature}`;
      },
    ],
    [
      'key identifier malformed',
      (t: string) =>
        `${encode({ ...decode(parts(t).header), kid: 12345 })}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'issuer substituted',
      (t: string) =>
        `${parts(t).header}.${encode({ ...decode(parts(t).payload), iss: 'https://attacker.test' })}.${parts(t).signature}`,
    ],
    [
      'audience raised to Platform Admin',
      (t: string) =>
        `${parts(t).header}.${encode({ ...decode(parts(t).payload), aud: 'platform_admin' })}.${parts(t).signature}`,
    ],
    [
      'expiry moved out',
      (t: string) =>
        `${parts(t).header}.${encode({ ...decode(parts(t).payload), exp: 4102444800 })}.${parts(t).signature}`,
    ],
    [
      'timestamps malformed',
      (t: string) =>
        `${parts(t).header}.${encode({ ...decode(parts(t).payload), exp: 'later', iat: 'now' })}.${parts(t).signature}`,
    ],
    [
      'timestamps not finite',
      (t: string) =>
        `${parts(t).header}.${encode({ ...decode(parts(t).payload), exp: null, iat: null })}.${parts(t).signature}`,
    ],
    [
      'signature truncated',
      (t: string) =>
        `${parts(t).header}.${parts(t).payload}.${parts(t).signature.slice(0, -4)}`,
    ],
    [
      'signature emptied',
      (t: string) => `${parts(t).header}.${parts(t).payload}.`,
    ],
    [
      'segment removed',
      (t: string) => `${parts(t).header}.${parts(t).payload}`,
    ],
    ['segment added', (t: string) => `${t}.extra`],
    [
      'header not an object',
      (t: string) =>
        `${encode(['EdDSA'])}.${parts(t).payload}.${parts(t).signature}`,
    ],
    [
      'header not decodable',
      (t: string) => `!!!.${parts(t).payload}.${parts(t).signature}`,
    ],
  ])('refuses a token whose %s', (_label, mutate) => {
    const forged = mutate(authority.sign(claims));
    expect(authority.verify(forged, now)).toBeUndefined();
  });

  it('refuses an oversized token before parsing it', () => {
    const oversized = `${'a'.repeat(5_000)}.${'b'.repeat(5_000)}.${'c'.repeat(5_000)}`;
    expect(authority.verify(oversized, now)).toBeUndefined();
    expect(authority.verify('', now)).toBeUndefined();
  });

  it('refuses a token signed by an unknown key even with a valid structure', () => {
    const foreign = new Ed25519AccessTokenAuthority({
      issuer,
      signingKey: foreignKey.privateKey,
    });
    expect(authority.verify(foreign.sign(claims), now)).toBeUndefined();
  });

  it('rejects an expired token and one issued beyond the tolerated skew', () => {
    const token = authority.sign(claims);
    expect(
      authority.verify(token, new Date(claims.expiresAt.getTime() + 1)),
    ).toBeUndefined();
    expect(
      authority.verify(token, new Date(now.getTime() - 60_000)),
    ).toBeUndefined();
    expect(
      authority.verify(token, new Date(now.getTime() - 1_000)),
    ).toBeDefined();
  });

  it('refuses key material of the wrong type or role', () => {
    expect(
      () =>
        new Ed25519AccessTokenAuthority({
          issuer,
          signingKey: currentKey.publicKey,
        }),
    ).toThrow();
    expect(
      () =>
        new Ed25519AccessTokenAuthority({
          additionalVerificationKeys: [currentKey.privateKey],
          issuer,
          signingKey: currentKey.privateKey,
        }),
    ).toThrow();
  });
});

describe('server-derived authorization context', () => {
  const base: AuthContext = {
    absoluteExpiresAt: new Date('2026-09-12T10:00:00.000Z'),
    accountId: '11111111-1111-4111-8111-111111111111',
    assurance: 'single_factor',
    assuranceEstablishedAt: new Date('2026-08-13T10:00:00.000Z'),
    audience: 'consumer_web',
    authenticatedAt: new Date('2026-08-13T10:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-27T10:00:00.000Z'),
    sessionId: '44444444-4444-4444-8444-444444444444',
    transport: 'cookie',
  };

  it('denies by default when no context exists', () => {
    expect(() => requireAuthenticated(undefined)).toThrow(AuthorizationError);
    expect(() => requireAudience(undefined, ['consumer_web'])).toThrow(
      AuthorizationError,
    );
    expect(() => requireAssurance(undefined, 'single_factor')).toThrow(
      AuthorizationError,
    );
  });

  it('refuses a consumer context for the Admin audience', () => {
    expect(() => requireAudience(base, ['platform_admin'])).toThrow(
      AuthorizationError,
    );
    expect(requireAudience(base, ['consumer_web']).accountId).toBe(
      base.accountId,
    );
  });

  it('refuses to satisfy the Admin audience floor with consumer assurance', () => {
    const impersonation: AuthContext = {
      ...base,
      audience: 'platform_admin',
      assurance: 'single_factor',
    };
    expect(() => requireAssurance(impersonation, 'single_factor')).toThrow(
      AuthorizationError,
    );
    expect(
      requireAssurance(
        { ...impersonation, assurance: 'phishing_resistant' },
        'single_factor',
      ).audience,
    ).toBe('platform_admin');
  });

  it('refuses stale assurance for a high-impact action', () => {
    const fresh = new Date(base.assuranceEstablishedAt.getTime() + 60_000);
    const stale = new Date(
      base.assuranceEstablishedAt.getTime() +
        stepUpAssuranceMaximumAgeMilliseconds +
        1_000,
    );
    const privileged: AuthContext = {
      ...base,
      assurance: 'phishing_resistant',
      audience: 'platform_admin',
    };
    expect(
      requireFreshAssurance(privileged, 'phishing_resistant', fresh).audience,
    ).toBe('platform_admin');
    expect(() =>
      requireFreshAssurance(privileged, 'phishing_resistant', stale),
    ).toThrow(AuthorizationError);
    // A clock that moved backwards is stale evidence, not fresh evidence.
    expect(() =>
      requireFreshAssurance(
        privileged,
        'phishing_resistant',
        new Date(base.assuranceEstablishedAt.getTime() - 1_000),
      ),
    ).toThrow(AuthorizationError);
  });
});

describe('browser request defences', () => {
  const allowed = ['https://web.velora.test'];

  function facts(
    overrides: Partial<Parameters<typeof evaluateBrowserRequest>[0]>,
  ) {
    return evaluateBrowserRequest(
      {
        cookiePresent: false,
        origin: null,
        secFetchMode: null,
        secFetchSite: null,
        stateChanging: true,
        ...overrides,
      },
      allowed,
    );
  }

  it('accepts an allowlisted origin on a state-changing request', () => {
    expect(facts({ origin: 'https://web.velora.test' }).allowed).toBe(true);
  });

  it.each([
    'https://evil.test',
    'http://web.velora.test',
    'https://web.velora.test:8443',
    'https://web.velora.test.evil.test',
    'null',
  ])('refuses origin %s', (origin) => {
    expect(facts({ origin }).allowed).toBe(false);
  });

  it('refuses a cross-site Fetch Metadata signal', () => {
    expect(
      facts({
        origin: 'https://web.velora.test',
        secFetchSite: 'cross-site',
      }).allowed,
    ).toBe(false);
    expect(
      facts({ origin: 'https://web.velora.test', secFetchSite: 'same-origin' })
        .allowed,
    ).toBe(true);
  });

  it('refuses a navigation-mode state-changing request', () => {
    expect(
      facts({ origin: 'https://web.velora.test', secFetchMode: 'navigate' })
        .allowed,
    ).toBe(false);
    expect(
      facts({ origin: 'https://web.velora.test', secFetchMode: 'no-cors' })
        .allowed,
    ).toBe(false);
  });

  it('refuses an ambient cookie credential with no provable origin', () => {
    expect(facts({ cookiePresent: true, origin: null }).allowed).toBe(false);
    // A non-browser caller carrying no cookie is not a forgery vector.
    expect(facts({ cookiePresent: false, origin: null }).allowed).toBe(true);
  });

  it('reads the facts it judges straight from the request', () => {
    const request = new Request('https://api.velora.test/v1/auth/logout', {
      headers: {
        origin: 'https://web.velora.test',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      },
      method: 'POST',
    });
    expect(readBrowserRequestFacts(request, { cookiePresent: true })).toEqual({
      cookiePresent: true,
      origin: 'https://web.velora.test',
      secFetchMode: 'cors',
      secFetchSite: 'same-site',
      stateChanging: true,
    });
  });
});

describe('browser session cookie policy', () => {
  it('emits exactly the ADR-0017 attributes and no Domain', () => {
    const cookie = issuedSessionCookie({
      audience: 'consumer_web',
      expiresAt: new Date('2026-09-12T10:00:00.000Z'),
      now: new Date('2026-08-13T10:00:00.000Z'),
      token: 'v1.token',
    });
    expect(
      cookie.startsWith('__Host-velora_consumer_web_session=v1.token'),
    ).toBe(true);
    for (const attribute of [
      'Path=/',
      'Secure',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=2592000',
    ]) {
      expect(cookie).toContain(attribute);
    }
    expect(cookie.toLowerCase()).not.toContain('domain=');
    expect(cookie.toLowerCase()).not.toContain('samesite=none');
  });

  it('uses a distinct cookie name per audience', () => {
    const names = (
      ['consumer_web', 'creator_studio', 'platform_admin'] as const
    ).map((audience) => clearedSessionCookie(audience).split('=')[0]);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name?.startsWith('__Host-')).toBe(true);
  });

  it('reads one cookie without trusting the header shape', () => {
    const header =
      'other=1; __Host-velora_consumer_web_session=v1.abc; trailing';
    expect(readCookie(header, '__Host-velora_consumer_web_session')).toBe(
      'v1.abc',
    );
    expect(readCookie(header, 'missing')).toBeUndefined();
    expect(readCookie(null, 'missing')).toBeUndefined();
  });

  it('refuses to guess when more than one audience cookie is presented and nothing says which', () => {
    expect(
      presentedSessionCookie(
        '__Host-velora_consumer_web_session=v1.a; __Host-velora_platform_admin_session=v1.b',
      ),
    ).toBeUndefined();
    expect(
      presentedSessionCookie('__Host-velora_creator_studio_session=v1.a')
        ?.audience,
    ).toBe('creator_studio');
  });
});

describe('local identity adapter', () => {
  const provider = new LocalIdentityProvider();

  it('normalises a subject so one person maps to one account', () => {
    expect(provider.assert('  Person@Velora.Test ')).toEqual({
      provider: 'local',
      providerSubject: 'person@velora.test',
    });
  });

  it('refuses a subject outside its accepted shape', () => {
    for (const subject of [
      '',
      ' ',
      'has space',
      'has/slash',
      'a'.repeat(201),
    ]) {
      expect(() => provider.assert(subject)).toThrow();
    }
  });
});

describe('AUTH composition root', () => {
  it('wires only development adapters and never a production stand-in', () => {
    const config = testServerConfig();
    const runtime = testAuthRuntime({ config });

    expect(runtime.service.identityProviderName).toBe('local');
    expect(runtime.service.signerKind).toBe('local-development-ed25519');
    // The runtime publishes exactly one key it can sign with, and it is one of
    // the keys it accepts.
    expect(runtime.service.signingKeyId).toMatch(/^[0-9a-f]{16}$/u);
    expect(runtime.service.verificationKeyIds).toContain(
      runtime.service.signingKeyId,
    );
    expect(runtime.recovery.deliveryKind).toBe('local-test');
    // The verifier the application selects refuses every assertion, so no
    // environment using it can reach privileged authority.
    expect(runtime.privilegedAccess.verifierKind).toBe('unavailable');
    void runtime.close();
  });

  it('refuses every assertion the unavailable authenticator verifier receives', async () => {
    const verifier: PrivilegedAuthenticatorVerifier =
      new UnavailablePrivilegedAuthenticatorVerifier();
    expect(
      await verifier.verify({
        assertion: {
          clientDataDigest: 'digest',
          credentialId: 'credential',
          signCount: 99,
          signature: 'signature',
        },
        challenge: 'challenge',
        publicKey: 'public-key',
      }),
    ).toBeUndefined();
  });

  it('exposes each audience allowlist separately, with no shared origin bucket', () => {
    const runtime = testAuthRuntime({
      config: testServerConfig({
        AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: '',
      }),
    });
    expect(runtime.allowedOrigins.consumer_web).toEqual([testConsumerOrigin]);
    expect(runtime.allowedOrigins.creator_studio).toEqual([testCreatorOrigin]);
    // An audience with no configured origin cannot start a browser session.
    expect(runtime.allowedOrigins.platform_admin).toEqual([]);
    expect(runtime.allowedOriginUnion).toEqual([
      testConsumerOrigin,
      testCreatorOrigin,
    ]);
    void runtime.close();
  });
});

describe('argument binding canonicalisation', () => {
  it('refuses values with no unambiguous textual form', () => {
    for (const ambiguous of [
      new Map([['a', 1]]),
      new Set([1]),
      Buffer.from('x'),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date('not a date'),
      () => undefined,
      Symbol('x'),
    ]) {
      expect(() => digestStructure({ value: ambiguous })).toThrow();
    }
  });

  it('never lets two different argument sets share a digest', () => {
    const distinct = [
      { at: new Date('2026-08-14T10:00:00.000Z') },
      { at: {} },
      { at: '2026-08-14T10:00:00.000Z' },
      { at: null },
      { value: 1 },
      { value: '1' },
      { value: 1n },
      { value: true },
      { value: 'true' },
      { value: [1] },
      { value: { 0: 1 } },
    ];
    const digests = distinct.map((entry) => digestStructure(entry));
    expect(new Set(digests).size).toBe(distinct.length);
  });

  it('treats key order, absent keys, and negative zero as identical', () => {
    expect(digestStructure({ a: 1, b: 2 })).toBe(
      digestStructure({ b: 2, a: 1 }),
    );
    expect(digestStructure({ a: 1, b: undefined })).toBe(
      digestStructure({ a: 1 }),
    );
    expect(digestStructure({ a: -0 })).toBe(digestStructure({ a: 0 }));
  });
});

describe('local identity adapter containment', () => {
  const apiSourceRoot = resolve(
    fileURLToPath(new URL('../../src', import.meta.url)),
  );

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(path)
        : path.endsWith('.ts')
          ? [path]
          : [];
    });
  }

  it('constructs the development identity adapter only at the composition root', () => {
    const constructors = sourceFiles(apiSourceRoot).filter((file) =>
      readFileSync(file, 'utf8').includes('new LocalIdentityProvider('),
    );
    expect(constructors.map((file) => relative(apiSourceRoot, file))).toEqual([
      'auth/composition.ts',
    ]);
  });

  it('constructs the development signing authority only at the composition root', () => {
    const constructors = sourceFiles(apiSourceRoot).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        source.includes('new Ed25519AccessTokenAuthority(') ||
        source.includes('Ed25519AccessTokenAuthority.withGeneratedKey(')
      );
    });
    expect(
      constructors.map((file) => relative(apiSourceRoot, file)).sort(),
    ).toEqual(['auth/access-token.ts', 'auth/composition.ts']);
  });

  it('never names a test double from application source', () => {
    const offenders = sourceFiles(apiSourceRoot).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        source.includes('ScriptedAuthenticatorVerifier') ||
        source.includes('createInMemorySecureTokenStore')
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('which session cookie a request is using', () => {
  const allowedOrigins = {
    consumer_web: ['https://consumer.velora.test'],
    creator_studio: ['https://studio.velora.test'],
    platform_admin: ['https://admin.velora.test'],
  } as const;
  const both = [
    '__Host-velora_consumer_web_session=v1.consumer',
    '__Host-velora_creator_studio_session=v1.creator',
  ].join('; ');

  it('needs no disambiguation when only one cookie is presented', () => {
    expect(
      presentedSessionCookie('__Host-velora_consumer_web_session=v1.only'),
    ).toEqual({ audience: 'consumer_web', token: 'v1.only' });
  });

  it('uses the cookie belonging to the surface that sent the request', () => {
    // Two surfaces sharing a host means the browser sends both cookies. The
    // origin is set by the browser, cannot be forged by page script, and says
    // which surface this is.
    expect(
      presentedSessionCookie(both, {
        allowedOrigins,
        origin: 'https://studio.velora.test',
      }),
    ).toEqual({ audience: 'creator_studio', token: 'v1.creator' });
    expect(
      presentedSessionCookie(both, {
        allowedOrigins,
        origin: 'https://consumer.velora.test',
      }),
    ).toEqual({ audience: 'consumer_web', token: 'v1.consumer' });
  });

  it('refuses rather than guessing when nothing identifies the surface', () => {
    // A foreign origin belongs to no audience, an absent origin identifies
    // nothing, and no disambiguation at all is the same ambiguity. Every one of
    // them is refused rather than resolved by preference order.
    expect(presentedSessionCookie(both)).toBeUndefined();
    expect(
      presentedSessionCookie(both, { allowedOrigins, origin: null }),
    ).toBeUndefined();
    expect(
      presentedSessionCookie(both, {
        allowedOrigins,
        origin: 'https://evil.test',
      }),
    ).toBeUndefined();
  });

  it('refuses when one origin is configured for two audiences', () => {
    // A misconfiguration that made two surfaces share an origin would make the
    // request genuinely ambiguous again, and it fails closed.
    expect(
      presentedSessionCookie(both, {
        allowedOrigins: {
          consumer_web: ['https://shared.velora.test'],
          creator_studio: ['https://shared.velora.test'],
          platform_admin: [],
        },
        origin: 'https://shared.velora.test',
      }),
    ).toBeUndefined();
  });
});
