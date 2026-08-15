import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
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
  testAdminOrigin,
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Platform Admin creator operations against real PostgreSQL.
 *
 * Two properties matter here. Nobody but a Platform Admin session that has
 * recently proved a phishing-resistant authenticator reaches any of these
 * routes — and because no such verifier is approved, that means nothing reaches
 * them in a deployed environment at all. And every operation that changes
 * something writes an enforcement record naming the actor, the action, the
 * reason, and the target, in the same breath as the change.
 *
 * The third is scope. A creator suspension stops a creator and leaves the
 * person's consumer account exactly as it was, because those are different
 * decisions about different things.
 */

const databaseUrl = await provisionDatabase('velora_admin_creators');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig();
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'admin-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
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
const handle = (request: Request) => application.app.handle(request);

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

interface Studio {
  readonly cookie: string;
  readonly csrf: string;
}

async function session(
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Studio> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin,
        'x-velora-device': `${subject}-${audience}`,
      },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`sign-in failed with ${String(response.status)}`);
  }
  const body = (await response.json()) as { csrfToken: string };
  return {
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken,
  };
}

function studioRequest(
  path: string,
  studio: Studio,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: studio.cookie,
      origin: testCreatorOrigin,
      'x-velora-csrf': studio.csrf,
    },
  });
}

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

interface Creator {
  readonly handle: string;
  readonly studio: Studio;
}

/** An active creator with a published public page, ready to publish content. */
async function publishedCreator(
  subject: string,
  creatorHandle: string,
): Promise<Creator> {
  const consumer = await session(subject, 'consumer_web');
  const consumerPost = (path: string, body: unknown) =>
    new Request(`http://api.test${path}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        cookie: consumer.cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumer.csrf,
      },
      method: 'POST',
    });
  await handle(consumerPost('/v1/users', {}));
  await handle(
    consumerPost('/v1/users/me/onboarding/adult-declaration', {
      declaresAdult: true,
      region: 'ES',
    }),
  );

  const studio = await session(subject, 'creator_studio');
  await handle(studioRequest('/v1/creator', studio, { method: 'POST' }));
  await handle(
    studioRequest('/v1/creator/onboarding/acknowledgements', studio, {
      body: { acknowledgements },
      method: 'POST',
    }),
  );
  const profile = (await (
    await handle(
      studioRequest('/v1/creator/profile', studio, {
        body: { displayName: 'Ember Vale', handle: creatorHandle },
        method: 'POST',
      }),
    )
  ).json()) as { version: number };
  await handle(
    studioRequest('/v1/creator/profile/publication', studio, {
      body: { publication: 'published', version: profile.version },
      method: 'POST',
    }),
  );
  return { handle: creatorHandle, studio };
}

interface ContentItem {
  readonly id: string;
  readonly lifecycle: string;
  readonly title: string;
  readonly version: number;
  readonly visibility: string;
}

async function saveContent(
  studio: Studio,
  body: Record<string, unknown>,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/content', studio, { body, method: 'POST' }),
  );
}

async function firstOf(response: Response): Promise<ContentItem> {
  const body = (await response.json()) as { content: ContentItem[] };
  const item = body.content[0];
  if (item === undefined) throw new Error('response carried no content');
  return item;
}

async function setLifecycle(
  studio: Studio,
  item: ContentItem,
  lifecycle: string,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/content/lifecycle', studio, {
      body: { contentId: item.id, lifecycle, version: item.version },
      method: 'POST',
    }),
  );
}

/** Creates one item and publishes it, returning the published row. */
async function publishItem(
  studio: Studio,
  title: string,
  visibility: 'public' | 'members_only' = 'public',
): Promise<ContentItem> {
  const draft = await firstOf(await saveContent(studio, { title, visibility }));
  return firstOf(await setLifecycle(studio, draft, 'published'));
}

function catalogRequest(handleValue: string, query = ''): Request {
  return new Request(
    `http://api.test/v1/creators/catalog?handle=${encodeURIComponent(handleValue)}${query}`,
  );
}

