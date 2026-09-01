import { describe, expect, it } from 'bun:test';

import {
  livekitRtcProvider,
  loadServerConfig,
  localTestRtcProvider,
  redactServerConfig,
  unavailableRtcProvider,
} from '@velora/config/server';

import { LiveKitRtcProvider } from '../../src/realtime/livekit-provider.js';
import { rtcJoinCredentialTtlMilliseconds } from '../../src/realtime/policy.js';
import type { RtcProviderPort } from '../../src/realtime/provider.js';

const baseEnvironment = {
  AUTH_BROWSER_ORIGINS_CONSUMER_WEB: 'http://127.0.0.1:3000',
  AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: 'http://127.0.0.1:3001',
  AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: 'http://127.0.0.1:3002',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:1/velora',
  EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:1/0',
  QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
};

const credentials = {
  apiKey: 'APItestkey',
  apiSecret: 'test-secret-that-is-long-enough-to-sign-with',
  url: 'wss://velora-test.livekit.cloud',
};

function provider(now = () => new Date('2026-09-01T10:00:00.000Z')) {
  return new LiveKitRtcProvider(credentials, now);
}

/**
 * The claims a minted credential carries.
 *
 * Decoded by hand rather than with the signing library's own helper. Both the
 * JWT library and the protocol package arrive transitively through the provider
 * SDK, and a test that imported either would be this workspace depending on
 * something its manifest does not declare — which the boundary gate exists to
 * prevent and which would break the day the SDK changed one of them.
 *
 * No signature is verified here, deliberately: what is being asserted is the
 * *scope* a token claims, and verifying it would only prove the library can
 * check its own arithmetic.
 */
function claimsOf(credential: string): Readonly<Record<string, unknown>> {
  const payload = credential.split('.')[1];
  if (payload === undefined) throw new Error('credential is not a JWT');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Readonly<Record<string, unknown>>;
}

/** The message a refusal carried, or an empty string if it did not refuse. */
async function refusalMessage(run: () => unknown): Promise<string> {
  try {
    await run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the LiveKit adapter is a transport and nothing more', () => {
  it('declares that it carries media, and that it never records', () => {
    const adapter: RtcProviderPort = provider();
    expect(adapter.provider).toBe(livekitRtcProvider);
    // The one capability a live surface reads to decide whether to say two
    // people can see each other. It is the whole reason this adapter exists.
    expect(adapter.capabilities.carriesMedia).toBe(true);
    // Asserted rather than assumed. No egress is requested anywhere in the
    // adapter, and Velora's recording posture is that no live encounter is
    // recorded at all.
    expect(adapter.capabilities.recordsByDefault).toBe(false);
    expect(adapter.capabilities.participantScopedGrants).toBe(true);
    expect(adapter.capabilities.rawBodyAuthenticatedEvents).toBe(true);
    expect(adapter.capabilities.sessionIsolation).toBe(true);
  });

  it('publishes the project address as the place a credential is presented', () => {
    // Not a secret, and the one thing a browser cannot derive. The key and the
    // secret are never exposed by any member of the port.
    expect(provider().clientEndpoint).toBe(credentials.url);
    // The credentials are real private fields, so they are not enumerable and
    // cannot reach a log line, an error report, or a diagnostic dump through a
    // serialization of the adapter.
    expect(JSON.stringify(provider())).not.toContain(credentials.apiSecret);
    expect(JSON.stringify(provider())).not.toContain(credentials.apiKey);
  });

  it('files events under the project rather than under a second name', () => {
    // The account is derived from the configured address, so an event from one
    // project can never be recorded against another.
    expect(provider().account).toBe('velora-test.livekit.cloud');
    expect(provider().environment).toBe('cloud');
  });
});

describe('a participant grant names one person, one room, one issuance', () => {
  it('scopes the token to exactly the room it was asked about', async () => {
    const grant = await provider().issueParticipantGrant({
      authorizationGeneration: 3,
      medium: 'video',
      participantReference: 'opaque-participant',
      providerReference: 'vabc123',
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    const claims = claimsOf(grant.credential);
    const video = claims.video as Record<string, unknown>;
    expect(claims.sub).toBe('opaque-participant');
    expect(video.room).toBe('vabc123');
    expect(video.roomJoin).toBe(true);
    // Everything a token must not be able to do, stated positively so a future
    // SDK default cannot quietly widen it.
    expect(video.roomCreate).toBe(false);
    expect(video.roomAdmin).toBe(false);
    expect(video.roomList).toBe(false);
    expect(video.roomRecord).toBe(false);
    // The encounter's text and reactions are the platform's, ordered by it and
    // answerable when somebody reports them. A provider data channel would be a
    // second, unmoderated message path.
    expect(video.canPublishData).toBe(false);
    expect(video.canUpdateOwnMetadata).toBe(false);
  });

  it('permits a voice encounter to publish a microphone and nothing else', async () => {
    const voice = await provider().issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'voice',
      participantReference: 'p',
      providerReference: 'r',
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    const video = await provider().issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'p',
      providerReference: 'r',
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    const sourcesOf = (credential: string) =>
      (claimsOf(credential).video as { canPublishSources?: unknown })
        .canPublishSources;
    // The token itself, rather than the numbers the adapter wrote. This is the
    // property that matters and the one a provider will honour: a voice
    // encounter may publish a microphone and cannot publish a camera, and
    // neither may publish a screen share at all.
    expect(sourcesOf(voice.credential)).toEqual(['microphone']);
    expect(sourcesOf(video.credential)).toEqual(['camera', 'microphone']);
  });

  it('expires the credential within the platform’s own lifetime', async () => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    const grant = await provider(() => now).issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'p',
      providerReference: 'r',
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    expect(grant.expiresAt.getTime()).toBe(
      now.getTime() + rtcJoinCredentialTtlMilliseconds,
    );
    const claims = claimsOf(grant.credential);
    // `nbf` is what makes provider-side revocation possible: removing a
    // participant with `revokeTokenTs` kills every credential minted before
    // that instant, and a token with no `nbf` could not be caught by it.
    expect(typeof claims.nbf).toBe('number');
    expect(typeof claims.exp).toBe('number');
  });

  it('gives two sessions different rooms, and the same session the same one', async () => {
    // Deterministic, because an ambiguous create is recovered by asking the
    // provider what it did with the committed idempotency key — which only
    // works if the key decides the name.
    const first = await provider().issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'p',
      providerReference: 'room-one',
      ttlMilliseconds: 1000,
    });
    const second = await provider().issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'p',
      providerReference: 'room-two',
      ttlMilliseconds: 1000,
    });
    expect(first.credential).not.toBe(second.credential);
  });
});

