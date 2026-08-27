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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

/**
 * Private clubs, entitlements, and invitations against real PostgreSQL.
 *
 * The property this suite exists to prove is that access is decided at the
 * moment it is used. A membership is not permission: every protected read asks
 * again whether the club is published, the creator is active, the account is in
 * good standing, and the entitlement is still live — so a revocation, a
 * suspension, or an unpublished club stops a reader without anything being
 * recomputed or swept.
 *
 * The rest is about the invitation being a bearer credential and treated like
 * one: high-entropy, stored only as a digest, expiring, revocable, and usable
 * exactly once however many callers present it at the same instant.
 */

const databaseUrl = await provisionDatabase('velora_creators_clubs');
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
      request.headers.get('x-velora-device') ?? 'clubs-test',
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
  readonly clubId?: string;
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

interface PublicCatalog {
  readonly content: { id: string; title: string }[];
  readonly handle: string;
  readonly nextCursor?: string;
}

interface Club {
  readonly id: string;
  readonly lifecycle: string;
  readonly memberCount: number;
  readonly slug: string;
  readonly version: number;
}

interface Membership {
  readonly id: string;
  readonly source: string;
  readonly state: string;
}

async function firstClub(response: Response): Promise<Club> {
  const body = (await response.json()) as { clubs: Club[] };
  const club = body.clubs[0];
  if (club === undefined) throw new Error('response carried no club');
  return club;
}

async function saveClub(
  studio: Studio,
  body: Record<string, unknown>,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/clubs', studio, { body, method: 'POST' }),
  );
}

async function setClubLifecycle(
  studio: Studio,
  club: Club,
  lifecycle: string,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/clubs/lifecycle', studio, {
      body: { clubId: club.id, lifecycle, version: club.version },
      method: 'POST',
    }),
  );
}

/** A published club belonging to this creator. */
async function publishedClub(studio: Studio, slug: string): Promise<Club> {
  const draft = await firstClub(
    await saveClub(studio, { name: 'Inner Circle', slug }),
  );
  return firstClub(await setClubLifecycle(studio, draft, 'published'));
}

async function issueInvite(
  studio: Studio,
  club: Club,
): Promise<{ invite: { id: string }; secret: string }> {
  const response = await handle(
    studioRequest('/v1/creator/clubs/invites', studio, {
      body: { clubId: club.id },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`invite failed with ${String(response.status)}`);
  }
  return (await response.json()) as { invite: { id: string }; secret: string };
}

/** A consumer who can redeem: an account that has declared adult status. */
async function consumerMember(subject: string): Promise<Studio> {
  const consumer = await session(subject, 'consumer_web');
  const post = (path: string, body: unknown) =>
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
  await handle(post('/v1/users', {}));
  await handle(
    post('/v1/users/me/onboarding/adult-declaration', {
      declaresAdult: true,
      region: 'ES',
    }),
  );
  return consumer;
}

function consumerRequest(
  path: string,
  credentials: Studio,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': credentials.csrf,
    },
  });
}

async function redeem(member: Studio, secret: string): Promise<Response> {
  return handle(
    consumerRequest('/v1/clubs/redemptions', member, {
      body: { secret },
      method: 'POST',
    }),
  );
}

async function readProtected(
  member: Studio,
  contentId: string,
): Promise<Response> {
  return handle(
    consumerRequest(
      `/v1/clubs/content?contentId=${encodeURIComponent(contentId)}`,
      member,
    ),
  );
}

/** A published, club-scoped, members-only item. */
async function clubItem(
  studio: Studio,
  club: Club,
  title: string,
): Promise<ContentItem> {
  const draft = await firstOf(
    await saveContent(studio, {
      body: 'Members can read this.',
      clubId: club.id,
      title,
      visibility: 'members_only',
    }),
  );
  return firstOf(await setLifecycle(studio, draft, 'published'));
}