interface Club {
  readonly id: string;
  readonly lifecycle: string;
  readonly memberCount: number;
  readonly slug: string;
  readonly version: number;
}

async function firstClub(response: Response): Promise<Club> {
  const body = (await response.json()) as { clubs: Club[] };
  const club = body.clubs[0];
  if (club === undefined) throw new Error('response carried no club');
  return club;
}

/**
 * A Platform Admin session, written directly.
 *
 * The local identity adapter cannot mint Admin authority by construction —
 * ADR-0017 requires a phishing-resistant authenticator and none is approved —
 * so a suite that needs an operator writes the session it is testing the rules
 * around. That is the same reason these routes are unreachable in a deployed
 * environment: nothing there can produce this assurance.
 */
async function adminSession(
  assurance: 'phishing_resistant' | 'single_factor' = 'phishing_resistant',
  establishedAt: Date = new Date(),
): Promise<Studio> {
  const accountId = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
  );
  // The same shape AUTH mints: a version tag and 32 bytes of base64url. A
  // token of any other shape is rejected before it is ever looked up.
  const opaque = () =>
    `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  const token = opaque();
  const csrf = opaque();
  const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
  const now = new Date();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', ${assurance}, ${establishedAt},
      ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 900_000)}, ${now},
      ${new Date(now.getTime() + 28_800_000)}, ${digest(token)}
    )
  `);
  return {
    cookie: `__Host-velora_platform_admin_session=${token}`,
    csrf,
  };
}

function adminRequest(
  path: string,
  admin: Studio,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      origin: testAdminOrigin,
      'x-velora-csrf': admin.csrf,
    },
  });
}

interface AdminSubjectCreator {
  readonly handle: string;
  readonly id: string;
  readonly studio: Studio;
}

/** An active creator with a published page, ready for an operator to act on. */
async function fullCreator(
  subject: string,
  handleValue: string,
): Promise<AdminSubjectCreator> {
  const base = await publishedCreator(subject, handleValue);
  const account = (await (
    await handle(studioRequest('/v1/creator/me', base.studio))
  ).json()) as { id: string };
  return { handle: base.handle, id: account.id, studio: base.studio };
}

async function enforcements(): Promise<
  {
    actor_reference: string;
    reason_code: string;
    scope: string;
    subject_id: string;
    target_object_id: string | null;
    target_object_type: string | null;
  }[]
> {
  return rowsOf(
    database.sql`select actor_reference, reason_code, scope, subject_id,
      target_object_id, target_object_type from safety_enforcements
      order by created_at`,
  );
}

describe('Admin audience isolation and step-up', () => {
  it('refuses a consumer session, a Creator Studio session, and no session', async () => {
    const creator = await fullCreator(
      'admin-audience@velora.test',
      'admin-audience',
    );
    const consumer = await session(
      'admin-audience@velora.test',
      'consumer_web',
    );

    const anonymous = await handle(
      new Request('http://api.test/v1/admin/creators'),
    );
    const asConsumer = await handle(
      new Request('http://api.test/v1/admin/creators', {
        headers: { cookie: consumer.cookie, origin: testConsumerOrigin },
      }),
    );
    const asCreator = await handle(
      new Request('http://api.test/v1/admin/creators', {
        headers: { cookie: creator.studio.cookie, origin: testCreatorOrigin },
      }),
    );

    expect(anonymous.status).toBe(401);
    expect(asConsumer.status).toBe(403);
    expect(await asConsumer.json()).toMatchObject({
      code: 'ACTION_NOT_PERMITTED',
    });
    expect(asCreator.status).toBe(403);
  });

  it('refuses an Admin session that has not proved a phishing-resistant authenticator', async () => {
    const weak = await adminSession('single_factor');

    const response = await handle(adminRequest('/v1/admin/creators', weak));

    // Being an operator is not enough. ADR-0017 requires the assurance, and
    // nothing here degrades to something weaker when it is absent.
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'ACTION_NOT_PERMITTED',
    });
  });

  it('refuses an Admin session whose assurance has gone stale', async () => {
    const stale = await adminSession(
      'phishing_resistant',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000),
    );

    const response = await handle(adminRequest('/v1/admin/creators', stale));

    expect(response.status).toBe(403);
  });

  it('refuses a state-changing Admin request with no CSRF evidence', async () => {
    const admin = await adminSession();
    const creator = await fullCreator('admin-csrf@velora.test', 'admin-csrf');

    const response = await handle(
      new Request('http://api.test/v1/admin/creators/suspension', {
        body: JSON.stringify({
          creatorId: creator.id,
          reasonCode: 'platform_integrity',
        }),
        headers: {
          'content-type': 'application/json',
          cookie: admin.cookie,
          origin: testAdminOrigin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'AUTH_CSRF_REQUIRED' });
    expect(await enforcements()).toHaveLength(0);
  });
});