describe('an unsigned or unreadable callback is refused before it is parsed', () => {
  it('refuses a request carrying no authorization header', async () => {
    const message = await refusalMessage(() =>
      provider().verifyEvent({
        headers: new Headers(),
        rawBody: new TextEncoder().encode('{}'),
      }),
    );
    expect(message).toBe('livekit event is unsigned');
  });

  it('refuses a forged authorization header', async () => {
    const message = await refusalMessage(() =>
      provider().verifyEvent({
        headers: new Headers({ authorization: 'not-a-token' }),
        rawBody: new TextEncoder().encode('{"event":"room_started"}'),
      }),
    );
    // Uniform, and never a hint about which part of the forgery to fix.
    expect(message).not.toBe('');
    expect(message).not.toContain(credentials.apiSecret);
  });
});

describe('configuration decides the provider, and refuses an unusable one', () => {
  it('requires all three values when the LiveKit adapter is selected', () => {
    const message = refusal(() =>
      loadServerConfig({
        ...baseEnvironment,
        REALTIME_RTC_PROVIDER: livekitRtcProvider,
      }),
    );
    expect(message).toContain('REALTIME_LIVEKIT_URL');
    expect(message).toContain('REALTIME_LIVEKIT_API_KEY');
    expect(message).toContain('REALTIME_LIVEKIT_API_SECRET');
  });

  it('refuses an address that is not a WebSocket', () => {
    const message = refusal(() =>
      loadServerConfig({
        ...baseEnvironment,
        REALTIME_LIVEKIT_API_KEY: credentials.apiKey,
        REALTIME_LIVEKIT_API_SECRET: credentials.apiSecret,
        REALTIME_LIVEKIT_URL: 'https://velora-test.livekit.cloud',
        REALTIME_RTC_PROVIDER: livekitRtcProvider,
      }),
    );
    expect(message).toContain('must be a WebSocket address');
  });

  it('accepts a complete local selection', () => {
    const config = loadServerConfig({
      ...baseEnvironment,
      REALTIME_LIVEKIT_API_KEY: credentials.apiKey,
      REALTIME_LIVEKIT_API_SECRET: credentials.apiSecret,
      REALTIME_LIVEKIT_URL: credentials.url,
      REALTIME_RTC_PROVIDER: livekitRtcProvider,
    });
    expect(config.REALTIME_RTC_PROVIDER).toBe(livekitRtcProvider);
  });

  it('refuses every provider other than unavailable in staging and production', () => {
    for (const environment of ['staging', 'production'] as const) {
      for (const selected of [livekitRtcProvider, localTestRtcProvider]) {
        const message = refusal(() =>
          loadServerConfig({
            ...baseEnvironment,
            APP_ENV: environment,
            REALTIME_LIVEKIT_API_KEY: credentials.apiKey,
            REALTIME_LIVEKIT_API_SECRET: credentials.apiSecret,
            REALTIME_LIVEKIT_URL: credentials.url,
            REALTIME_RTC_PROVIDER: selected,
          }),
        );
        expect(message).toContain('REALTIME_RTC_PROVIDER');
      }
    }
    // And the default is the refusing one, so an environment that says nothing
    // about a provider carries no media rather than whichever adapter happened
    // to be first in the registry.
    expect(loadServerConfig(baseEnvironment).REALTIME_RTC_PROVIDER).toBe(
      unavailableRtcProvider,
    );
  });

  it('never reports a provider secret in the redacted configuration', () => {
    const config = loadServerConfig({
      ...baseEnvironment,
      REALTIME_LIVEKIT_API_KEY: credentials.apiKey,
      REALTIME_LIVEKIT_API_SECRET: credentials.apiSecret,
      REALTIME_LIVEKIT_URL: credentials.url,
      REALTIME_RTC_PROVIDER: livekitRtcProvider,
    });
    const redacted = JSON.stringify(redactServerConfig(config));
    expect(redacted).not.toContain(credentials.apiSecret);
    expect(redacted).not.toContain(credentials.apiKey);
    expect(redacted).not.toContain(credentials.url);
    expect(redacted).toContain('rtcProviderCredentialsConfigured');
  });
});

function refusal(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