describe('club lifecycle', () => {
  it('creates a club as a draft with nobody in it and no public presence', async () => {
    const creator = await publishedCreator(
      'club-draft@velora.test',
      'club-draft',
    );

    const created = await saveClub(creator.studio, {
      description: 'A quiet room.',
      name: 'Inner Circle',
      slug: 'Inner_Circle',
    });
    const club = await firstClub(created);
    const publicClubs = await handle(
      new Request(`http://api.test/v1/creators/clubs?handle=${creator.handle}`),
    );
    const listed = (await publicClubs.json()) as { clubs: unknown[] };

    expect(created.status).toBe(201);
    expect(club.lifecycle).toBe('draft');
    expect(club.slug).toBe('inner_circle');
    expect(club.memberCount).toBe(0);
    expect(listed.clubs).toHaveLength(0);
  });

  it('scopes a slug to its creator rather than globally', async () => {
    const first = await publishedCreator('club-slug-a@velora.test', 'slug-one');
    const second = await publishedCreator(
      'club-slug-b@velora.test',
      'slug-two',
    );

    const mine = await saveClub(first.studio, {
      name: 'Studio',
      slug: 'studio',
    });
    const theirs = await saveClub(second.studio, {
      name: 'Studio',
      slug: 'studio',
    });
    const duplicate = await saveClub(first.studio, {
      name: 'Studio again',
      slug: 'studio',
    });

    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(duplicate.status).toBe(409);
  });

  it('publishes on an explicit decision and closes permanently', async () => {
    const creator = await publishedCreator(
      'club-cycle@velora.test',
      'club-cycle',
    );
    const club = await publishedClub(creator.studio, 'cycle');
    const visible = (await (
      await handle(
        new Request(
          `http://api.test/v1/creators/clubs?handle=${creator.handle}`,
        ),
      )
    ).json()) as { clubs: { slug: string }[] };

    const closed = await firstClub(
      await setClubLifecycle(creator.studio, club, 'closed'),
    );
    const reopened = await setClubLifecycle(
      creator.studio,
      closed,
      'published',
    );

    expect(visible.clubs.map((entry) => entry.slug)).toEqual(['cycle']);
    expect(closed.lifecycle).toBe('closed');
    // Reopening would put people back inside a space they left with nobody
    // deciding it, and no approved policy says what that means.
    expect(reopened.status).toBe(409);
  });

  it('refuses every club write from a creator who is not active', async () => {
    const creator = await publishedCreator(
      'club-suspended@velora.test',
      'club-suspended',
    );
    const club = await publishedClub(creator.studio, 'suspended');
    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    const created = await saveClub(creator.studio, {
      name: 'Another',
      slug: 'another',
    });
    const transitioned = await setClubLifecycle(creator.studio, club, 'draft');

    expect(created.status).toBe(409);
    expect(transitioned.status).toBe(409);
  });
});