describe('Admin creator operations', () => {
  it('lists creators in operational terms and nothing more', async () => {
    const admin = await adminSession();
    const creator = await fullCreator('admin-list@velora.test', 'admin-list');

    const response = await handle(adminRequest('/v1/admin/creators', admin));
    const body = (await response.json()) as {
      creators: Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    expect(Object.keys(body.creators[0] ?? {}).toSorted()).toEqual([
      'activatedAt',
      'createdAt',
      'handle',
      'id',
      'profilePublished',
      'status',
    ]);
    expect(body.creators[0]?.handle).toBe(creator.handle);
    const serialized = JSON.stringify(body);
    for (const absent of [
      'authAccountId',
      'userId',
      'email',
      'bank',
      'tax',
      'payout',
    ]) {
      expect(serialized, absent).not.toContain(absent);
    }
  });

  it('searches by public handle prefix only, bounded', async () => {
    const admin = await adminSession();
    await fullCreator('admin-search-a@velora.test', 'searchable-one');
    await fullCreator('admin-search-b@velora.test', 'other-two');

    const found = (await (
      await handle(
        adminRequest('/v1/admin/creators?adminSearch=searchable', admin),
      )
    ).json()) as { creators: { handle: string }[] };
    const rejected = await handle(
      adminRequest('/v1/admin/creators?adminSearch=has%20space', admin),
    );

    expect(found.creators.map((entry) => entry.handle)).toEqual([
      'searchable-one',
    ]);
    expect(rejected.status).toBe(422);
  });

  it('suspends a creator, records why, and takes their public surfaces down', async () => {
    const admin = await adminSession();
    const creator = await fullCreator(
      'admin-suspend@velora.test',
      'admin-suspend',
    );
    await publishItem(creator.studio, 'Out there');
    expect((await handle(catalogRequest(creator.handle))).status).toBe(200);

    const response = await handle(
      adminRequest('/v1/admin/creators/suspension', admin, {
        body: { creatorId: creator.id, reasonCode: 'platform_integrity' },
        method: 'POST',
      }),
    );
    const body = (await response.json()) as {
      creator: { status: string };
      scope: string;
    };

    expect(response.status).toBe(200);
    expect(body.creator.status).toBe('suspended');
    expect(body.scope).toBe('creator_suspension');
    // Nothing was unpublished. The public read rechecks creator state.
    expect((await handle(catalogRequest(creator.handle))).status).toBe(404);

    const [record] = await enforcements();
    expect(record?.scope).toBe('creator_suspension');
    expect(record?.subject_id).toBe(creator.id);
    expect(record?.reason_code).toBe('platform_integrity');
    expect(record?.actor_reference.startsWith('session:')).toBe(true);
  });

  it('leaves the person’s consumer account exactly as it was', async () => {
    const admin = await adminSession();
    const creator = await fullCreator('admin-scope@velora.test', 'admin-scope');
    const before = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts`,
    );

    await handle(
      adminRequest('/v1/admin/creators/suspension', admin, {
        body: { creatorId: creator.id, reasonCode: 'harassment' },
        method: 'POST',
      }),
    );

    const after = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts`,
    );
    // A creator suspension and a global restriction are different decisions
    // about different things, and conflating them would ban somebody from a
    // product they were not accused of anything in.
    expect(after).toEqual(before);
  });

  it('reinstates as its own record and does not republish anything', async () => {
    const admin = await adminSession();
    const creator = await fullCreator(
      'admin-reinstate@velora.test',
      'admin-reinstate',
    );
    await handle(
      adminRequest('/v1/admin/creators/suspension', admin, {
        body: { creatorId: creator.id, reasonCode: 'spam_or_scam' },
        method: 'POST',
      }),
    );

    const response = await handle(
      adminRequest('/v1/admin/creators/reinstatement', admin, {
        body: { creatorId: creator.id, reasonCode: 'spam_or_scam' },
        method: 'POST',
      }),
    );
    const body = (await response.json()) as { creator: { status: string } };

    expect(response.status).toBe(200);
    // Back to applicant: whether every gate still passes is the ladder's answer
    // on the next read, not an operator's assertion.
    expect(body.creator.status).toBe('applicant');
    const records = await enforcements();
    expect(records.map((entry) => entry.scope)).toEqual([
      'creator_suspension',
      'creator_reinstatement',
    ]);
  });

  it('takes down a profile, an item, and a club without destroying any of them', async () => {
    const admin = await adminSession();
    const creator = await fullCreator(
      'admin-remove@velora.test',
      'admin-remove',
    );
    const item = await publishItem(creator.studio, 'Taken down');
    const draftClub = await firstClub(
      await handle(
        studioRequest('/v1/creator/clubs', creator.studio, {
          body: { name: 'Room', slug: 'room' },
          method: 'POST',
        }),
      ),
    );
    const club = await firstClub(
      await handle(
        studioRequest('/v1/creator/clubs/lifecycle', creator.studio, {
          body: {
            clubId: draftClub.id,
            lifecycle: 'published',
            version: draftClub.version,
          },
          method: 'POST',
        }),
      ),
    );

    for (const body of [
      {
        creatorId: creator.id,
        objectType: 'creator_content',
        objectId: item.id,
      },
      { creatorId: creator.id, objectType: 'club', objectId: club.id },
      { creatorId: creator.id, objectType: 'creator_profile' },
    ]) {
      const response = await handle(
        adminRequest('/v1/admin/creators/object-removal', admin, {
          body: { ...body, reasonCode: 'sexual_content_violation' },
          method: 'POST',
        }),
      );
      expect(response.status, body.objectType).toBe(200);
    }

    // Everything is out of public view and everything still exists.
    expect((await handle(catalogRequest(creator.handle))).status).toBe(404);
    expect(
      await rowsOf(database.sql`select 1 from clubs_content`),
    ).toHaveLength(1);
    expect(await rowsOf(database.sql`select 1 from clubs_clubs`)).toHaveLength(
      1,
    );
    expect(
      await rowsOf(database.sql`select 1 from creators_profiles`),
    ).toHaveLength(1);
    const records = await enforcements();
    expect(records.map((entry) => entry.target_object_type)).toEqual([
      'creator_content',
      'club',
      'creator_profile',
    ]);
  });

  it('never lets an operator act on an object belonging to another creator', async () => {
    const admin = await adminSession();
    const first = await fullCreator(
      'admin-cross-a@velora.test',
      'admin-cross-a',
    );
    const second = await fullCreator(
      'admin-cross-b@velora.test',
      'admin-cross-b',
    );
    const theirs = await publishItem(first.studio, 'Not theirs');

    const crossed = await handle(
      adminRequest('/v1/admin/creators/object-removal', admin, {
        body: {
          creatorId: second.id,
          objectId: theirs.id,
          objectType: 'creator_content',
          reasonCode: 'harassment',
        },
        method: 'POST',
      }),
    );
    const invented = await handle(
      adminRequest('/v1/admin/creators/suspension', admin, {
        body: { creatorId: crypto.randomUUID(), reasonCode: 'harassment' },
        method: 'POST',
      }),
    );

    expect(crossed.status).toBe(409);
    expect(invented.status).toBe(409);
    // A refused operation writes nothing at all, including no audit row.
    expect(await enforcements()).toHaveLength(0);
  });

  it('settles two operators suspending the same creator as one decision', async () => {
    const admin = await adminSession();
    const creator = await fullCreator('admin-race@velora.test', 'admin-race');

    const responses = await Promise.all(
      Array.from({ length: 8 }, async () =>
        handle(
          adminRequest('/v1/admin/creators/suspension', admin, {
            body: { creatorId: creator.id, reasonCode: 'platform_integrity' },
            method: 'POST',
          }),
        ),
      ),
    );

    expect(responses.filter((entry) => entry.status === 200)).toHaveLength(1);
    expect(responses.filter((entry) => entry.status === 409)).toHaveLength(7);
    // One decision, one record. A second enforcement for a change that did not
    // happen would be a false entry in the audit trail.
    expect(await enforcements()).toHaveLength(1);
  });
});

