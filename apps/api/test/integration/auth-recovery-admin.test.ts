import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { Ed25519AccessTokenAuthority } from '../../src/auth/access-token.js';
import {
  AuthorizationError,
  requireAudience,
  requireAssurance,
} from '../../src/auth/context.js';
import {
  LocalIdentityProvider,
  UnavailablePrivilegedAuthenticatorVerifier,
} from '../../src/auth/identity-provider.js';
import {
  highImpactCooldownMilliseconds,
  recoveryRateLimits,
  recoveryTokenLifetimeMilliseconds,
  stepUpAssuranceMaximumAgeMilliseconds,
} from '../../src/auth/policy.js';
import {
  bindHighImpactAction,
  PrivilegedAccessService,
  requiredProductionAuthenticators,
} from '../../src/auth/privileged.js';
import {
  LocalTestRecoveryDelivery,
  RecoveryService,
} from '../../src/auth/recovery.js';
import { AuthRepository } from '../../src/auth/repository.js';
import { AuthService } from '../../src/auth/service.js';
import {
  ScriptedAuthenticatorVerifier,
  scriptedAuthenticatorData,
} from '../support/authenticator.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger } from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_auth_privileged');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new AuthRepository(database.drizzle);
const clock = { current: new Date('2026-08-14T10:00:00.000Z') };
const now = () => clock.current;

const authService = new AuthService({
  accessTokenSigner: Ed25519AccessTokenAuthority.withGeneratedKey(
    'https://auth.velora.invalid',
  ),
  identityProvider: new LocalIdentityProvider(),
  now,
  repository,
});

function recoveryService(delivery = new LocalTestRecoveryDelivery()) {
  const identityProvider = new LocalIdentityProvider();
  return {
    delivery,
    service: new RecoveryService({
      authService,
      delivery,
      identitySubjectFor: (subject) =>
        identityProvider.assert(subject).providerSubject,
      logger: silentLogger(),
      now,
      repository,
    }),
  };
}

function privileged(verifier = new ScriptedAuthenticatorVerifier()) {
  return {
    service: new PrivilegedAccessService({ now, repository, verifier }),
    verifier,
  };
}

async function signedInAccount(subject: string, device = 'device-known') {
  const issued = await authService.authenticateBrowser({
    audience: 'consumer_web',
    correlationId: 'setup',
    deviceReference: device,
    subject,
  });
  return issued;
}