describe('club invitations', () => {
  it('returns the secret once and stores only a digest of it', async () => {
    const creator = await publishedCreator(
      'invite-once@velora.test',
      'invite-once',
    );
    const club = await publishedClub(creator.studio, 'once');

    const issued = await issueInvite(creator.studio, club);
    const listed = (await (
      await handle(
        studioRequest(
          `/v1/creator/clubs/invites?clubId=${club.id}`,
          creator.studio,
        ),
      )
    ).json()) as { invites: Record<string, unknown>[] };

    expect(issued.secret.length).toBeGreaterThanOrEqual(32);
    // The listing carries the record and never the secret.
    expect(JSON.stringify(listed)).not.toContain(issued.secret);
    const rows = await rowsOf<{ token_digest: string }>(
      database.sql`select token_digest from clubs_invites`,
    );
    expect(rows[0]?.token_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(rows)).not.toContain(issued.secret);
  });

  it('refuses to issue an invitation for a club that is not published', async () => {
    const creator = await publishedCreator(
      'invite-draft@velora.test',
      'invite-draft',
    );
    const draft = await firstClub(
      await saveClub(creator.studio, { name: 'Quiet', slug: 'quiet' }),
    );

    const response = await handle(
      studioRequest('/v1/creator/clubs/invites', creator.studio, {
        body: { clubId: draft.id },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(409);
  });

  it('admits exactly one person when a secret is presented many times at once', async () => {
    const creator = await publishedCreator(
      'invite-race@velora.test',
      'invite-race',
    );
    const club = await publishedClub(creator.studio, 'race');
    const issued = await issueInvite(creator.studio, club);
    const members = await Promise.all(
      Array.from({ length: 10 }, async (_unused, index) =>
        consumerMember(`invite-race-${String(index)}@velora.test`),
      ),
    );

    const responses = await Promise.all(
      members.map(async (member) => redeem(member, issued.secret)),
    );

    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(9);
    const rows = await rowsOf(database.sql`select 1 from clubs_memberships`);
    expect(rows).toHaveLength(1);
  });

  it('refuses a replayed, revoked, expired, or invented secret identically', async () => {
    const creator = await publishedCreator(
      'invite-refuse@velora.test',
      'invite-refuse',
    );
    const club = await publishedClub(creator.studio, 'refuse');
    const used = await issueInvite(creator.studio, club);
    const revoked = await issueInvite(creator.studio, club);
    const expired = await issueInvite(creator.studio, club);
    const first = await consumerMember('invite-refuse-a@velora.test');
    const second = await consumerMember('invite-refuse-b@velora.test');
    await redeem(first, used.secret);
    await handle(
      studioRequest(
        `/v1/creator/clubs/invites/revocation?clubId=${club.id}`,
        creator.studio,
        { body: { inviteId: revoked.invite.id }, method: 'POST' },
      ),
    );
    await execute(
      database.sql`update clubs_invites
        set created_at = now() - interval '30 days', expires_at = now() - interval '1 day'
        where id = ${expired.invite.id}`,
    );

    const replayed = await redeem(second, used.secret);
    const withdrawn = await redeem(second, revoked.secret);
    const stale = await redeem(second, expired.secret);
    const invented = await redeem(second, 'a'.repeat(43));

    for (const response of [replayed, withdrawn, stale, invented]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'ACTION_NOT_PERMITTED',
      });
    }
  });

  it('releases a claim it could not complete rather than spending it', async () => {
    const creator = await publishedCreator(
      'invite-release@velora.test',
      'invite-release',
    );
    const club = await publishedClub(creator.studio, 'release');
    const issued = await issueInvite(creator.studio, club);
    const member = await consumerMember('invite-release-member@velora.test');
    await execute(
      database.sql`update clubs_clubs set lifecycle = 'draft', published_at = null`,
    );

    const whileUnpublished = await redeem(member, issued.secret);
    await execute(
      database.sql`update clubs_clubs set lifecycle = 'published', published_at = now()`,
    );
    const afterRepublish = await redeem(member, issued.secret);

    // A club unpublished a moment ago is somebody else's decision. Consuming
    // the invitation for it would charge the member for that decision.
    expect(whileUnpublished.status).toBe(409);
    expect(afterRepublish.status).toBe(200);
  });
});

describe('club entitlement at the moment of the read', () => {
  async function admitted(scope: string): Promise<{
    club: Club;
    creator: Creator;
    item: ContentItem;
    member: Studio;
  }> {
    const creator = await publishedCreator(`${scope}@velora.test`, scope);
    const club = await publishedClub(creator.studio, scope);
    const item = await clubItem(creator.studio, club, 'Members only');
    const member = await consumerMember(`${scope}-member@velora.test`);
    const issued = await issueInvite(creator.studio, club);
    const redeemed = await redeem(member, issued.secret);
    if (redeemed.status !== 200) {
      throw new Error(`redemption failed with ${String(redeemed.status)}`);
    }
    return { club, creator, item, member };
  }

  it('admits a member and keeps the item out of the public catalog', async () => {
    const { creator, item, member } = await admitted('entitle-basic');

    const read = await readProtected(member, item.id);
    const publicCatalog = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    expect(read.status).toBe(200);
    expect(publicCatalog.content).toHaveLength(0);
  });

  it('refuses a member with no entitlement and one whose entitlement was withdrawn', async () => {
    const { club, creator, item, member } = await admitted('entitle-revoke');
    const stranger = await consumerMember('entitle-stranger@velora.test');

    const strangerRead = await readProtected(stranger, item.id);
    const memberships = (await (
      await handle(
        studioRequest(
          `/v1/creator/clubs/members?clubId=${club.id}`,
          creator.studio,
        ),
      )
    ).json()) as { memberships: Membership[] };
    await handle(
      studioRequest(
        `/v1/creator/clubs/members/revocation?clubId=${club.id}`,
        creator.studio,
        {
          body: { membershipId: memberships.memberships[0]?.id },
          method: 'POST',
        },
      ),
    );
    const afterRevocation = await readProtected(member, item.id);

    expect(strangerRead.status).toBe(404);
    expect(memberships.memberships[0]?.source).toBe('creator_invite');
    // Revocation takes effect on the next read, with nothing swept or
    // recomputed.
    expect(afterRevocation.status).toBe(404);
  });

  it('stops admitting when the creator is suspended, the club closes, or the account is restricted', async () => {
    const suspended = await admitted('entitle-suspend');
    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );
    const afterSuspension = await readProtected(
      suspended.member,
      suspended.item.id,
    );

    const closed = await admitted('entitle-close');
    await execute(
      database.sql`update clubs_clubs set lifecycle = 'closed', closed_at = now(), published_at = null where id = ${closed.club.id}`,
    );
    const afterClosure = await readProtected(closed.member, closed.item.id);

    const restricted = await admitted('entitle-restrict');
    await execute(
      database.sql`update users_accounts set status = 'restricted', status_reason = 'safety_enforcement'
        where id = (select member_id from clubs_memberships order by granted_at desc limit 1)`,
    );
    const afterRestriction = await readProtected(
      restricted.member,
      restricted.item.id,
    );

    // Nothing was revoked in any of the three. The read asks again.
    expect(afterSuspension.status).toBe(404);
    expect(afterClosure.status).toBe(404);
    expect(afterRestriction.status).toBe(404);
  });

  it('never admits one club member to another club', async () => {
    const first = await admitted('entitle-cross-a');
    const second = await admitted('entitle-cross-b');

    const crossed = await readProtected(first.member, second.item.id);

    expect(crossed.status).toBe(404);
  });

  it('keeps a public item inside a draft club off the public page', async () => {
    const creator = await publishedCreator(
      'entitle-draftclub@velora.test',
      'entitle-draftclub',
    );
    const draftClub = await firstClub(
      await saveClub(creator.studio, { name: 'Preparing', slug: 'preparing' }),
    );
    const inside = await firstOf(
      await saveContent(creator.studio, {
        clubId: draftClub.id,
        title: 'Written while preparing',
        visibility: 'public',
      }),
    );
    await setLifecycle(creator.studio, inside, 'published');
    const outside = await publishItem(creator.studio, 'Ordinary post');

    const before = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    // Found in the freeze audit. A creator writing inside a room they have not
    // opened yet had those posts on their public page the moment they were
    // published, which is the surprise a draft club exists to prevent.
    expect(before.content.map((entry) => entry.title)).toEqual([
      'Ordinary post',
    ]);

    await setClubLifecycle(creator.studio, draftClub, 'published');
    const after = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    // Opening the room is what makes what is inside it public.
    expect(after.content.map((entry) => entry.title).toSorted()).toEqual([
      'Ordinary post',
      'Written while preparing',
    ]);
    expect(outside.lifecycle).toBe('published');
  });

  it('refuses a members-only item that belongs to no club at all', async () => {
    const creator = await publishedCreator(
      'entitle-orphan@velora.test',
      'entitle-orphan',
    );
    const orphan = await publishItem(
      creator.studio,
      'Unscoped',
      'members_only',
    );
    const member = await consumerMember('entitle-orphan-member@velora.test');

    const read = await readProtected(member, orphan.id);

    // Marked private with nobody to admit. It stays unreachable rather than
    // falling through to public.
    expect(read.status).toBe(404);
    expect((await handle(catalogRequest(creator.handle))).status).toBe(200);
  });

  it('reports what a member holds without naming anybody else', async () => {
    const { creator, member } = await admitted('entitle-access');

    const response = await handle(consumerRequest('/v1/clubs/access', member));
    const body = (await response.json()) as {
      access: Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    expect(Object.keys(body.access[0] ?? {}).toSorted()).toEqual([
      'clubId',
      'clubName',
      'clubSlug',
      'creatorHandle',
      'grantedAt',
      'source',
      'state',
    ]);
    expect(body.access[0]?.creatorHandle).toBe(creator.handle);
  });
});

describe('club audience isolation', () => {
  it('refuses a Creator Studio session at the member routes and the reverse', async () => {
    const creator = await publishedCreator(
      'club-audience@velora.test',
      'club-audience',
    );
    const club = await publishedClub(creator.studio, 'audience');
    const issued = await issueInvite(creator.studio, club);
    const member = await consumerMember('club-audience-member@velora.test');

    // A creator session cannot redeem: the member routes require a consumer
    // audience, and Studio is not one.
    const creatorRedeeming = await handle(
      new Request('http://api.test/v1/clubs/redemptions', {
        body: JSON.stringify({ secret: issued.secret }),
        headers: {
          'content-type': 'application/json',
          cookie: creator.studio.cookie,
          origin: testCreatorOrigin,
          'x-velora-csrf': creator.studio.csrf,
        },
        method: 'POST',
      }),
    );
    // A consumer session cannot administer a club.
    const memberAdministering = await handle(
      new Request('http://api.test/v1/creator/clubs', {
        body: JSON.stringify({ name: 'Mine now', slug: 'mine-now' }),
        headers: {
          'content-type': 'application/json',
          cookie: member.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': member.csrf,
        },
        method: 'POST',
      }),
    );

    expect(creatorRedeeming.status).toBe(403);
    expect(memberAdministering.status).toBe(403);
  });

  it('never lets one creator operate another creator club', async () => {
    const first = await publishedCreator(
      'club-own-a@velora.test',
      'club-own-a',
    );
    const second = await publishedCreator(
      'club-own-b@velora.test',
      'club-own-b',
    );
    const theirs = await publishedClub(first.studio, 'theirs');

    const invited = await handle(
      studioRequest('/v1/creator/clubs/invites', second.studio, {
        body: { clubId: theirs.id },
        method: 'POST',
      }),
    );
    const members = await handle(
      studioRequest(
        `/v1/creator/clubs/members?clubId=${theirs.id}`,
        second.studio,
      ),
    );
    const transitioned = await setClubLifecycle(
      second.studio,
      theirs,
      'closed',
    );

    expect(invited.status).toBe(409);
    expect(members.status).toBe(404);
    expect(transitioned.status).toBe(409);
  });

  /**
   * A creator can read back which club an item belongs to; a visitor cannot.
   *
   * The distinction is load-bearing rather than cosmetic. A members-only item
   * with no club has nobody to admit and is reachable by nobody at all, so its
   * creator has to be able to tell the two apart — and a visitor learning which
   * room an item belongs to would be learning about a room they are not in.
   */
  it('tells a creator which club an item belongs to and a visitor nothing', async () => {
    const creator = await publishedCreator(
      'clubs-association@velora.test',
      'association-test',
    );
    const club = await publishedClub(creator.studio, 'association');
    const item = await clubItem(creator.studio, club, 'For members');

    expect(item.clubId).toBe(club.id);

    // The same item read back through the list, not merely echoed by the write.
    const listed = (await (
      await handle(studioRequest('/v1/creator/content', creator.studio))
    ).json()) as { content: ContentItem[] };
    expect(listed.content[0]?.clubId).toBe(club.id);

    // An item with no club carries no club, rather than carrying a null.
    const unattached = await firstOf(
      await saveContent(creator.studio, {
        title: 'For everybody',
        visibility: 'public',
      }),
    );
    expect(unattached.clubId).toBeUndefined();

    const visitorCatalog = await (
      await handle(
        new Request(
          `http://api.test/v1/creators/catalog?handle=${creator.handle}`,
        ),
      )
    ).text();
    expect(visitorCatalog).not.toContain(club.id);
    expect(visitorCatalog).not.toContain('clubId');
  });

  it('shows a visitor club metadata and nothing about who is in it', async () => {
    const { creator } = await (async () => {
      const creator = await publishedCreator(
        'club-public@velora.test',
        'club-public',
      );
      const club = await publishedClub(creator.studio, 'public-room');
      const issued = await issueInvite(creator.studio, club);
      const member = await consumerMember('club-public-member@velora.test');
      await redeem(member, issued.secret);
      return { creator };
    })();

    const response = await handle(
      new Request(`http://api.test/v1/creators/clubs?handle=${creator.handle}`),
    );
    const body = (await response.json()) as {
      clubs: Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    // The identifier is published so a visitor can join a club to what it
    // costs, which BILLING publishes against the same opaque reference. The
    // benefits are what its creator promises. Neither says anything about who
    // is in it, and neither is a price.
    expect(Object.keys(body.clubs[0] ?? {}).toSorted()).toEqual([
      'benefits',
      'id',
      'name',
      'slug',
    ]);
    const serialized = JSON.stringify(body);
    for (const absent of [
      'memberCount',
      'members',
      'invite',
      'secret',
      'price',
      'subscribe',
      'lifecycle',
      'version',
    ]) {
      expect(serialized, absent).not.toContain(absent);
    }
  });
});

describe('the database enforces the club invariants', () => {
  it('permits one live entitlement per person per club and allows re-admission', async () => {
    const creator = await publishedCreator(
      'club-uniq@velora.test',
      'club-uniq',
    );
    const club = await publishedClub(creator.studio, 'uniq');
    const member = await consumerMember('club-uniq-member@velora.test');
    const first = await issueInvite(creator.studio, club);
    await redeem(member, first.secret);

    const rows = await rowsOf<{ member_id: string }>(
      database.sql`select member_id from clubs_memberships where state = 'active'`,
    );
    let duplicateRefused = false;
    try {
      await execute(
        database.sql`insert into clubs_memberships
          (club_id, granted_at, id, member_id, source, state, updated_at)
          values (${club.id}, now(), ${crypto.randomUUID()}, ${rows[0]?.member_id ?? ''}, 'creator_invite', 'active', now())`,
      );
    } catch {
      duplicateRefused = true;
    }
    expect(duplicateRefused).toBe(true);

    // Revoking frees the slot, and the record of the first stays.
    await execute(
      database.sql`update clubs_memberships set state = 'revoked', revoked_at = now()`,
    );
    const second = await issueInvite(creator.studio, club);
    const readmitted = await redeem(member, second.secret);
    expect(readmitted.status).toBe(200);
    expect(
      await rowsOf(database.sql`select 1 from clubs_memberships`),
    ).toHaveLength(2);
  });

  it('refuses an invitation that is both redeemed and revoked', async () => {
    const creator = await publishedCreator(
      'club-invite-shape@velora.test',
      'club-shape',
    );
    const club = await publishedClub(creator.studio, 'shape');
    const issued = await issueInvite(creator.studio, club);

    let refused = false;
    try {
      await execute(
        database.sql`update clubs_invites
          set redeemed_at = now(), redeemed_by = ${crypto.randomUUID()}, revoked_at = now()
          where id = ${issued.invite.id}`,
      );
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});
