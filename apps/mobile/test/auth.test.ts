import {
  createInMemorySecureTokenStore,
  type StoredMobileTokens,
} from '../src/auth/secure-storage';
import { createMobileAuthManager } from '../src/auth/session';

/**
 * These tests exercise restore, rotation, and the single-flight guarantee
 * against a scripted API. They deliberately claim nothing about the platform
 * keystore: the in-memory store is a test double, and only the real device
 * adapter carries ADR-0017's storage properties.
 */

const apiBaseUrl = 'http://api.test';
const clock = { current: new Date('2026-08-13T10:00:00.000Z') };

function tokenBody(generation: number, expiresInMinutes = 10) {
  return {
    accessToken: `access-${String(generation)}`,
    accessTokenExpiresAt: new Date(
      clock.current.getTime() + expiresInMinutes * 60_000,
    ).toISOString(),
    accountId: '11111111-1111-4111-8111-111111111111',
    assurance: 'single_factor',
    audience: 'consumer_mobile',
    refreshToken: `refresh-${String(generation)}`,
    refreshTokenAbsoluteExpiresAt: '2026-11-11T10:00:00.000Z',
    refreshTokenIdleExpiresAt: '2026-09-12T10:00:00.000Z',
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

interface ScriptedApi {
  readonly calls: { body: unknown; path: string }[];
  readonly fetch: typeof fetch;
  refreshFailures: number;
  rotations: number;
}

function scriptedApi(options?: {
  readonly refreshRejects?: boolean;
}): ScriptedApi {
  const state: ScriptedApi = {
    calls: [],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      // openapi-fetch hands the transport a Request, so the fake reads the
      // request rather than assuming a URL string and an init object.
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const path = request.url.slice(request.url.indexOf('/v1'));
      const raw = await request.text();
      const body: unknown = raw.length > 0 ? JSON.parse(raw) : undefined;
      state.calls.push({ body, path });

      if (path === '/v1/auth/local/mobile-sessions') {
        return json(tokenBody(0), 201);
      }
      if (path === '/v1/auth/mobile/refresh') {
        if (options?.refreshRejects === true) {
          state.refreshFailures += 1;
          return json(
            {
              code: 'AUTH_REFRESH_INVALID',
              correlationId: 'test',
              message: 'Request failed',
            },
            401,
          );
        }
        state.rotations += 1;
        return json(tokenBody(state.rotations), 200);
      }
      if (path === '/v1/auth/session') {
        const authorization = request.headers.get('authorization');
        if (authorization === null) {
          return json(
            {
              code: 'AUTH_REQUIRED',
              correlationId: 'test',
              message: 'Request failed',
            },
            401,
          );
        }
        return json(
          {
            absoluteExpiresAt: '2026-11-11T10:00:00.000Z',
            accountId: '11111111-1111-4111-8111-111111111111',
            assurance: 'single_factor',
            assuranceEstablishedAt: '2026-08-13T10:00:00.000Z',
            audience: 'consumer_mobile',
            authenticatedAt: '2026-08-13T10:00:00.000Z',
            idleExpiresAt: '2026-09-12T10:00:00.000Z',
          },
          200,
        );
      }
      return json({ status: 'revoked' }, 200);
    }) satisfies typeof fetch,
    refreshFailures: 0,
    rotations: 0,
  };
  return state;
}

function manager(api: ScriptedApi, store = createInMemorySecureTokenStore()) {
  return {
    manager: createMobileAuthManager({
      apiBaseUrl,
      fetch: api.fetch,
      now: () => clock.current,
      store,
    }),
    store,
  };
}

