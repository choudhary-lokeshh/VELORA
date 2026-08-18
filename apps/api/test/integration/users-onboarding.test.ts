import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  IdentityAdultAssuranceReader,
  type IdentityAdultAssuranceReaderPort,
} from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import {
  adultAssuranceDecisionOf,
  OnboardingService,
} from '../../src/users/onboarding.js';
import {
  adultEligibilityPolicyVersion,
  requiredPolicyDocuments,
} from '../../src/users/onboarding-policy.js';
import { ProfileRepository } from '../../src/users/profile-repository.js';
import { UsersRepository } from '../../src/users/repository.js';
import { UsersService } from '../../src/users/service.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testProductRuntimes,
  testDatabaseAdmission,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_users_onboarding');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new UsersRepository(database.drizzle);
const identityRepository = new IdentityRepository(database.drizzle);
const identityAdultAssurance = new IdentityAdultAssuranceReader(
  identityRepository,
);
const profileRepository = new ProfileRepository(database.drizzle);
const users = new UsersService({ now: () => new Date(), repository });

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig();

function onboardingService(
  now: () => Date = () => new Date(),
  identity: IdentityAdultAssuranceReaderPort = identityAdultAssurance,
): OnboardingService {
  return new OnboardingService({
    identityAdultAssurance: identity,
    now,
    profiles: profileRepository,
    repository,
  });
}

function harness() {
  const logs: unknown[] = [];
  const logger = silentLogger(logs);
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'onboarding-test',
    },
  });
  const mediaRuntime = testMediaRuntime({
    config,
    database: database.drizzle,
    logger,
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    identityAdultAssurance,
    logger,
    media: mediaRuntime.service,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      ...testProductRuntimes({
        caller: auth.caller,
        config,
        database: database.drizzle,
        logger,
        users,
      }),
      database: healthy,
      databaseAdmission: testDatabaseAdmission(),
      ephemeralRedis: healthy,
      logger,
      queueRedis: healthy,
      users,
    },
  });
  return {
    close: () => application.close(),
    handle: (request: Request) => application.app.handle(request),
    logs,
  };
}

async function recordIdentityAdultDecision(input: {
  readonly authAccountId: string;
  readonly expiresAt?: Date;
  readonly now: Date;
  readonly result: 'granted' | 'refused' | 'revoked';
}): Promise<void> {
  const operation = await identityRepository.establishAttempt({
    callerIdempotencyKey: `caller-${crypto.randomUUID()}`,
    inputDigest: 'a'.repeat(64),
    jurisdiction: 'PL',
    now: input.now,
    ownerDomain: 'auth',
    ownerReference: input.authAccountId,
    policyVersion: 'local-test-v1',
    provider: 'local-test',
    providerIdempotencyKey: `provider-${crypto.randomUUID()}`,
    purpose: 'adult_assurance',
    requiredEvidenceClass: 'adult_threshold',
    requiredThreshold: 'adult-18-plus',
  });
  if (operation.kind !== 'created') throw new Error('attempt was not created');
  await identityRepository.transaction(async (executor) => {
    await identityRepository.transitionAttempt(executor, {
      attemptId: operation.attempt.id,
      from: ['created'],
      now: input.now,
      to: 'provider_starting',
    });
    await identityRepository.transitionAttempt(executor, {
      attemptId: operation.attempt.id,
      from: ['provider_starting'],
      now: input.now,
      providerReference: `reference-${crypto.randomUUID()}`,
      to: 'provider_pending',
    });
    await identityRepository.appendEvidence(executor, {
      attemptId: operation.attempt.id,
      effectiveAt: input.now,
      evidenceClass: 'adult_threshold',
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      normalizedResult: input.result,
      now: input.now,
      policyVersion: operation.attempt.policyVersion,
      provider: operation.attempt.provider,
      providerFactReference: `fact-${crypto.randomUUID()}`,
      subjectId: operation.subject.id,
      thresholdContext: operation.attempt.requiredThreshold,
    });
    await identityRepository.transitionAttempt(executor, {
      attemptId: operation.attempt.id,
      from: ['provider_pending'],
      now: input.now,
      to: input.result === 'granted' ? 'succeeded' : 'refused',
    });
  });
}

const api = harness();

afterAll(async () => {
  await api.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function consumerAccount(subject: string) {
  const signIn = await api.handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
      },
      method: 'POST',
    }),
  );
  const session = (await signIn.json()) as { csrfToken: string };
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  const created = await api.handle(
    new Request('http://api.test/v1/users', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': session.csrfToken,
      },
      method: 'POST',
    }),
  );
  const account = (await created.json()) as { id: string };
  return { account, cookie, csrf: session.csrfToken };
}