/** Creates a Platform Admin session directly, which no adapter can mint. */
async function adminSession(
  accountId: string,
  assurance: 'phishing_resistant' | 'single_factor' = 'phishing_resistant',
) {
  const id = crypto.randomUUID();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${id}, ${accountId}, 'platform_admin', ${assurance}, ${clock.current},
      ${clock.current}, ${clock.current}, ${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')},
      ${new Date(clock.current.getTime() + 900_000)}, ${clock.current},
      ${new Date(clock.current.getTime() + 28_800_000)},
      ${crypto.randomUUID().replaceAll('-', '').padEnd(64, '1')}
    )
  `);
  return id;
}

function adminContext(
  accountId: string,
  sessionId: string,
  assurance = 'phishing_resistant',
) {
  return {
    absoluteExpiresAt: new Date(clock.current.getTime() + 28_800_000),
    accountId,
    assurance: assurance as 'phishing_resistant' | 'single_factor',
    assuranceEstablishedAt: clock.current,
    audience: 'platform_admin' as const,
    authenticatedAt: clock.current,
    idleExpiresAt: new Date(clock.current.getTime() + 900_000),
    sessionId,
    transport: 'cookie' as const,
  };
}

beforeEach(async () => {
  clock.current = new Date('2026-08-14T10:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('account recovery', () => {
  it('answers identically for a known subject, an unknown one, and a malformed one', async () => {
    const { service } = recoveryService();
    await signedInAccount('known@velora.test');

    for (const subject of [
      'known@velora.test',
      'nobody@velora.test',
      'not a subject',
    ]) {
      expect(
        (
          await service.start({
            correlationId: 'enumeration',
            requesterReference: `requester-${subject}`,
            subject,
          })
        ).kind,
      ).toBe('accepted');
    }
  });

  it('stores only a digest of the recovery token and its destination', async () => {
    const { delivery, service } = recoveryService();
    await signedInAccount('digest@velora.test', 'device-digest');
    await service.start({
      correlationId: 'recovery-digest',
      deviceReference: 'device-digest',
      requesterReference: 'requester-digest',
      subject: 'digest@velora.test',
    });

    const issued = delivery.latestFor('digest@velora.test');
    expect(issued).toBeDefined();
    const rows = await rowsOf<{
      destination_digest: string;
      token_digest: string;
    }>(
      database.sql`select token_digest, destination_digest from auth_recovery_requests`,
    );
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(issued?.token ?? 'unreachable');
    expect(serialised).not.toContain('digest@velora.test');
    expect(rows[0]?.token_digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('completes from a known device, revoking every prior authority', async () => {
    const { delivery, service } = recoveryService();
    const web = await signedInAccount('recover@velora.test', 'device-recover');
    const mobile = await authService.authenticateMobile({
      correlationId: 'setup',
      deviceReference: 'device-recover',
      installationId: 'installation-recovery',
      subject: 'recover@velora.test',
    });

    await service.start({
      correlationId: 'recovery',
      deviceReference: 'device-recover',
      requesterReference: 'requester-recover',
      subject: 'recover@velora.test',
    });
    const issued = delivery.latestFor('recover@velora.test');
    expect(issued).toBeDefined();

    const completed = await service.complete({
      correlationId: 'recovery',
      deviceReference: 'device-recover',
      requesterReference: 'requester-recover',
      token: issued?.token ?? '',
    });
    expect(completed.kind).toBe('completed');
    if (completed.kind !== 'completed') return;

    expect(
      (await authService.resolveBrowserSession(web.sessionToken)).kind,
    ).toBe('rejected');
    expect(
      await authService.resolveAccessToken(mobile.accessToken),
    ).toBeUndefined();
    // Recovery grants ordinary access, never the highest assurance.
    expect(completed.session.context.assurance).toBe('single_factor');
    expect(
      (await authService.resolveBrowserSession(completed.session.sessionToken))
        .kind,
    ).toBe('active');
  });

  it('applies the post-recovery high-impact restriction', async () => {
    const { delivery, service } = recoveryService();
    const web = await signedInAccount(
      'cooldown@velora.test',
      'device-cooldown',
    );
    await service.start({
      correlationId: 'cooldown',
      deviceReference: 'device-cooldown',
      requesterReference: 'requester-cooldown',
      subject: 'cooldown@velora.test',
    });
    await service.complete({
      correlationId: 'cooldown',
      deviceReference: 'device-cooldown',
      requesterReference: 'requester-cooldown',
      token: delivery.latestFor('cooldown@velora.test')?.token ?? '',
    });

    expect(
      await service.isHighImpactRestricted({
        accountId: web.context.accountId,
      }),
    ).toBe(true);
    clock.current = new Date(
      clock.current.getTime() + highImpactCooldownMilliseconds + 1_000,
    );
    expect(
      await service.isHighImpactRestricted({
        accountId: web.context.accountId,
      }),
    ).toBe(false);
  });

  it('refuses recovery from a device that never authenticated', async () => {
    const { delivery, service } = recoveryService();
    await signedInAccount('risky@velora.test', 'device-enrolled');
    await service.start({
      correlationId: 'high-risk',
      deviceReference: 'device-never-seen',
      requesterReference: 'requester-risky',
      subject: 'risky@velora.test',
    });
    const outcome = await service.complete({
      correlationId: 'high-risk',
      deviceReference: 'device-never-seen',
      requesterReference: 'requester-risky',
      token: delivery.latestFor('risky@velora.test')?.token ?? '',
    });
    expect(outcome.kind).toBe('review_required');

    const events = await rowsOf<{ event_type: string; reason: string | null }>(
      database.sql`select event_type, reason from auth_security_events order by id`,
    );
    expect(events.map((event) => event.event_type)).toContain(
      'recovery_rejected',
    );
  });

  it('refuses recovery when the caller supplies no device reference at all', async () => {
    const { delivery, service } = recoveryService();
    await signedInAccount('nodevice@velora.test', 'device-enrolled');
    await service.start({
      correlationId: 'no-device',
      requesterReference: 'requester-nodevice',
      subject: 'nodevice@velora.test',
    });
    expect(
      (
        await service.complete({
          correlationId: 'no-device',
          requesterReference: 'requester-nodevice',
          token: delivery.latestFor('nodevice@velora.test')?.token ?? '',
        })
      ).kind,
    ).toBe('review_required');
  });

  it('refuses an expired, consumed, or unknown recovery token identically', async () => {
    const { delivery, service } = recoveryService();
    await signedInAccount('tokens@velora.test', 'device-tokens');

    await service.start({
      correlationId: 'expiry',
      deviceReference: 'device-tokens',
      requesterReference: 'requester-tokens-1',
      subject: 'tokens@velora.test',
    });
    const expiring = delivery.latestFor('tokens@velora.test')?.token ?? '';
    clock.current = new Date(
      clock.current.getTime() + recoveryTokenLifetimeMilliseconds + 1_000,
    );
    expect(
      (
        await service.complete({
          correlationId: 'expiry',
          deviceReference: 'device-tokens',
          requesterReference: 'requester-tokens-1',
          token: expiring,
        })
      ).kind,
    ).toBe('invalid');

    await service.start({
      correlationId: 'consumed',
      deviceReference: 'device-tokens',
      requesterReference: 'requester-tokens-2',
      subject: 'tokens@velora.test',
    });
    const consumed = delivery.latestFor('tokens@velora.test')?.token ?? '';
    expect(
      (
        await service.complete({
          correlationId: 'consumed',
          deviceReference: 'device-tokens',
          requesterReference: 'requester-tokens-2',
          token: consumed,
        })
      ).kind,
    ).toBe('completed');
    expect(
      (
        await service.complete({
          correlationId: 'consumed',
          deviceReference: 'device-tokens',
          requesterReference: 'requester-tokens-3',
          token: consumed,
        })
      ).kind,
    ).toBe('invalid');
    expect(
      (
        await service.complete({
          correlationId: 'unknown',
          deviceReference: 'device-tokens',
          requesterReference: 'requester-tokens-4',
          token: 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        })
      ).kind,
    ).toBe('invalid');
  });

  it('lets exactly one of many simultaneous consumptions succeed', async () => {
    const { delivery, service } = recoveryService();
    for (let round = 0; round < 10; round += 1) {
      await database.truncate();
      const subject = `race-${String(round)}@velora.test`;
      await signedInAccount(subject, 'device-race');
      await service.start({
        correlationId: `race-${String(round)}`,
        deviceReference: 'device-race',
        requesterReference: `requester-race-${String(round)}`,
        subject,
      });
      const token = delivery.latestFor(subject)?.token ?? '';

      const outcomes = await Promise.all(
        Array.from({ length: 8 }, async (_, index) =>
          service.complete({
            correlationId: `race-${String(round)}-${String(index)}`,
            deviceReference: 'device-race',
            requesterReference: `requester-race-${String(round)}-${String(index)}`,
            token,
          }),
        ),
      );
      expect(
        outcomes.filter((outcome) => outcome.kind === 'completed').length,
      ).toBe(1);
      expect(
        outcomes.filter((outcome) => outcome.kind === 'invalid').length,
      ).toBe(7);
    }
  }, 120_000);

  it('stops issuing recovery tokens once the account limit is reached', async () => {
    const { delivery, service } = recoveryService();
    await signedInAccount('limits@velora.test', 'device-limits');

    for (
      let attempt = 0;
      attempt < recoveryRateLimits.perAccountPerHour + 2;
      attempt += 1
    ) {
      const outcome = await service.start({
        correlationId: `limit-${String(attempt)}`,
        deviceReference: 'device-limits',
        requesterReference: `requester-limit-${String(attempt)}`,
        subject: 'limits@velora.test',
      });
      // The answer never changes, whether or not a token was issued.
      expect(outcome.kind).toBe('accepted');
    }

    const issued = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_recovery_requests`,
    );
    expect(issued[0]?.total).toBe(recoveryRateLimits.perAccountPerHour);
    expect(delivery.deliveries.length).toBe(
      recoveryRateLimits.perAccountPerHour,
    );
  });

  it('reports a caller-scoped limit, which discloses nothing about an account', async () => {
    const { service } = recoveryService();
    let limited = 0;
    for (
      let attempt = 0;
      attempt < recoveryRateLimits.perRequesterPerHour + 3;
      attempt += 1
    ) {
      const outcome = await service.start({
        correlationId: `requester-${String(attempt)}`,
        requesterReference: 'one-noisy-requester',
        subject: `probe-${String(attempt)}@velora.test`,
      });
      if (outcome.kind === 'rate_limited') limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('Platform Admin audience isolation', () => {
  it('never lets a consumer or creator session satisfy Admin authority', async () => {
    const consumer = await signedInAccount('isolation@velora.test');
    const creator = await authService.authenticateBrowser({
      audience: 'creator_studio',
      correlationId: 'isolation',
      subject: 'isolation@velora.test',
    });
    const mobile = await authService.authenticateMobile({
      correlationId: 'isolation',
      installationId: 'installation-isolation',
      subject: 'isolation@velora.test',
    });

    for (const context of [consumer.context, creator.context, mobile.context]) {
      expect(() => requireAudience(context, ['platform_admin'])).toThrow();
      // Even claiming the Admin audience does not help: the audience floor is
      // phishing-resistant assurance, which no adapter can produce.
      expect(() =>
        requireAssurance(
          { ...context, audience: 'platform_admin' },
          'single_factor',
        ),
      ).toThrow();
    }
  });

  it('has no adapter that can create a Platform Admin session', async () => {
    await signedInAccount('no-admin@velora.test');
    const sessions = await rowsOf<{ audience: string }>(
      database.sql`select distinct audience from auth_sessions`,
    );
    expect(sessions.map((row) => row.audience)).not.toContain('platform_admin');
  });
});

describe('privileged step-up assurance', () => {
  it('cannot succeed with the verifier the application actually configures', async () => {
    const service = new PrivilegedAccessService({
      now,
      repository,
      verifier: new UnavailablePrivilegedAuthenticatorVerifier(),
    });
    const account = await signedInAccount('stepup-unavailable@velora.test');
    const sessionId = await adminSession(account.context.accountId);
    await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'unavailable',
      credentialId: 'credential-unavailable',
      label: 'security key',
      publicKey: 'public-key',
    });

    const outcome = await service.stepUp({
      assertion: {
        authenticatorData: scriptedAuthenticatorData(1),
        clientDataJSON: 'e30',
        credentialId: 'credential-unavailable',
        signature: 'signature',
      },
      challenge: 'challenge',
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'unavailable',
    });
    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'verification_failed',
    });
  });

  it('refuses a consumer session even with a valid assertion', async () => {
    const { service } = privileged();
    const account = await signedInAccount('stepup-consumer@velora.test');
    await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'consumer-stepup',
      credentialId: 'credential-consumer',
      label: 'security key',
      publicKey: 'public-key',
    });

    const outcome = await service.stepUp({
      assertion: {
        authenticatorData: scriptedAuthenticatorData(1),
        clientDataJSON: 'e30',
        credentialId: 'credential-consumer',
        signature: 'signature',
      },
      challenge: 'challenge',
      context: account.context,
      correlationId: 'consumer-stepup',
    });
    expect(outcome).toEqual({ kind: 'rejected', reason: 'audience_rejected' });
  });

  it('refuses a revoked or unknown authenticator', async () => {
    const { service } = privileged();
    const account = await signedInAccount('stepup-revoked@velora.test');
    const sessionId = await adminSession(account.context.accountId);
    const authenticatorId = await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'revoked',
      credentialId: 'credential-revoked',
      label: 'security key',
      publicKey: 'public-key',
    });
    await service.revokeAuthenticator({
      authenticatorId,
      correlationId: 'revoked',
      reason: 'lost',
    });

    for (const credentialId of ['credential-revoked', 'credential-unknown']) {
      expect(
        await service.stepUp({
          assertion: {
            authenticatorData: scriptedAuthenticatorData(5),
            clientDataJSON: 'e30',
            credentialId,
            signature: 'signature',
          },
          challenge: 'challenge',
          context: adminContext(account.context.accountId, sessionId),
          correlationId: 'revoked',
        }),
      ).toEqual({ kind: 'rejected', reason: 'no_authenticator' });
    }
  });

  it('refuses a replayed assertion whose signature counter did not advance', async () => {
    const { service } = privileged();
    const account = await signedInAccount('stepup-replay@velora.test');
    const sessionId = await adminSession(account.context.accountId);
    await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'replay',
      credentialId: 'credential-replay',
      label: 'security key',
      publicKey: 'public-key',
    });
    const assertion = {
      authenticatorData: scriptedAuthenticatorData(7),
      clientDataJSON: 'e30',
      credentialId: 'credential-replay',
      signature: 'signature',
    };

    expect(
      (
        await service.stepUp({
          assertion,
          challenge: 'challenge',
          context: adminContext(account.context.accountId, sessionId),
          correlationId: 'replay',
        })
      ).kind,
    ).toBe('succeeded');
    expect(
      await service.stepUp({
        assertion,
        challenge: 'challenge',
        context: adminContext(account.context.accountId, sessionId),
        correlationId: 'replay',
      }),
    ).toEqual({ kind: 'rejected', reason: 'verification_failed' });
  });

  it('accepts a passkey that keeps no signature counter', async () => {
    // Most multi-device passkeys report zero forever. Demanding an advancing
    // counter would rule out exactly the phishing-resistant authenticators
    // ADR-0017 requires.
    const { service } = privileged(
      new ScriptedAuthenticatorVerifier(() => true, false),
    );
    const account = await signedInAccount('passkey@velora.test');
    const sessionId = await adminSession(account.context.accountId);
    await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'passkey',
      credentialId: 'credential-passkey',
      label: 'platform passkey',
      publicKey: 'public-key',
    });
    const assertion = {
      authenticatorData: scriptedAuthenticatorData(0),
      clientDataJSON: 'e30',
      credentialId: 'credential-passkey',
      signature: 'signature',
    };

    for (const attempt of [1, 2]) {
      expect(
        (
          await service.stepUp({
            assertion,
            challenge: `challenge-${String(attempt)}`,
            context: adminContext(account.context.accountId, sessionId),
            correlationId: 'passkey',
          })
        ).kind,
        `attempt ${String(attempt)}`,
      ).toBe('succeeded');
    }

    const stored = await rowsOf<{ sign_count: number }>(
      database.sql`select sign_count from auth_admin_authenticators where credential_id = 'credential-passkey'`,
    );
    expect(stored[0]?.sign_count).toBe(0);
  });

  it('reports production readiness only with two independently stored authenticators', async () => {
    const { service } = privileged();
    const account = await signedInAccount('readiness@velora.test');
    expect(
      await service.productionReadiness(account.context.accountId),
    ).toEqual({ enrolled: 0, ready: false });

    for (let index = 0; index < requiredProductionAuthenticators; index += 1) {
      await service.enrolAuthenticator({
        context: adminContext(account.context.accountId, 'enrolment'),
        correlationId: 'readiness',
        credentialId: `credential-${String(index)}`,
        label: `security key ${String(index)}`,
        publicKey: 'public-key',
      });
    }
    expect(
      await service.productionReadiness(account.context.accountId),
    ).toEqual({ enrolled: requiredProductionAuthenticators, ready: true });
  });
});