describe('Consumer Mobile session manager', () => {
  beforeEach(() => {
    clock.current = new Date('2026-08-13T10:00:00.000Z');
  });

  it('starts unauthenticated when nothing is stored', async () => {
    const { manager: auth } = manager(scriptedApi());

    expect(await auth.restore()).toEqual({
      cause: 'initial',
      status: 'unauthenticated',
    });
    expect(await auth.accessToken()).toBeUndefined();
  });

  it('signs in, persists tokens, and restores on next launch', async () => {
    const api = scriptedApi();
    const { manager: auth, store } = manager(api);

    const signedIn = await auth.signIn({
      installationId: 'installation-mobile-1',
      subject: 'mobile@velora.test',
    });
    expect(signedIn.status).toBe('authenticated');
    const persisted: StoredMobileTokens | undefined = await store.read();
    expect(persisted?.refreshToken).toBe('refresh-0');

    const relaunched = createMobileAuthManager({
      apiBaseUrl,
      fetch: api.fetch,
      now: () => clock.current,
      store,
    });
    expect((await relaunched.restore()).status).toBe('authenticated');
  });

  it.each([2, 10, 50])(
    'rotates the refresh token once for a burst of %i concurrent requests',
    async (burst) => {
      const api = scriptedApi();
      const { manager: auth } = manager(api);
      await auth.signIn({
        installationId: `installation-burst-${String(burst)}`,
        subject: 'mobile@velora.test',
      });

      clock.current = new Date(clock.current.getTime() + 11 * 60_000);
      const tokens = await Promise.all(
        Array.from({ length: burst }, async () => auth.accessToken()),
      );

      // The server would revoke the family on a second presentation, so a
      // single-flight failure here is a lockout, not a warning.
      expect(api.rotations).toBe(1);
      expect(auth.refreshExchanges).toBe(1);
      expect(new Set(tokens).size).toBe(1);
      expect(
        api.calls.filter((call) => call.path === '/v1/auth/mobile/refresh'),
      ).toHaveLength(1);
    },
  );

  it('rotates the refresh token once for a burst of concurrent requests', async () => {
    const api = scriptedApi();
    const { manager: auth } = manager(api);
    await auth.signIn({
      installationId: 'installation-mobile-2',
      subject: 'mobile@velora.test',
    });

    // Every caller sees an expired access token at once.
    clock.current = new Date(clock.current.getTime() + 11 * 60_000);
    const tokens = await Promise.all(
      Array.from({ length: 12 }, async () => auth.accessToken()),
    );

    expect(api.rotations).toBe(1);
    expect(auth.refreshExchanges).toBe(1);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBe('access-1');

    const refreshCalls = api.calls.filter(
      (call) => call.path === '/v1/auth/mobile/refresh',
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.body).toEqual({ refreshToken: 'refresh-0' });
  });

  it('never replays a rotated refresh token on the following burst', async () => {
    const api = scriptedApi();
    const { manager: auth } = manager(api);
    await auth.signIn({
      installationId: 'installation-mobile-3',
      subject: 'mobile@velora.test',
    });

    for (let round = 1; round <= 3; round += 1) {
      clock.current = new Date(clock.current.getTime() + 11 * 60_000);
      await Promise.all(
        Array.from({ length: 5 }, async () => auth.accessToken()),
      );
    }

    const presented = api.calls
      .filter((call) => call.path === '/v1/auth/mobile/refresh')
      .map((call) => (call.body as { refreshToken: string }).refreshToken);
    expect(presented).toEqual(['refresh-0', 'refresh-1', 'refresh-2']);
    expect(new Set(presented).size).toBe(presented.length);
  });

  it('drops local material when the family is no longer valid', async () => {
    const rejecting = scriptedApi({ refreshRejects: true });
    const { manager: auth, store } = manager(rejecting);
    await auth.signIn({
      installationId: 'installation-mobile-4',
      subject: 'mobile@velora.test',
    });

    clock.current = new Date(clock.current.getTime() + 11 * 60_000);
    expect(await auth.accessToken()).toBeUndefined();
    expect(rejecting.refreshFailures).toBe(1);
    expect(auth.state).toEqual({
      cause: 'session_ended',
      status: 'unauthenticated',
    });
    expect(await store.read()).toBeUndefined();
  });

  it('clears stored tokens on sign-out and on global sign-out', async () => {
    for (const method of ['signOut', 'signOutEverywhere'] as const) {
      const { manager: auth, store } = manager(scriptedApi());
      await auth.signIn({
        installationId: 'installation-mobile-5',
        subject: 'mobile@velora.test',
      });
      expect(await store.read()).toBeDefined();

      const result = await auth[method]();
      expect(result.status).toBe('unauthenticated');
      expect(await store.read()).toBeUndefined();
      expect(await auth.accessToken()).toBeUndefined();
    }
  });

  it('reports a secure-storage failure instead of pretending the session is durable', async () => {
    const { manager: auth } = manager(
      scriptedApi(),
      createInMemorySecureTokenStore({ failWrites: true }),
    );

    const result = await auth.signIn({
      installationId: 'installation-mobile-6',
      subject: 'mobile@velora.test',
    });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('keeps token material out of every value it returns as state', async () => {
    const { manager: auth } = manager(scriptedApi());
    const signedIn = await auth.signIn({
      installationId: 'installation-mobile-7',
      subject: 'mobile@velora.test',
    });

    const serialised = JSON.stringify(signedIn);
    expect(serialised).not.toContain('refresh-0');
    expect(serialised).not.toContain('access-0');
  });
});

describe('Consumer Mobile transport failures', () => {
  function offline(): ScriptedApi {
    return {
      calls: [],
      fetch: (() =>
        Promise.reject(
          new Error('Network request failed'),
        )) satisfies typeof fetch,
      refreshFailures: 0,
      rotations: 0,
    };
  }

  it('keeps the stored session when the device is offline at launch', async () => {
    const api = scriptedApi();
    const { manager: auth, store } = manager(api);
    await auth.signIn({
      installationId: 'installation-offline-1',
      subject: 'mobile@velora.test',
    });

    const relaunched = createMobileAuthManager({
      apiBaseUrl,
      fetch: offline().fetch,
      now: () => clock.current,
      store,
    });
    expect(await relaunched.restore()).toEqual({ status: 'unavailable' });
    // A transport failure must never look like a revoked session.
    expect(await store.read()).toBeDefined();
  });

  it('keeps the refresh token when the rotation request never reaches the server', async () => {
    const api = scriptedApi();
    const { manager: auth, store } = manager(api);
    await auth.signIn({
      installationId: 'installation-offline-2',
      subject: 'mobile@velora.test',
    });

    const disconnected = createMobileAuthManager({
      apiBaseUrl,
      fetch: offline().fetch,
      now: () => clock.current,
      store,
    });
    clock.current = new Date(clock.current.getTime() + 11 * 60_000);
    expect(await disconnected.accessToken()).toBeUndefined();
    expect(disconnected.state).toEqual({ status: 'unavailable' });
    expect(await store.read()).toBeDefined();
  });

  it('reports an unreachable service on sign-in instead of throwing', async () => {
    const { manager: auth } = manager(offline());
    expect(
      await auth.signIn({
        installationId: 'installation-offline-3',
        subject: 'mobile@velora.test',
      }),
    ).toEqual({ status: 'unavailable' });
  });

  it('still clears local material when sign-out cannot reach the server', async () => {
    const api = scriptedApi();
    const { manager: auth, store } = manager(api);
    await auth.signIn({
      installationId: 'installation-offline-4',
      subject: 'mobile@velora.test',
    });

    const disconnected = createMobileAuthManager({
      apiBaseUrl,
      fetch: offline().fetch,
      now: () => clock.current,
      store,
    });
    expect((await disconnected.signOut()).status).toBe('unauthenticated');
    expect(await store.read()).toBeUndefined();
  });
});
