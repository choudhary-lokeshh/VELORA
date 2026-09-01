import { describe, expect, it } from 'bun:test';

import {
  localTestRtcProvider,
  loadServerConfig,
  unavailableRtcProvider,
} from '@velora/config/server';

import { LocalTestRtcProvider } from '../../src/realtime/local-test-provider.js';
import { RtcProviderOrchestrator } from '../../src/realtime/orchestrator.js';
import {
  maximumRtcJoinCredentialTtlMilliseconds,
  rtcJoinCredentialTtlMilliseconds,
} from '../../src/realtime/policy.js';
import {
  RtcProviderCredentialsRefusedError,
  UnavailableRtcProvider,
  isRtcProviderSessionSnapshot,
  isVerifiedRtcProviderEvent,
  type RtcProviderPort,
} from '../../src/realtime/provider.js';
import type { RtcRepository } from '../../src/realtime/repository.js';

import type { SafeLogger } from '@velora/observability/server';

const baseEnvironment = {
  AUTH_BROWSER_ORIGINS_CONSUMER_WEB: 'http://127.0.0.1:3000',
  AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: 'http://127.0.0.1:3001',
  AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: 'http://127.0.0.1:3002',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:1/velora',
  EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:1/0',
  QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
};

/**
 * The message a refusal carried, or an empty string if it did not refuse.
 *
 * A boolean-returning helper rather than `expect().rejects`, which the lint
 * rules forbid here because it returns void and reads as awaitable when it is
 * not.
 */
async function refusalMessage(run: () => unknown): Promise<string> {
  try {
    await run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('no RTC provider is approved, and the default says so', () => {
  it('refuses every external operation', async () => {
    const provider: RtcProviderPort = new UnavailableRtcProvider();
    expect(provider.provider).toBe('unavailable');
    for (const attempt of [
      () =>
        provider.createSession({
          correlationId: 'c',
          medium: 'voice',
          platformSessionReference: 's',
          providerIdempotencyKey: 'k',
        }),
      () => provider.retrieveByIdempotencyKey('k'),
      () => provider.retrieveCurrentState('r'),
      () =>
        provider.issueParticipantGrant({
          authorizationGeneration: 1,
          medium: 'voice',
          participantReference: 'p',
          providerReference: 'r',
          ttlMilliseconds: 1_000,
        }),
      () =>
        provider.revokeParticipant({
          participantReference: 'p',
          providerReference: 'r',
        }),
      () => provider.endSession('r'),
      () =>
        provider.verifyEvent({
          headers: new Headers(),
          rawBody: new Uint8Array(),
        }),
    ]) {
      expect(await refusalMessage(() => attempt())).toContain(
        'No approved RTC provider is configured',
      );
    }
  });

  it('declares no capability it does not have', () => {
    const provider = new UnavailableRtcProvider();
    // Accurate rather than a placeholder: a provider that cannot do anything
    // declares nothing, so no caller can branch on a capability it lacks.
    expect(
      Object.values(provider.capabilities).every(
        (value) =>
          value === false || (Array.isArray(value) && value.length === 0),
      ),
    ).toBe(true);
  });
});

describe('the adapter in force is decided once, and not by a request', () => {
  it('defaults to unavailable', () => {
    const config = loadServerConfig({ ...baseEnvironment, APP_ENV: 'local' });
    expect(config.REALTIME_RTC_PROVIDER).toBe(unavailableRtcProvider);
    expect(config.REALTIME_CALL_ELIGIBILITY).toBe('unavailable');
  });

  it('refuses the local-test adapter in every deployed environment', () => {
    for (const environment of ['staging', 'production']) {
      expect(() =>
        loadServerConfig({
          ...baseEnvironment,
          APP_ENV: environment,
          REALTIME_RTC_PROVIDER: localTestRtcProvider,
        }),
      ).toThrow();
      expect(() =>
        loadServerConfig({
          ...baseEnvironment,
          APP_ENV: environment,
          REALTIME_CALL_ELIGIBILITY: 'composed',
        }),
      ).toThrow();
    }
  });

  it('refuses a provider name nobody registered', () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        APP_ENV: 'local',
        REALTIME_RTC_PROVIDER: 'some-vendor',
      }),
    ).toThrow();
  });
});

