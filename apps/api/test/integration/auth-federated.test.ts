import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';

import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { AllowlistedOutboundHttp } from '../../src/security/outbound-http.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminOrigin,
  testConsumerOrigin,
  testServerConfig,
} from '../support/harness.js';

/**
 * Federated sign-in, from the browser's first request to the cookie it holds.
 *
 * A conforming OpenID provider is stood up in this process, so this is a
 * `PROVIDER CONTRACT PROOF` rather than cloud evidence: it proves that VELORA
 * composes, sends, exchanges, verifies, and issues correctly against a provider
 * that behaves, and it proves nothing about any particular vendor's behaviour.
 *
 * What it is really for is the four ways the ceremony can be attacked, each of
 * which is a separate test below: a replayed callback, a callback presented by
 * a browser that did not open the attempt, an attempt opened from an origin
 * that is not allowed to open one for that audience, and a destination pointing
 * off this platform.
 */

const databaseUrl = await provisionDatabase('velora_auth_federated');
const database: TestDatabase = connectDatabase(databaseUrl);
const logger = silentLogger();

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const signingKeyId = 'federated-test-key';
const jwk = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  alg: 'RS256',
  kid: signingKeyId,
  use: 'sig',
};

const clientId = 'velora-federated-test';
let issuerAddress = '';
/** The nonce the provider was asked for, so the token it mints carries it. */
let lastNonce = '';
/** Set by a test that wants the provider to mint a token for somebody else. */
let subjectOverride: string | undefined;

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const provider = Bun.serve({
  port: 0,
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.pathname === '/.well-known/openid-configuration') {
      return Response.json({
        authorization_endpoint: `${issuerAddress}/authorize`,
        issuer: issuerAddress,
        jwks_uri: `${issuerAddress}/jwks`,
        token_endpoint: `${issuerAddress}/token`,
      });
    }
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    if (url.pathname === '/token') {
      const now = Math.floor(Date.now() / 1000);
      const header = encode({ alg: 'RS256', kid: signingKeyId, typ: 'JWT' });
      const payload = encode({
        aud: clientId,
        exp: now + 300,
        iat: now,
        iss: issuerAddress,
        nonce: lastNonce,
        sub: subjectOverride ?? 'federated-subject-1',
      });
      const signature = signBytes(
        'sha256',
        Buffer.from(`${header}.${payload}`, 'utf8'),
        privateKey,
      );
      return Response.json({
        id_token: `${header}.${payload}.${signature.toString('base64url')}`,
      });
    }
    return new Response('not found', { status: 404 });
  },
});
issuerAddress = `http://127.0.0.1:${String(provider.port)}`;

const config = testServerConfig({
  AUTH_IDENTITY_PROVIDER: 'oidc',
  AUTH_OIDC_CLIENT_ID: clientId,
  AUTH_OIDC_CLIENT_SECRET: 'federated-test-secret',
  AUTH_OIDC_ISSUER: issuerAddress,
  AUTH_OIDC_REDIRECT_URI: 'http://127.0.0.1:4000/v1/auth/federated/callback',
});

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    // The real adapter, with the one allowance local and test have.
    outboundHttp: new AllowlistedOutboundHttp({ allowLoopback: true }),
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'federated-test-requester',
  },
});

afterAll(async () => {
  await provider.stop(true);
  await auth.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  subjectOverride = undefined;
});