/**
 * Restart audit A2. A first authenticator is how an operator reaches
 * phishing-resistant assurance, so it needs only the session. Every later one
 * needs fresh phishing-resistant assurance; otherwise whoever held only an
 * operator's first factor could enrol a key of their own and step up with it.
 */
describe('privileged authenticator enrolment', () => {
  const key = (index: number) => ({
    correlationId: `enrolment-${String(index)}`,
    credentialId: `credential-enrolment-${String(index)}`,
    label: `security key ${String(index)}`,
    publicKey: 'public-key',
  });

  async function heldKeys(accountId: string): Promise<number> {
    const rows = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_admin_authenticators where account_id = ${accountId} and revoked_at is null`,
    );
    return rows[0]?.total ?? 0;
  }

  it('enrols a first key on a single-factor session', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-first@velora.test');
    await service.enrolAuthenticator({
      ...key(0),
      context: adminContext(
        account.context.accountId,
        'first',
        'single_factor',
      ),
    });
    expect(await heldKeys(account.context.accountId)).toBe(1);
  });

  it('refuses a second key from a session holding only the first factor', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-second@velora.test');
    const firstFactor = adminContext(
      account.context.accountId,
      'second',
      'single_factor',
    );
    await service.enrolAuthenticator({ ...key(0), context: firstFactor });

    const refusal = await service
      .enrolAuthenticator({ ...key(1), context: firstFactor })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(AuthorizationError);
    expect(await heldKeys(account.context.accountId)).toBe(1);
  });

  it('refuses a second key once the step-up has aged past the window', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-stale@velora.test');
    const stepped = adminContext(account.context.accountId, 'stale');
    await service.enrolAuthenticator({ ...key(0), context: stepped });

    clock.current = new Date(
      clock.current.getTime() + stepUpAssuranceMaximumAgeMilliseconds + 1_000,
    );
    const refusal = await service
      .enrolAuthenticator({ ...key(1), context: stepped })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(AuthorizationError);
    expect(await heldKeys(account.context.accountId)).toBe(1);
  });

  it('enrols a second key after a fresh step-up', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-fresh@velora.test');
    const stepped = adminContext(account.context.accountId, 'fresh');
    await service.enrolAuthenticator({ ...key(0), context: stepped });
    await service.enrolAuthenticator({ ...key(1), context: stepped });
    expect(await heldKeys(account.context.accountId)).toBe(2);
  });

  it('lets only one of two concurrent first keys through on a first factor', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-race@velora.test');
    const firstFactor = adminContext(
      account.context.accountId,
      'race',
      'single_factor',
    );
    const outcomes = await Promise.allSettled([
      service.enrolAuthenticator({ ...key(0), context: firstFactor }),
      service.enrolAuthenticator({ ...key(1), context: firstFactor }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(
      refused?.status === 'rejected' ? refused.reason : undefined,
    ).toBeInstanceOf(AuthorizationError);
    expect(await heldKeys(account.context.accountId)).toBe(1);
  });

  it('treats an account whose keys were all revoked as keyless again', async () => {
    const { service } = privileged();
    const account = await signedInAccount('enrol-revoked@velora.test');
    const firstFactor = adminContext(
      account.context.accountId,
      'revoked',
      'single_factor',
    );
    const authenticatorId = await service.enrolAuthenticator({
      ...key(0),
      context: firstFactor,
    });
    await service.revokeAuthenticator({
      authenticatorId,
      correlationId: 'revoked',
      reason: 'lost',
    });

    await service.enrolAuthenticator({ ...key(1), context: firstFactor });
    expect(await heldKeys(account.context.accountId)).toBe(1);
  });
});

describe('exact-action authorization for high-impact operations', () => {
  async function privilegedActor(subject: string) {
    const { service } = privileged();
    const account = await signedInAccount(subject);
    const sessionId = await adminSession(account.context.accountId);
    await service.enrolAuthenticator({
      context: adminContext(account.context.accountId, 'enrolment'),
      correlationId: 'setup',
      credentialId: `credential-${subject}`,
      label: 'security key',
      publicKey: 'public-key',
    });
    await service.stepUp({
      assertion: {
        authenticatorData: scriptedAuthenticatorData(1),
        clientDataJSON: 'e30',
        credentialId: `credential-${subject}`,
        signature: 'signature',
      },
      challenge: 'challenge',
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'setup',
    });
    return { account, service, sessionId };
  }

  const binding = bindHighImpactAction({
    argumentsValue: { reason: 'policy breach', scope: 'account' },
    beforeState: { status: 'active' },
    expectedEffect: { status: 'suspended' },
    operation: 'enforcement.suspend_account',
    targetId: 'target-account',
    targetType: 'account',
  });

  it('authorizes and executes exactly one bound action', async () => {
    const { account, service, sessionId } =
      await privilegedActor('bind@velora.test');
    const authorized = await service.authorizeHighImpact({
      binding,
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'bind',
      validForMilliseconds: 60_000,
    });
    expect(authorized.kind).toBe('authorized');
    if (authorized.kind !== 'authorized') return;

    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'bind',
        context: adminContext(account.context.accountId, sessionId),
        currentStateDigest: binding.beforeStateDigest,
      }),
    ).toEqual({ kind: 'executed' });

    // Single use.
    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'bind',
        context: adminContext(account.context.accountId, sessionId),
        currentStateDigest: binding.beforeStateDigest,
      }),
    ).toEqual({ kind: 'rejected', reason: 'already_consumed' });
  });

  it('refuses an authorization used for a different target, argument, or effect', async () => {
    const { account, service, sessionId } = await privilegedActor(
      'mismatch@velora.test',
    );
    const authorized = await service.authorizeHighImpact({
      binding,
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'mismatch',
      validForMilliseconds: 60_000,
    });
    if (authorized.kind !== 'authorized') return;

    for (const altered of [
      { ...binding, targetId: 'another-account' },
      { ...binding, argumentDigest: 'f'.repeat(64) },
      { ...binding, expectedEffectDigest: 'e'.repeat(64) },
      { ...binding, operation: 'enforcement.delete_account' },
    ]) {
      expect(
        await service.executeHighImpact({
          authorizationId: authorized.authorizationId,
          binding: altered,
          correlationId: 'mismatch',
          context: adminContext(account.context.accountId, sessionId),
          currentStateDigest: binding.beforeStateDigest,
        }),
      ).toEqual({ kind: 'rejected', reason: 'state_changed' });
    }
  });

  it('refuses execution when the target state moved after authorization', async () => {
    const { account, service, sessionId } =
      await privilegedActor('drift@velora.test');
    const authorized = await service.authorizeHighImpact({
      binding,
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'drift',
      validForMilliseconds: 60_000,
    });
    if (authorized.kind !== 'authorized') return;

    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'drift',
        context: adminContext(account.context.accountId, sessionId),
        currentStateDigest: bindHighImpactAction({
          argumentsValue: {},
          beforeState: { status: 'restricted' },
          expectedEffect: {},
          operation: 'x',
          targetId: 'y',
          targetType: 'z',
        }).beforeStateDigest,
      }),
    ).toEqual({ kind: 'rejected', reason: 'state_changed' });
  });

  it('refuses execution once assurance is no longer fresh', async () => {
    const { account, service, sessionId } =
      await privilegedActor('stale@velora.test');
    const authorized = await service.authorizeHighImpact({
      binding,
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'stale',
      validForMilliseconds: stepUpAssuranceMaximumAgeMilliseconds * 10,
    });
    if (authorized.kind !== 'authorized') return;

    clock.current = new Date(
      clock.current.getTime() + stepUpAssuranceMaximumAgeMilliseconds + 1_000,
    );
    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'stale',
        context: adminContext(account.context.accountId, sessionId),
        currentStateDigest: binding.beforeStateDigest,
      }),
    ).toEqual({ kind: 'rejected', reason: 'assurance_stale' });
  });

  it('refuses execution once the actor session is revoked', async () => {
    const { account, service, sessionId } = await privilegedActor(
      'revoked-session@velora.test',
    );
    const authorized = await service.authorizeHighImpact({
      binding,
      context: adminContext(account.context.accountId, sessionId),
      correlationId: 'revoked-session',
      validForMilliseconds: 60_000,
    });
    if (authorized.kind !== 'authorized') return;

    await repository.revokeSession(repository.transactionless, {
      now: clock.current,
      reason: 'administrative',
      sessionId,
    });
    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'revoked-session',
        context: adminContext(account.context.accountId, sessionId),
        currentStateDigest: binding.beforeStateDigest,
      }),
    ).toEqual({ kind: 'rejected', reason: 'session_ended' });
  });

  it('refuses a stale authorization and a stale-assurance authorization request', async () => {
    const { account, service, sessionId } =
      await privilegedActor('expiry@velora.test');
    // Captured while assurance is fresh. The server derives the real context
    // from the stored session, so a caller cannot refresh assurance simply by
    // rebuilding the object it sends.
    const context = adminContext(account.context.accountId, sessionId);
    const authorized = await service.authorizeHighImpact({
      binding,
      context,
      correlationId: 'expiry',
      validForMilliseconds: 1_000,
    });
    if (authorized.kind !== 'authorized') return;
    clock.current = new Date(clock.current.getTime() + 5_000);
    expect(
      await service.executeHighImpact({
        authorizationId: authorized.authorizationId,
        binding,
        correlationId: 'expiry',
        context,
        currentStateDigest: binding.beforeStateDigest,
      }),
    ).toEqual({ kind: 'rejected', reason: 'expired' });

    clock.current = new Date(
      clock.current.getTime() + stepUpAssuranceMaximumAgeMilliseconds,
    );
    expect(
      await service.authorizeHighImpact({
        binding,
        context,
        correlationId: 'expiry',
        validForMilliseconds: 60_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'assurance_stale' });
  });

  it('refuses to authorize with a consumer audience or ordinary stored assurance', async () => {
    const { service } = privileged();
    const account = await signedInAccount('weak@velora.test');
    // The stored session carries ordinary assurance. The caller claims the
    // strongest level, and the claim is ignored.
    const sessionId = await adminSession(
      account.context.accountId,
      'single_factor',
    );

    expect(
      await service.authorizeHighImpact({
        binding,
        context: account.context,
        correlationId: 'weak',
        validForMilliseconds: 60_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'audience_rejected' });

    expect(
      await service.authorizeHighImpact({
        binding,
        context: adminContext(account.context.accountId, sessionId),
        correlationId: 'weak',
        validForMilliseconds: 60_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'assurance_insufficient' });
  });

  it('refuses to authorize inside the post-recovery restriction', async () => {
    const { delivery, service: recovery } = recoveryService();
    const { account, service, sessionId } = await privilegedActor(
      'restricted@velora.test',
    );
    await repository.rememberDevice(repository.transactionless, {
      accountId: account.context.accountId,
      deviceDigest: 'c'.repeat(64),
      now: clock.current,
    });
    await recovery.start({
      correlationId: 'restricted',
      deviceReference: 'device-known',
      requesterReference: 'requester-restricted',
      subject: 'restricted@velora.test',
    });
    await recovery.complete({
      correlationId: 'restricted',
      deviceReference: 'device-known',
      requesterReference: 'requester-restricted',
      token: delivery.latestFor('restricted@velora.test')?.token ?? '',
    });

    expect(
      await service.authorizeHighImpact({
        binding,
        context: adminContext(account.context.accountId, sessionId),
        correlationId: 'restricted',
        validForMilliseconds: 60_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'cooldown_active' });
  });
});

describe('privileged recovery dual control', () => {
  async function scenario(prefix: string) {
    const { service } = privileged();
    const target = await signedInAccount(`${prefix}-target@velora.test`);
    const first = await signedInAccount(`${prefix}-owner1@velora.test`);
    const second = await signedInAccount(`${prefix}-owner2@velora.test`);
    await service.designateSecurityOwner(first.context.accountId);
    await service.designateSecurityOwner(second.context.accountId);
    const requestId = await service.startPrivilegedRecovery({
      correlationId: prefix,
      initiatedByAccountId: first.context.accountId,
      reason: 'both privileged authenticators were destroyed',
      targetAccountId: target.context.accountId,
      validForMilliseconds: 3_600_000,
    });
    return { first, requestId, second, service, target };
  }

  it('refuses completion with no approvals and with one approval', async () => {
    const { first, requestId, service } = await scenario('single');
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'single',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'dual_control_not_satisfied' });

    await service.approvePrivilegedRecovery({
      approverAccountId: first.context.accountId,
      correlationId: 'single',
      requestId,
    });
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'single',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'dual_control_not_satisfied' });
  });

  it('counts one security owner once, however many times they approve', async () => {
    const { first, requestId, service } = await scenario('duplicate');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await service.approvePrivilegedRecovery({
        approverAccountId: first.context.accountId,
        correlationId: 'duplicate',
        requestId,
      });
    }
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'duplicate',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'dual_control_not_satisfied' });
  });

  it('refuses an approver who is not a preauthorized security owner', async () => {
    const { requestId, service } = await scenario('outsider');
    const outsider = await signedInAccount('outsider@velora.test');
    expect(
      await service.approvePrivilegedRecovery({
        approverAccountId: outsider.context.accountId,
        correlationId: 'outsider',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'not_security_owner' });
  });

  it('refuses the recovery target approving its own recovery', async () => {
    const { requestId, service, target } = await scenario('self');
    await service.designateSecurityOwner(target.context.accountId);
    expect(
      await service.approvePrivilegedRecovery({
        approverAccountId: target.context.accountId,
        correlationId: 'self',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'self_approval' });
  });

  it('completes under two distinct owners and strips the target of privileged means', async () => {
    const { first, requestId, second, service, target } =
      await scenario('dual');
    await service.enrolAuthenticator({
      context: adminContext(target.context.accountId, 'enrolment'),
      correlationId: 'dual',
      credentialId: 'credential-target',
      label: 'security key',
      publicKey: 'public-key',
    });
    await adminSession(target.context.accountId);

    for (const owner of [first, second]) {
      await service.approvePrivilegedRecovery({
        approverAccountId: owner.context.accountId,
        correlationId: 'dual',
        requestId,
      });
    }
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'dual',
        requestId,
      }),
    ).toEqual({ kind: 'completed' });

    expect(await service.productionReadiness(target.context.accountId)).toEqual(
      { enrolled: 0, ready: false },
    );
    const live = await rowsOf<{ total: number }>(
      database.sql`select count(*)::int as total from auth_sessions where account_id = ${target.context.accountId} and revoked_at is null`,
    );
    expect(live[0]?.total).toBe(0);

    const account = await repository.findAccount(
      repository.transactionless,
      target.context.accountId,
    );
    expect(account?.highImpactRestrictionReason).toBe('privileged_recovery');

    // Completed once, never twice.
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'dual',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'not_pending' });
  });

  it('refuses an expired privileged recovery request', async () => {
    const { first, requestId, second, service } = await scenario('expired');
    for (const owner of [first, second]) {
      await service.approvePrivilegedRecovery({
        approverAccountId: owner.context.accountId,
        correlationId: 'expired',
        requestId,
      });
    }
    clock.current = new Date(clock.current.getTime() + 7_200_000);
    expect(
      await service.completePrivilegedRecovery({
        correlationId: 'expired',
        requestId,
      }),
    ).toEqual({ kind: 'rejected', reason: 'expired' });
  });
});
