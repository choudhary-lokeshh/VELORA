import { describe, expect, it } from 'vitest';

import { resolveApiBaseUrl } from '../src/api';
import { readCsrfToken, type AuthOutcome } from '../src/auth/client';
import {
  initialConsumerAuthState,
  reduceConsumerAuth,
  type ConsumerAuthState,
} from '../src/auth/state';

const session = {
  absoluteExpiresAt: '2026-09-12T10:00:00.000Z',
  accountId: '11111111-1111-4111-8111-111111111111',
  assurance: 'single_factor',
  assuranceEstablishedAt: '2026-08-13T10:00:00.000Z',
  audience: 'consumer_web',
  authenticatedAt: '2026-08-13T10:00:00.000Z',
  idleExpiresAt: '2026-08-27T10:00:00.000Z',
} as const;

const authenticated: AuthOutcome = { kind: 'authenticated', session };
const unauthenticated: AuthOutcome = { kind: 'unauthenticated' };

function stateAfter(
  events: readonly Parameters<typeof reduceConsumerAuth>[1][],
): ConsumerAuthState {
  return events.reduce(reduceConsumerAuth, initialConsumerAuthState);
}

describe('Consumer Web authentication state', () => {
  it('starts in a loading state rather than assuming anonymity', () => {
    expect(initialConsumerAuthState.status).toBe('loading');
  });

  it('moves from bootstrap to authenticated and back to signed out', () => {
    const signedIn = stateAfter([
      { outcome: authenticated, type: 'session-result' },
    ]);
    expect(signedIn.status).toBe('authenticated');

    const signedOut = reduceConsumerAuth(signedIn, {
      outcome: unauthenticated,
      type: 'logout-result',
    });
    expect(signedOut).toEqual({
      cause: 'signed_out',
      status: 'unauthenticated',
    });
  });

  it('reports a lapsed session without claiming to know why', () => {
    const signedIn = stateAfter([
      { outcome: authenticated, type: 'session-result' },
    ]);
    const ended = reduceConsumerAuth(signedIn, {
      outcome: unauthenticated,
      type: 'session-result',
    });
    expect(ended).toEqual({
      cause: 'session_ended',
      status: 'unauthenticated',
    });

    // Before any session existed, the same server answer means "nobody signed
    // in here", not "your session ended".
    expect(
      stateAfter([{ outcome: unauthenticated, type: 'session-result' }]),
    ).toEqual({ cause: 'initial', status: 'unauthenticated' });
  });

  it('distinguishes global sign-out from local sign-out', () => {
    const signedIn = stateAfter([
      { outcome: authenticated, type: 'session-result' },
    ]);
    expect(
      reduceConsumerAuth(signedIn, {
        outcome: unauthenticated,
        type: 'logout-everywhere-result',
      }),
    ).toEqual({ cause: 'signed_out_everywhere', status: 'unauthenticated' });
  });

  it('surfaces a refusal code and a dependency outage separately', () => {
    expect(
      stateAfter([
        {
          outcome: { code: 'AUTH_CSRF_REQUIRED', kind: 'rejected' },
          type: 'logout-result',
        },
      ]),
    ).toEqual({ code: 'AUTH_CSRF_REQUIRED', status: 'rejected' });
    expect(
      stateAfter([
        { outcome: { kind: 'unavailable' }, type: 'session-result' },
      ]),
    ).toEqual({ status: 'unavailable' });
  });
});

describe('Consumer Web CSRF companion cookie', () => {
  it('reads only its own audience cookie', () => {
    expect(
      readCsrfToken(
        'other=1; __Host-velora_consumer_web_csrf=v1.abc; __Host-velora_creator_studio_csrf=v1.def',
      ),
    ).toBe('v1.abc');
    expect(readCsrfToken('__Host-velora_creator_studio_csrf=v1.def')).toBe(
      undefined,
    );
    expect(readCsrfToken('')).toBeUndefined();
  });
});

describe('Consumer Web API endpoint resolution', () => {
  it('uses the local default only in local and test environments', () => {
    expect(resolveApiBaseUrl({ VELORA_APP_ENV: 'local' })).toBe(
      'http://127.0.0.1:4000',
    );
    expect(() => resolveApiBaseUrl({ VELORA_APP_ENV: 'production' })).toThrow();
    expect(() =>
      resolveApiBaseUrl({
        VELORA_API_BASE_URL: 'http://127.0.0.1:4000',
        VELORA_APP_ENV: 'production',
      }),
    ).toThrow();
    expect(
      resolveApiBaseUrl({
        VELORA_API_BASE_URL: 'https://api.velora.test',
        VELORA_APP_ENV: 'production',
      }),
    ).toBe('https://api.velora.test');
  });
});