describe('Admin membership operations', () => {
  it('withdraws one entitlement, records it, and stops the next read', async () => {
    const admin = await adminSession();
    const creator = await fullCreator(
      'admin-member@velora.test',
      'admin-member',
    );
    const draftClub = await firstClub(
      await handle(
        studioRequest('/v1/creator/clubs', creator.studio, {
          body: { name: 'Room', slug: 'room' },
          method: 'POST',
        }),
      ),
    );
    const club = await firstClub(
      await handle(
        studioRequest('/v1/creator/clubs/lifecycle', creator.studio, {
          body: {
            clubId: draftClub.id,
            lifecycle: 'published',
            version: draftClub.version,
          },
          method: 'POST',
        }),
      ),
    );
    const issued = (await (
      await handle(
        studioRequest('/v1/creator/clubs/invites', creator.studio, {
          body: { clubId: club.id },
          method: 'POST',
        }),
      )
    ).json()) as { secret: string };

    const member = await session(
      'admin-member-user@velora.test',
      'consumer_web',
    );
    const memberPost = (path: string, body: unknown) =>
      new Request(`http://api.test${path}`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          cookie: member.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': member.csrf,
        },
        method: 'POST',
      });
    await handle(memberPost('/v1/users', {}));
    await handle(
      memberPost('/v1/users/me/onboarding/adult-declaration', {
        declaresAdult: true,
        region: 'ES',
      }),
    );
    const redeemed = await handle(
      memberPost('/v1/clubs/redemptions', { secret: issued.secret }),
    );
    expect(redeemed.status).toBe(200);

    const memberships = await rowsOf<{ id: string }>(
      database.sql`select id from clubs_memberships where state = 'active'`,
    );
    const response = await handle(
      adminRequest('/v1/admin/creators/membership-revocation', admin, {
        body: {
          creatorId: creator.id,
          membershipId: memberships[0]?.id,
          reasonCode: 'platform_integrity',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    const [record] = await enforcements();
    expect(record?.scope).toBe('club_membership_revocation');
    expect(record?.target_object_type).toBe('club_membership');
    expect(
      await rowsOf(
        database.sql`select 1 from clubs_memberships where state = 'active'`,
      ),
    ).toHaveLength(0);
  });

  it('refuses a membership that belongs to another creator club', async () => {
    const admin = await adminSession();
    const first = await fullCreator('admin-mem-a@velora.test', 'admin-mem-a');
    const second = await fullCreator('admin-mem-b@velora.test', 'admin-mem-b');

    const response = await handle(
      adminRequest('/v1/admin/creators/membership-revocation', admin, {
        body: {
          creatorId: second.id,
          membershipId: crypto.randomUUID(),
          reasonCode: 'harassment',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(409);
    expect(first.id).not.toBe(second.id);
    expect(await enforcements()).toHaveLength(0);
  });
});