describe('nothing records a call', () => {
  it('declares no adapter that records by default', () => {
    for (const provider of [
      new UnavailableRtcProvider(),
      new LocalTestRtcProvider(),
    ]) {
      expect(provider.capabilities.recordsByDefault).toBe(false);
    }
  });
});

describe('a join credential is short-lived by construction', () => {
  it('never exceeds the declared ceiling', () => {
    expect(rtcJoinCredentialTtlMilliseconds).toBeLessThanOrEqual(
      maximumRtcJoinCredentialTtlMilliseconds,
    );
    // Minutes, not hours. The lifetime is the width of the window between a
    // safety decision and that decision reaching the media path.
    expect(maximumRtcJoinCredentialTtlMilliseconds).toBeLessThanOrEqual(
      600_000,
    );
  });

  it('binds a grant to one session, one participant, and one generation', async () => {
    const provider = new LocalTestRtcProvider();
    const session = await provider.createSession({
      correlationId: 'c',
      medium: 'video',
      platformSessionReference: '11111111-1111-4111-8111-111111111111',
      providerIdempotencyKey: 'key-1',
    });
    const first = await provider.issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'participant-a',
      providerReference: session.providerReference,
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    const otherParticipant = await provider.issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'video',
      participantReference: 'participant-b',
      providerReference: session.providerReference,
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });
    const laterGeneration = await provider.issueParticipantGrant({
      authorizationGeneration: 2,
      medium: 'video',
      participantReference: 'participant-a',
      providerReference: session.providerReference,
      ttlMilliseconds: rtcJoinCredentialTtlMilliseconds,
    });

    // One participant never holds another's credential, and advancing the
    // generation produces a different one — which is what makes ending a call
    // kill every credential issued under the previous generation.
    expect(first.credential).not.toBe(otherParticipant.credential);
    expect(first.credential).not.toBe(laterGeneration.credential);
  });
});

describe('an ambiguous create is answerable rather than lost', () => {
  it('does not create a second room when the first was never acknowledged', async () => {
    const provider = new LocalTestRtcProvider();
    provider.behaveAs('ambiguous-create');
    expect(
      await refusalMessage(() =>
        provider.createSession({
          correlationId: 'c',
          medium: 'voice',
          platformSessionReference: '22222222-2222-4222-8222-222222222222',
          providerIdempotencyKey: 'key-2',
        }),
      ),
    ).not.toBe('');
    expect(provider.createCallCount()).toBe(1);

    // The key was committed before the call, so the room is findable.
    const recovered = await provider.retrieveByIdempotencyKey('key-2');
    expect(recovered?.platformSessionReference).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(provider.createCallCount()).toBe(1);
  });

  it('answers nothing for a key the provider never saw', async () => {
    const provider = new LocalTestRtcProvider();
    expect(
      await provider.retrieveByIdempotencyKey('never-used'),
    ).toBeUndefined();
  });
});