function openRequest(body: unknown, origin: string): Request {
  return new Request('http://127.0.0.1:4000/v1/auth/federated/authorizations', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

function cookieValue(cookies: readonly string[], name: string): string {
  const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (found === undefined) throw new Error(`no ${name} cookie was set`);
  return found.slice(name.length + 1).split(';')[0] ?? '';
}

async function openAttempt(input: {
  readonly audience: 'consumer_web' | 'platform_admin';
  readonly origin: string;
  readonly returnTo?: string;
}): Promise<{ readonly state: string; readonly nonce: string }> {
  const body: Record<string, unknown> = { audience: input.audience };
  if (input.returnTo !== undefined) body.returnTo = input.returnTo;
  const opened = await auth.routes.createFederatedAuthorization({
    body: JSON.stringify(body),
    correlationId: 'federated',
    request: openRequest(body, input.origin),
  });
  expect(opened.status).toBe(201);
  const authorizationUrl = (opened.body as { authorizationUrl: string })
    .authorizationUrl;
  const query = new URL(authorizationUrl).searchParams;
  const state = query.get('state') ?? '';
  lastNonce = query.get('nonce') ?? '';
  // The binding cookie carries the same state, so the two cannot drift.
  expect(
    cookieValue(opened.cookies ?? [], '__Host-velora_federated_state'),
  ).toBe(state);
  return { nonce: lastNonce, state };
}

function callback(input: {
  readonly bindingState?: string | undefined;
  readonly error?: string;
  readonly state: string;
}): Request {
  const url = new URL('http://127.0.0.1:4000/v1/auth/federated/callback');
  url.searchParams.set('authorizationState', input.state);
  if (input.error === undefined) {
    url.searchParams.set('authorizationCode', 'provider-code');
  } else {
    url.searchParams.set('authorizationError', input.error);
  }
  const headers: Record<string, string> = {};
  if (input.bindingState !== undefined) {
    headers.cookie = `__Host-velora_federated_state=${input.bindingState}`;
  }
  return new Request(url.toString(), { headers, method: 'GET' });
}

describe('federated sign-in', () => {
  it('issues a session for the subject the provider signed', async () => {
    const { state } = await openAttempt({
      audience: 'consumer_web',
      origin: testConsumerOrigin,
      returnTo: '/discover',
    });

    const completed = await auth.routes.completeFederatedAuthorization({
      body: '',
      correlationId: 'federated',
      request: callback({ bindingState: state, state }),
    });

    expect(completed.status).toBe(303);
    expect(completed.headers?.location).toBe(`${testConsumerOrigin}/discover`);
    const cookies = completed.cookies ?? [];
    expect(
      cookies.some((cookie) =>
        cookie.startsWith('__Host-velora_consumer_web_session='),
      ),
    ).toBe(true);
    // The binding is released, because the attempt is over.
    expect(
      cookies.some((cookie) =>
        cookie.startsWith('__Host-velora_federated_state=;'),
      ),
    ).toBe(true);

    const identities = await rowsOf<{ provider: string; subject: string }>(
      database.sql`select provider, provider_subject as subject from auth_identities`,
    );
    expect(identities).toEqual([
      { provider: 'oidc', subject: 'federated-subject-1' },
    ]);
  });

  it('maps a repeat sign-in to the same account', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { state } = await openAttempt({
        audience: 'consumer_web',
        origin: testConsumerOrigin,
      });
      const completed = await auth.routes.completeFederatedAuthorization({
        body: '',
        correlationId: 'federated',
        request: callback({ bindingState: state, state }),
      });
      expect(completed.status).toBe(303);
    }
    const accounts = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_accounts`,
    );
    expect(accounts[0]?.total).toBe(1);
  });

  it('issues a Platform Admin session, which no local adapter may mint', async () => {
    const { state } = await openAttempt({
      audience: 'platform_admin',
      origin: testAdminOrigin,
    });
    const completed = await auth.routes.completeFederatedAuthorization({
      body: '',
      correlationId: 'federated',
      request: callback({ bindingState: state, state }),
    });
    expect(completed.status).toBe(303);
    const sessions = await rowsOf<{ assurance: string; audience: string }>(
      database.sql`select audience, assurance from auth_sessions`,
    );
    // Admitted, and at single-factor assurance: reaching the console still
    // takes an authenticator, which is a separate ceremony.
    expect(sessions).toEqual([
      { assurance: 'single_factor', audience: 'platform_admin' },
    ]);
  });

  it('refuses a callback the same browser did not open', async () => {
    const { state } = await openAttempt({
      audience: 'consumer_web',
      origin: testConsumerOrigin,
    });
    // Login CSRF: somebody else completed the attempt and is walking a victim
    // onto the callback address.
    const refused = await auth.routes.completeFederatedAuthorization({
      body: '',
      correlationId: 'federated',
      request: callback({ state }),
    });
    expect(refused.status).toBe(400);
    expect(
      await rowsOf<{ total: number }>(
        database.sql`select count(*)::int as total from auth_sessions`,
      ),
    ).toEqual([{ total: 0 }]);
  });

  it('refuses a replayed callback', async () => {
    const { state } = await openAttempt({
      audience: 'consumer_web',
      origin: testConsumerOrigin,
    });
    expect(
      (
        await auth.routes.completeFederatedAuthorization({
          body: '',
          correlationId: 'federated',
          request: callback({ bindingState: state, state }),
        })
      ).status,
    ).toBe(303);
    // The attempt was claimed by a conditional update, so there is nothing
    // left for a second callback to claim.
    expect(
      (
        await auth.routes.completeFederatedAuthorization({
          body: '',
          correlationId: 'federated',
          request: callback({ bindingState: state, state }),
        })
      ).status,
    ).toBe(400);
  });

  it('returns the browser with a marker when the provider refuses', async () => {
    const { state } = await openAttempt({
      audience: 'consumer_web',
      origin: testConsumerOrigin,
      returnTo: '/discover',
    });
    const refused = await auth.routes.completeFederatedAuthorization({
      body: '',
      correlationId: 'federated',
      request: callback({ bindingState: state, error: 'access_denied', state }),
    });
    expect(refused.status).toBe(303);
    expect(refused.headers?.location).toBe(
      `${testConsumerOrigin}/discover?velora_auth=refused`,
    );
    expect(
      (refused.cookies ?? []).some((cookie) =>
        cookie.startsWith('__Host-velora_consumer_web_session='),
      ),
    ).toBe(false);
  });

  it('refuses an attempt opened from an origin that audience does not use', async () => {
    // Naming an audience is a request, not a selection. A page on the consumer
    // origin cannot open an attempt that would end in a Platform Admin session.
    const refused = await auth.routes.createFederatedAuthorization({
      body: JSON.stringify({ audience: 'platform_admin' }),
      correlationId: 'federated',
      request: openRequest({ audience: 'platform_admin' }, testConsumerOrigin),
    });
    expect(refused.status).toBe(403);
  });

  it('never stores a destination off this platform', async () => {
    const refused = await auth.routes.createFederatedAuthorization({
      body: JSON.stringify({
        audience: 'consumer_web',
        returnTo: 'https://evil.example/steal',
      }),
      correlationId: 'federated',
      request: openRequest(
        { audience: 'consumer_web', returnTo: 'https://evil.example/steal' },
        testConsumerOrigin,
      ),
    });
    expect(refused.status).toBe(422);
    expect(
      await rowsOf<{ total: number }>(
        database.sql`select count(*)::int as total from auth_federated_authorizations`,
      ),
    ).toEqual([{ total: 0 }]);
  });

  it.each([
    ['a protocol-relative address', '//evil.example/steal'],
    ['a backslash some browsers normalise', '/\\evil.example'],
    ['an absolute address', 'https://evil.example/steal'],
    ['a scheme', 'javascript:alert(1)'],
  ])('refuses %s as a return destination', async (_name, returnTo) => {
    const refused = await auth.routes.createFederatedAuthorization({
      body: JSON.stringify({ audience: 'consumer_web', returnTo }),
      correlationId: 'federated',
      request: openRequest(
        { audience: 'consumer_web', returnTo },
        testConsumerOrigin,
      ),
    });
    expect(refused.status).toBe(422);
  });
});