function post(
  path: string,
  credentials: { readonly cookie: string; readonly csrf: string },
  body: unknown,
): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': credentials.csrf,
    },
    method: 'POST',
  });
}

interface OnboardingBody {
  readonly account: { readonly status: string; readonly region?: string };
  readonly adultAssurance: string;
  readonly adultAssuranceRefused: boolean;
  readonly outstandingPolicies: readonly { readonly key: string }[];
  readonly step: string;
}

async function readOnboarding(credentials: {
  readonly cookie: string;
}): Promise<OnboardingBody> {
  const response = await api.handle(
    new Request('http://api.test/v1/users/me/onboarding', {
      headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as OnboardingBody;
}

const allRequiredPolicies = requiredPolicyDocuments.map((document) => ({
  key: document.key,
  version: document.version,
}));

describe('adult onboarding progression', () => {
  it('starts at the adult gate and refuses to skip it', async () => {
    const caller = await consumerAccount('onboard-order@velora.test');

    expect((await readOnboarding(caller)).step).toBe('adult_declaration');

    const skipped = await api.handle(
      post('/v1/users/me/onboarding/acknowledgements', caller, {
        acknowledgements: allRequiredPolicies,
      }),
    );
    expect(skipped.status).toBe(409);
    expect(((await skipped.json()) as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_policy_acknowledgements`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('advances through declaration and acknowledgement to the profile step', async () => {
    const caller = await consumerAccount('onboard-happy@velora.test');

    const declared = await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'DE',
      }),
    );
    expect(declared.status).toBe(200);
    const afterDeclaration = (await declared.json()) as OnboardingBody;
    expect(afterDeclaration.step).toBe('policy_acknowledgement');
    expect(afterDeclaration.adultAssurance).toBe('self_declared');
    expect(afterDeclaration.account.region).toBe('DE');

    const acknowledged = await api.handle(
      post('/v1/users/me/onboarding/acknowledgements', caller, {
        acknowledgements: allRequiredPolicies,
      }),
    );
    expect(acknowledged.status).toBe(200);
    const afterAcknowledgement = (await acknowledged.json()) as OnboardingBody;
    // The minimum profile is not implemented, so admission honestly stops here
    // rather than reporting a completion that has not happened.
    expect(afterAcknowledgement.step).toBe('profile');
    expect(afterAcknowledgement.outstandingPolicies).toEqual([]);
    expect(afterAcknowledgement.account.status).toBe('pending_profile');
  });

  it('records a refusal and restricts the account without deleting evidence', async () => {
    const caller = await consumerAccount('onboard-refused@velora.test');

    const refused = await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: false,
        region: 'DE',
      }),
    );
    expect(refused.status).toBe(409);

    const state = await readOnboarding(caller);
    expect(state.account.status).toBe('restricted');
    expect(state.adultAssurance).toBe('none');
    expect(state.adultAssuranceRefused).toBe(true);
    expect(state.step).toBe('adult_declaration');

    const rows = await rowsOf<{ outcome: string }>(
      database.sql`select outcome from users_adult_declarations order by id`,
    );
    expect(rows.map((row) => row.outcome)).toEqual(['failed']);
  });

  it('lets a refused account declare again and keeps both assessments', async () => {
    const caller = await consumerAccount('onboard-recover@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: false,
        region: 'DE',
      }),
    );
    const corrected = await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'DE',
      }),
    );
    expect(corrected.status).toBe(200);

    const state = await readOnboarding(caller);
    expect(state.account.status).toBe('pending_profile');
    expect(state.adultAssurance).toBe('self_declared');
    expect(state.adultAssuranceRefused).toBe(false);

    const rows = await rowsOf<{ outcome: string }>(
      database.sql`select outcome from users_adult_declarations order by id`,
    );
    // The refusal is history, not something the later pass erased.
    expect(rows.map((row) => row.outcome)).toEqual(['failed', 'passed']);
  });

  it('treats repeated declarations and acknowledgements as idempotent', async () => {
    const caller = await consumerAccount('onboard-repeat@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'FR',
      }),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await api.handle(
        post('/v1/users/me/onboarding/acknowledgements', caller, {
          acknowledgements: allRequiredPolicies,
        }),
      );
      expect(response.status).toBe(200);
    }

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_policy_acknowledgements`,
    );
    expect(rows[0]?.count).toBe(String(allRequiredPolicies.length));
  });

  it('keeps one acknowledgement row per version under concurrent submissions', async () => {
    const caller = await consumerAccount('onboard-race@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'ES',
      }),
    );

    const responses = await Promise.all(
      Array.from({ length: 20 }, async () =>
        api.handle(
          post('/v1/users/me/onboarding/acknowledgements', caller, {
            acknowledgements: allRequiredPolicies,
          }),
        ),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_policy_acknowledgements`,
    );
    expect(rows[0]?.count).toBe(String(allRequiredPolicies.length));
  });

  it('refuses acknowledgement of a version that is not the one required', async () => {
    const caller = await consumerAccount('onboard-version@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'IT',
      }),
    );

    const stale = await api.handle(
      post('/v1/users/me/onboarding/acknowledgements', caller, {
        acknowledgements: [
          { key: 'terms_of_service', version: 'some-other-version' },
        ],
      }),
    );
    expect(stale.status).toBe(409);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_policy_acknowledgements`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('does not accept evidence for a version other than the required one', async () => {
    const caller = await consumerAccount('onboard-newversion@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'NL',
      }),
    );
    await api.handle(
      post('/v1/users/me/onboarding/acknowledgements', caller, {
        acknowledgements: allRequiredPolicies,
      }),
    );
    expect((await readOnboarding(caller)).step).toBe('profile');

    // Republication under a new version, simulated by writing evidence for a
    // version the platform does not currently require. Existing evidence is
    // untouched, and the account still holds the version it actually accepted.
    await execute(
      database.sql`insert into users_policy_acknowledgements (user_id, policy_key, policy_version, audience)
        values (${caller.account.id}, 'terms_of_service', '1-published', 'consumer_web')`,
    );
    const rows = await rowsOf<{ policy_version: string }>(
      database.sql`select policy_version from users_policy_acknowledgements
        where policy_key = 'terms_of_service' order by id`,
    );
    expect(rows.map((row) => row.policy_version)).toEqual([
      requiredPolicyDocuments[0]?.version ?? '',
      '1-published',
    ]);
    expect((await readOnboarding(caller)).step).toBe('profile');
  });

  it('does not invent verified assurance when Identity has no evidence', async () => {
    const caller = await consumerAccount('onboard-verify@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'PT',
      }),
    );
    const account = await users.findAccountById(caller.account.id);
    expect(account).toBeDefined();
    if (account === undefined) throw new Error('account missing');

    const outcome = await onboardingService().evaluate(account);
    expect(outcome.adultAssurance).toBe('self_declared');

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from identity_evidence`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('derives verified assurance from Identity evidence and honours expiry', async () => {
    const caller = await consumerAccount('onboard-verified@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'PL',
      }),
    );
    const account = await users.findAccountById(caller.account.id);
    if (account === undefined) throw new Error('account missing');

    const clock = { current: new Date(Date.now() + 60_000) };
    await recordIdentityAdultDecision({
      authAccountId: account.authAccountId,
      expiresAt: new Date(clock.current.getTime() + 60_000),
      now: clock.current,
      result: 'granted',
    });
    const service = onboardingService(() => clock.current);
    expect((await service.evaluate(account)).adultAssurance).toBe(
      'verified_adult',
    );

    clock.current = new Date(clock.current.getTime() + 120_000);
    const expired = await service.evaluate(account);
    // An expired verified pass falls back to nothing, not to the earlier
    // self-declaration: the current assurance is the latest assessment.
    expect(expired.adultAssurance).toBe('none');
    expect(expired.adultAssuranceRefused).toBe(false);
  });

  it('lets later re-verification outrank an earlier grant despite clock skew', async () => {
    const caller = await consumerAccount('onboard-reverification@velora.test');
    const account = await users.findAccountById(caller.account.id);
    if (account === undefined) throw new Error('account missing');
    const grantAt = new Date('2026-08-18T00:01:00.000Z');
    await recordIdentityAdultDecision({
      authAccountId: account.authAccountId,
      now: grantAt,
      result: 'granted',
    });
    // The second operation is durably later even though its process clock is
    // behind. A timestamp comparison would resurrect the older grant.
    const reverifyAt = new Date('2026-08-18T00:00:00.000Z');
    const next = await identityRepository.establishAttempt({
      callerIdempotencyKey: 'same-tick-next-attempt',
      inputDigest: 'b'.repeat(64),
      jurisdiction: 'PL',
      now: reverifyAt,
      ownerDomain: 'auth',
      ownerReference: account.authAccountId,
      policyVersion: 'local-test-v2',
      provider: 'local-test',
      providerIdempotencyKey: 'same-tick-provider-attempt',
      purpose: 'adult_assurance',
      requiredEvidenceClass: 'adult_threshold',
      requiredThreshold: 'adult-18-plus',
    });
    expect(next.kind).toBe('created');
    const state = await onboardingService(() => grantAt).evaluate(account);
    expect(state.adultAssurance).toBe('none');
    expect(state.adultAssuranceRefused).toBe(false);
  });

  it('uses the least-authorizing answer when separate domains record in one tick', () => {
    const recordedAt = new Date('2026-08-18T00:00:00.000Z');
    expect(
      adultAssuranceDecisionOf(
        { outcome: 'failed', recordedAt },
        {
          assurance: 'verified_adult',
          recordedAt,
          refused: false,
        },
      ),
    ).toEqual({ adultAssurance: 'none', refused: true });
    expect(
      adultAssuranceDecisionOf(
        { outcome: 'passed', recordedAt },
        { assurance: 'none', recordedAt, refused: false },
      ),
    ).toEqual({ adultAssurance: 'none', refused: false });
  });

  it('keeps provider evidence out of USERS storage', async () => {
    const caller = await consumerAccount('onboard-evidence@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'SE',
      }),
    );
    const account = await users.findAccountById(caller.account.id);
    if (account === undefined) throw new Error('account missing');
    await recordIdentityAdultDecision({
      authAccountId: account.authAccountId,
      now: new Date(Date.now() + 60_000),
      result: 'granted',
    });

    const columns = await rowsOf<{
      column_name: string;
    }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'users_adult_declarations'
        order by ordinal_position`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'decided_at',
      'id',
      'outcome',
      'policy_version',
      'recorded_at',
      'region',
      'user_id',
    ]);
    const evidence = await rowsOf<{ provider_fact_reference: string }>(
      database.sql`select provider_fact_reference from identity_evidence`,
    );
    expect(evidence[0]?.provider_fact_reference).toMatch(/^fact-/u);
  });

  it('records the eligibility policy version every outcome was judged against', async () => {
    const caller = await consumerAccount('onboard-policyversion@velora.test');
    await api.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'IE',
      }),
    );
    const rows = await rowsOf<{ policy_version: string }>(
      database.sql`select policy_version from users_adult_declarations`,
    );
    expect(rows[0]?.policy_version).toBe(adultEligibilityPolicyVersion);
  });

  it('refuses malformed declarations at the contract', async () => {
    const caller = await consumerAccount('onboard-invalid@velora.test');
    for (const body of [
      { declaresAdult: true, region: 'de' },
      { declaresAdult: true, region: 'DEU' },
      { declaresAdult: 'yes', region: 'DE' },
      { region: 'DE' },
      { declaresAdult: true, extra: 1, region: 'DE' },
    ]) {
      const response = await api.handle(
        post('/v1/users/me/onboarding/adult-declaration', caller, body),
      );
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('refuses onboarding for a caller with no consumer account', async () => {
    const signIn = await api.handle(
      new Request('http://api.test/v1/auth/local/web-sessions', {
        body: JSON.stringify({
          audience: 'consumer_web',
          subject: 'onboard-noaccount@velora.test',
        }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );
    const cookie = signIn.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; ');
    const response = await api.handle(
      new Request('http://api.test/v1/users/me/onboarding', {
        headers: { cookie, origin: testConsumerOrigin },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('refuses impossible declaration rows and mutation at the database', async () => {
    const caller = await consumerAccount('onboard-constraints@velora.test');
    const userId = caller.account.id;
    const cases: readonly {
      readonly label: string;
      readonly run: () => Promise<unknown>;
    }[] = [
      {
        label: 'unknown declaration outcome',
        run: async () =>
          execute(
            database.sql`insert into users_adult_declarations (user_id, outcome, policy_version, region, decided_at)
              values (${userId}, 'trusted_me', 'v1', 'DE', now())`,
          ),
      },
      {
        label: 'recording before decision',
        run: async () =>
          execute(
            database.sql`insert into users_adult_declarations (user_id, outcome, policy_version, region, decided_at, recorded_at)
              values (${userId}, 'passed', 'v1', 'DE', now(), now() - interval '1 hour')`,
          ),
      },
      {
        label: 'declaration update',
        run: async () => {
          await execute(
            database.sql`insert into users_adult_declarations (user_id, outcome, policy_version, region, decided_at)
              values (${userId}, 'passed', 'v1', 'DE', now())`,
          );
          return execute(
            database.sql`update users_adult_declarations set outcome = 'failed' where user_id = ${userId}`,
          );
        },
      },
      {
        label: 'unknown policy key',
        run: async () =>
          execute(
            database.sql`insert into users_policy_acknowledgements (user_id, policy_key, policy_version, audience)
              values (${userId}, 'secret_pact', '1', 'consumer_web')`,
          ),
      },
      {
        label: 'privileged audience on a consumer acknowledgement',
        run: async () =>
          execute(
            database.sql`insert into users_policy_acknowledgements (user_id, policy_key, policy_version, audience)
              values (${userId}, 'terms_of_service', '1', 'platform_admin')`,
          ),
      },
    ];

    for (const scenario of cases) {
      let rejected = false;
      try {
        await scenario.run();
      } catch {
        rejected = true;
      }
      expect(rejected, scenario.label).toBe(true);
    }
  });
});