describe('a refused credential is not an ambiguous create', () => {
  /**
   * The failure a mismatched API key and secret actually produce, and the
   * reason this distinction exists.
   *
   * The recovery path is right for a provider that did not answer and wrong for
   * one that answered "no": nothing was created, so there is nothing to find,
   * and the second call refuses for the same reason as the first. Asserting the
   * lookup is never made is asserting that a misconfigured deployment costs one
   * round trip per call rather than two — and, more importantly, that what an
   * operator reads names the credential rather than an unexplained pair of
   * provider failures.
   */
  it('does not ask a provider that refused us to answer a second time', async () => {
    let lookups = 0;
    const logged: string[] = [];
    const provider = {
      capabilities: { stateRetrieval: true },
      createSession: () => {
        throw new RtcProviderCredentialsRefusedError('velora.livekit.cloud');
      },
      provider: 'livekit',
      retrieveByIdempotencyKey: () => {
        lookups += 1;
        return Promise.resolve(undefined);
      },
    } as unknown as RtcProviderPort;
    const orchestrator = new RtcProviderOrchestrator({
      logger: {
        error: (_context: unknown, message: string) => logged.push(message),
        warn: (_context: unknown, message: string) => logged.push(message),
      } as unknown as SafeLogger,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
      provider,
      // Never reached: the refusal is answered before anything is written, and
      // a repository that throws is how that is stated rather than assumed.
      repository: {
        transaction: () => {
          throw new Error('no transaction may be opened for a refusal');
        },
      } as unknown as RtcRepository,
    });

    const outcome = await orchestrator.bindProviderSession({
      medium: 'video',
      providerIdempotencyKey: 'c9b1f0a4-2b2b-4c4c-9d9d-2e2e2e2e2e2e',
      sessionId: 'a3e3b3a2-0f4f-4a4a-8a4a-1c1c1c1c1c1c',
    });

    // Fail-closed, and the same outcome every unusable binding produces: the
    // call stays connecting and the join timeout closes it. A refused
    // credential is never a reason to carry the encounter on a simulated
    // transport instead.
    expect(outcome.kind).toBe('unresolved');
    expect(lookups).toBe(0);
    expect(logged).toEqual(['rtc provider refused the configured credentials']);
  });

  it('still recovers a create that genuinely went unanswered', async () => {
    let lookups = 0;
    const provider = {
      capabilities: { stateRetrieval: true },
      createSession: () => {
        throw new Error('socket hang up');
      },
      provider: 'livekit',
      retrieveByIdempotencyKey: () => {
        lookups += 1;
        return Promise.resolve(undefined);
      },
    } as unknown as RtcProviderPort;
    const orchestrator = new RtcProviderOrchestrator({
      logger: {
        error: () => undefined,
        warn: () => undefined,
      } as unknown as SafeLogger,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
      provider,
      repository: {} as unknown as RtcRepository,
    });

    const outcome = await orchestrator.bindProviderSession({
      medium: 'video',
      providerIdempotencyKey: 'c9b1f0a4-2b2b-4c4c-9d9d-2e2e2e2e2e2e',
      sessionId: 'a3e3b3a2-0f4f-4a4a-8a4a-1c1c1c1c1c1c',
    });

    expect(outcome.kind).toBe('unresolved');
    expect(lookups).toBe(1);
  });
});

describe('a provider event authenticates the exact bytes it arrived as', () => {
  it('refuses an unsigned event', async () => {
    const provider = new LocalTestRtcProvider();
    expect(
      await refusalMessage(() =>
        provider.verifyEvent({
          headers: new Headers(),
          rawBody: new TextEncoder().encode('{}'),
        }),
      ),
    ).toContain('unsigned');
  });

  it('refuses a body mutated after it was signed', async () => {
    const provider = new LocalTestRtcProvider();
    const original = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'e1',
        eventType: 'session.live',
        providerReference: 'r',
        state: 'live',
      }),
    );
    const signature = LocalTestRtcProvider.sign(original);
    const mutated = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'e1',
        eventType: 'session.live',
        providerReference: 'somebody-elses-room',
        state: 'live',
      }),
    );
    expect(
      await refusalMessage(() =>
        provider.verifyEvent({
          headers: new Headers({ 'x-velora-rtc-test-signature': signature }),
          rawBody: mutated,
        }),
      ),
    ).toContain('signature');
  });

  it('accepts the exact bytes and normalizes what it read', async () => {
    const provider = new LocalTestRtcProvider();
    const session = await provider.createSession({
      correlationId: 'c',
      medium: 'voice',
      platformSessionReference: '55555555-5555-4555-8555-555555555555',
      providerIdempotencyKey: 'key-5',
    });
    const body = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'e2',
        eventType: 'session.live',
        providerReference: session.providerReference,
        state: 'live',
      }),
    );
    const event = await provider.verifyEvent({
      headers: new Headers({
        'x-velora-rtc-test-signature': LocalTestRtcProvider.sign(body),
      }),
      rawBody: body,
    });
    expect(event.eventId).toBe('e2');
    expect(event.snapshot.state).toBe('live');
    // Normalized into this domain's vocabulary rather than the vendor's, and
    // bound back to the platform session it is about.
    expect(event.snapshot.platformSessionReference).toBe(
      '55555555-5555-4555-8555-555555555555',
    );
    expect(isVerifiedRtcProviderEvent(event)).toBe(true);
  });

  it('produces nothing bindable for a room the platform never created', async () => {
    const provider = new LocalTestRtcProvider();
    const body = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'e3',
        eventType: 'session.live',
        providerReference: 'a-room-nobody-here-made',
        state: 'live',
      }),
    );
    const event = await provider.verifyEvent({
      headers: new Headers({
        'x-velora-rtc-test-signature': LocalTestRtcProvider.sign(body),
      }),
      rawBody: body,
    });
    // The signature is genuine and the event still carries no platform session,
    // so the guard refuses it. A correctly signed event from the wrong account,
    // the wrong environment, or a replayed room cannot bind to anything here —
    // which is the fail-closed behaviour the inbox depends on.
    expect(event.snapshot.platformSessionReference).toBe('');
    expect(isVerifiedRtcProviderEvent(event)).toBe(false);
  });
});

describe('provider output is validated rather than trusted', () => {
  it('refuses a snapshot that is not one', () => {
    for (const value of [
      undefined,
      null,
      {},
      { platformSessionReference: '', providerReference: 'r', state: 'live' },
      { platformSessionReference: 's', providerReference: '', state: 'live' },
      {
        platformSessionReference: 's',
        providerReference: 'r',
        state: 'whatever',
      },
      {
        platformSessionReference: 's',
        providerReference: 'r'.repeat(500),
        state: 'live',
      },
    ]) {
      expect(isRtcProviderSessionSnapshot(value)).toBe(false);
    }
  });

  it('refuses an event that is not one', () => {
    expect(isVerifiedRtcProviderEvent({ eventId: 'e' })).toBe(false);
    expect(
      isVerifiedRtcProviderEvent({
        eventId: 'e',
        eventType: 't',
        occurredAt: new Date('nope'),
        snapshot: {
          platformSessionReference: 's',
          providerReference: 'r',
          state: 'live',
        },
      }),
    ).toBe(false);
  });
});

describe('termination is an instruction the provider may ignore', () => {
  it('leaves the room live when the provider does not act', async () => {
    const provider = new LocalTestRtcProvider();
    const session = await provider.createSession({
      correlationId: 'c',
      medium: 'voice',
      platformSessionReference: '33333333-3333-4333-8333-333333333333',
      providerIdempotencyKey: 'key-3',
    });
    provider.behaveAs('ignores-termination');
    await provider.endSession(session.providerReference);
    // The divergence reconciliation exists to find, produced rather than
    // simulated: the platform believes the call is over and the provider does
    // not.
    expect(provider.liveSessionCount()).toBe(1);
  });

  it('records a revocation the provider was told about', async () => {
    const provider = new LocalTestRtcProvider();
    const session = await provider.createSession({
      correlationId: 'c',
      medium: 'voice',
      platformSessionReference: '44444444-4444-4444-8444-444444444444',
      providerIdempotencyKey: 'key-4',
    });
    await provider.revokeParticipant({
      participantReference: 'participant-a',
      providerReference: session.providerReference,
    });
    expect(
      provider.isParticipantRevoked({
        participantReference: 'participant-a',
        providerReference: session.providerReference,
      }),
    ).toBe(true);
    expect(
      provider.isParticipantRevoked({
        participantReference: 'participant-b',
        providerReference: session.providerReference,
      }),
    ).toBe(false);
  });
});
