import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { IntroductionRepository } from '../../src/discovery/introductions.js';
import { DiscoveryPeerVisibility } from '../../src/discovery/peer-visibility.js';
import { EmptyIdentityAdultAssuranceReader } from '../../src/identity/assurance-reader.js';
import { RoutedMediaAssociation } from '../../src/media/publication.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { SafetyDirectory } from '../../src/safety/directory.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { ConsumerDirectory } from '../../src/users/directory.js';
import { ConsumerProfileMediaAssociation } from '../../src/users/profile-media-association.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  provisionDatabase,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminRuntime,
  testBillingRuntime,
  testClubsRuntime,
  testConsumerOrigin,
  testCreatorsRuntime,
  testDatabaseAdmission,
  testIdentityRuntime,
  testMediaRuntime,
  testNotificationsApiRuntime,
  testPayoutsRuntime,
  testServerConfig,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

/**
 * Who may actually be shown somebody else's photograph.
 *
 * The media platform could already decide this and nothing could ask it. USERS
 * entitled only the owner, with a comment saying the peer question belonged to
 * DISCOVERY, and no route existed that turned an asset reference into an
 * address at all. Every projection on every consumer surface therefore carried
 * image references nothing could fetch.
 *
 * These tests hold the answer to what the product actually needs and no more: a
 * person you can currently be introduced to, or already have been, and nobody
 * else. They run against the real application through the real route, because
 * the interesting failures here are composition failures — a port wired to the
 * wrong domain's answer denies nothing and everything equally well in a unit
 * test with a stub.
 */

const databaseUrl = await provisionDatabase('velora_media_consumer_delivery');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({ ...mediaEnvironment });
const now = () => new Date();
const logger = silentLogger();

let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `media-delivery-test-${String(requesterSequence)}`;
    },
  },
});

// The composition under test, in the order the application composes it: USERS'
// directory first because MEDIA's association adapter needs it, then the
// relationship rule DISCOVERY owns, then the adapter, then MEDIA.
const consumerDirectory = new ConsumerDirectory(
  database.drizzle,
  new EmptyIdentityAdultAssuranceReader(),
);
const profileMediaAssociation = new ConsumerProfileMediaAssociation(
  new DiscoveryPeerVisibility({
    directory: consumerDirectory,
    introductions: new IntroductionRepository(database.drizzle),
    safety: new SafetyDirectory(new SafetyRepository(database.drizzle)),
  }),
);
const mediaRuntime = testMediaRuntime({
  association: new RoutedMediaAssociation({ users: profileMediaAssociation }),
  config,
  database: database.drizzle,
  logger,
  now,
  // Enforcement-driven refusal is exercised in `media-delivery.test.ts` and
  // `media-takedown.test.ts` against the real bridge. What is under test here
  // is the relationship rule, so the safety term is held open rather than
  // simulated: a refusal in these tests can only have come from the rule.
  safety: { mayDeliver: () => Promise.resolve(true) },
});

const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  directory: consumerDirectory,
  logger,
  media: mediaRuntime.service,
  now,
});
const safety = createSafetyRuntime({
  accounts: users.enforcement,
  catalog: new ClubSafetyDirectory(),
  config,
  consumerContext: users.consumerContext,
  consumers: users.existence,
  conversationTargets: new ConversationParticipation(),
  conversations: new ConversationEnforcement(database.drizzle),
  creators: new CreatorDirectory(),
  database: database.drizzle,
  now,
  users: users.service,
});
const discovery = createDiscoveryRuntime({
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  logger,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
});
const messaging = createMessagingRuntime({
  config,
  connections: discovery.connections,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  now,
  onboarding: users.onboarding,
});
const creators = testCreatorsRuntime({
  caller: auth.caller,
  database: database.drizzle,
  now,
  users,
});
const clubsRuntime = testClubsRuntime({
  config,
  creators,
  database: database.drizzle,
  now,
  users,
});
const billingRuntime = testBillingRuntime({
  clubs: clubsRuntime,
  config,
  creators,
  database: database.drizzle,
  users,
});
const application = createApplication({
  config,
  dependencies: {
    admin: testAdminRuntime({
      billing: billingRuntime,
      caller: auth.caller,
      config,
      clubs: clubsRuntime,
      creators,
      media: mediaRuntime,
      safety,
    }),
    auth,
    billing: billingRuntime,
    clubs: clubsRuntime,
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    identity: testIdentityRuntime({
      config,
      database: database.drizzle,
      logger,
      now,
    }),
    logger,
    media: mediaRuntime,
    messaging,
    notifications: testNotificationsApiRuntime({
      database: database.drizzle,
      now,
      safety,
      users,
    }),
    payouts: testPayoutsRuntime({
      config,
      creators,
      database: database.drizzle,
    }),
    queueRedis: healthy,
    safety,
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

interface Credentials {
  readonly assetId: string;
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

function post(path: string, credentials: Credentials, body: unknown): Request {
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

/** The delivery request one consumer makes about another's image. */
async function deliveries(
  caller: Credentials | undefined,
  assetIds: readonly string[],
  variant:
    'avatar_small' | 'avatar_large' | 'card' | 'display' = 'avatar_large',
): Promise<{
  readonly body: {
    readonly deliveries: readonly {
      readonly assetId: string;
      readonly expiresAt?: string;
      readonly url: string;
    }[];
  };
  readonly status: number;
}> {
  const request =
    caller === undefined
      ? new Request('http://api.test/v1/media/deliveries', {
          body: JSON.stringify({ assetIds: [...assetIds], variant }),
          headers: {
            'content-type': 'application/json',
            origin: testConsumerOrigin,
          },
          method: 'POST',
        })
      : post('/v1/media/deliveries', caller, {
          assetIds: [...assetIds],
          variant,
        });
  const response = await handle(request);
  return {
    body: (await response.json()) as {
      readonly deliveries: readonly {
        readonly assetId: string;
        readonly expiresAt?: string;
        readonly url: string;
      }[];
    },
    status: response.status,
  };
}

async function consumer(input: {
  readonly available?: boolean;
  readonly discoverable?: boolean;
  readonly languages?: readonly string[];
  readonly region?: string;
  readonly subject: string;
}): Promise<Credentials> {
  const signIn = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({
        audience: 'consumer_web',
        subject: input.subject,
      }),
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
  const created = await handle(
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
  const caller: Credentials = {
    assetId: '',
    cookie,
    csrf: session.csrfToken,
    id: account.id,
  };

  await handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: input.region ?? 'DE',
    }),
  );
  await handle(
    post('/v1/users/me/onboarding/acknowledgements', caller, {
      acknowledgements: requiredPolicyDocuments.map((document) => ({
        key: document.key,
        version: document.version,
      })),
    }),
  );
  await handle(
    post('/v1/users/me/profile', caller, {
      displayName: input.subject.split('@')[0] ?? 'Consumer',
      languages: [...(input.languages ?? ['de'])],
    }),
  );
  const upload = await handle(post('/v1/users/me/profile/media', caller, {}));
  const slot = (await upload.json()) as { mediaId: string };
  await readyProfileImage({
    database,
    media: mediaRuntime,
    assetId: slot.mediaId,
    users,
  });
  if (input.discoverable !== false) {
    await handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
  }
  if (input.available !== false) {
    await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: new Date(now().getTime() + 3_600_000).toISOString(),
        state: 'available',
      }),
    );
  }

  const profile = await handle(
    new Request('http://api.test/v1/users/me/profile', {
      headers: { cookie, origin: testConsumerOrigin },
    }),
  );
  const body = (await profile.json()) as {
    readonly media: readonly { readonly id: string }[];
  };
  const assetId = body.media[0]?.id;
  if (assetId === undefined) throw new Error('profile image was not ready');
  return { ...caller, assetId };
}

describe('an address is issued only to somebody with a live reason', () => {
  it('serves an owner their own image', async () => {
    const alone = await consumer({ subject: 'owner@velora.test' });

    const result = await deliveries(alone, [alone.assetId]);

    expect(result.status).toBe(200);
    expect(result.body.deliveries).toHaveLength(1);
    expect(result.body.deliveries[0]?.assetId).toBe(alone.assetId);
  });

  it('serves a candidate the viewer may currently be introduced to', async () => {
    const viewer = await consumer({ subject: 'viewer@velora.test' });
    const candidate = await consumer({ subject: 'candidate@velora.test' });

    const result = await deliveries(viewer, [candidate.assetId]);

    expect(result.body.deliveries).toHaveLength(1);
    expect(result.body.deliveries[0]?.assetId).toBe(candidate.assetId);
  });

  it('refuses somebody who shares no language, exactly as discovery does', async () => {
    const viewer = await consumer({
      languages: ['de'],
      subject: 'german@velora.test',
    });
    const stranger = await consumer({
      languages: ['ja'],
      subject: 'japanese@velora.test',
    });

    const result = await deliveries(viewer, [stranger.assetId]);

    expect(result.status).toBe(200);
    expect(result.body.deliveries).toHaveLength(0);
  });

  it('refuses somebody who has turned discoverability off', async () => {
    const viewer = await consumer({ subject: 'looker@velora.test' });
    const hidden = await consumer({
      discoverable: false,
      subject: 'hidden@velora.test',
    });

    expect(
      (await deliveries(viewer, [hidden.assetId])).body.deliveries,
    ).toEqual([]);
  });

  it('refuses a caller with no session at all', async () => {
    const someone = await consumer({ subject: 'private@velora.test' });

    const result = await deliveries(undefined, [someone.assetId]);

    expect(result.status).toBe(200);
    expect(result.body.deliveries).toEqual([]);
  });
});

describe('a relationship outlives eligibility', () => {
  it('keeps serving a counterpart whose availability window has closed', async () => {
    const viewer = await consumer({ subject: 'first@velora.test' });
    const other = await consumer({ subject: 'second@velora.test' });

    // A mutual introduction: both sides signalled.
    await handle(
      post('/v1/discovery/introductions', viewer, { candidateId: other.id }),
    );
    await handle(
      post('/v1/discovery/introductions', other, { candidateId: viewer.id }),
    );
    // The counterpart stops being a candidate to anybody.
    await handle(
      post('/v1/users/me/availability', other, { state: 'unavailable' }),
    );

    expect(
      (await deliveries(viewer, [other.assetId])).body.deliveries,
    ).toHaveLength(1);
  });

  it('serves a pending signal in the direction that did not send it', async () => {
    const initiator = await consumer({ subject: 'sender@velora.test' });
    const recipient = await consumer({ subject: 'receiver@velora.test' });

    await handle(
      post('/v1/discovery/introductions', initiator, {
        candidateId: recipient.id,
      }),
    );
    await handle(
      post('/v1/users/me/preferences', initiator, { discoverable: false }),
    );

    // The recipient can see somebody who has since hidden themselves, because
    // the pending signal is a live reason of its own.
    expect(
      (await deliveries(recipient, [initiator.assetId])).body.deliveries,
    ).toHaveLength(1);
  });
});

describe('safety withdraws imagery in both directions', () => {
  it('stops serving the person a viewer blocked', async () => {
    const viewer = await consumer({ subject: 'blocker@velora.test' });
    const other = await consumer({ subject: 'blocked@velora.test' });
    await handle(
      post('/v1/discovery/introductions', viewer, { candidateId: other.id }),
    );
    await handle(
      post('/v1/discovery/introductions', other, { candidateId: viewer.id }),
    );
    expect(
      (await deliveries(viewer, [other.assetId])).body.deliveries,
    ).toHaveLength(1);

    await handle(post('/v1/safety/blocks', viewer, { targetId: other.id }));

    expect((await deliveries(viewer, [other.assetId])).body.deliveries).toEqual(
      [],
    );
    // And the other way round, which the blocked person never asked for and
    // must not be able to detect as anything other than absence.
    expect((await deliveries(other, [viewer.assetId])).body.deliveries).toEqual(
      [],
    );
  });
});

describe('the response cannot be used to learn anything', () => {
  it('answers an unknown identifier exactly as it answers a forbidden one', async () => {
    const viewer = await consumer({ subject: 'prober@velora.test' });
    const hidden = await consumer({
      discoverable: false,
      subject: 'target@velora.test',
    });

    const unknown = await deliveries(viewer, [
      '99999999-9999-4999-8999-999999999999',
    ]);
    const forbidden = await deliveries(viewer, [hidden.assetId]);

    expect(unknown.status).toBe(forbidden.status);
    expect(unknown.body).toEqual(forbidden.body);
  });

  it('bounds the work a single call can ask for', async () => {
    const viewer = await consumer({ subject: 'greedy@velora.test' });
    const tooMany = Array.from(
      { length: 25 },
      (_, index) =>
        `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`,
    );

    const response = await handle(
      post('/v1/media/deliveries', viewer, {
        assetIds: tooMany,
        variant: 'avatar_large',
      }),
    );

    expect(response.status).toBe(422);
  });

  it('charges a repeated identifier once', async () => {
    const viewer = await consumer({ subject: 'repeat@velora.test' });
    const candidate = await consumer({ subject: 'repeated@velora.test' });

    const result = await deliveries(viewer, [
      candidate.assetId,
      candidate.assetId,
      candidate.assetId,
    ]);

    expect(result.body.deliveries).toHaveLength(1);
  });
});

describe('an address is a bounded credential', () => {
  it('carries the instant it stops working', async () => {
    const viewer = await consumer({ subject: 'holder@velora.test' });
    const candidate = await consumer({ subject: 'held@velora.test' });

    const [delivery] = (await deliveries(viewer, [candidate.assetId])).body
      .deliveries;

    expect(delivery?.expiresAt).toBeDefined();
    expect(new Date(delivery?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      now().getTime(),
    );
  });

  it('addresses one variant, and a second request for another is a different address', async () => {
    const viewer = await consumer({ subject: 'sizes@velora.test' });
    const candidate = await consumer({ subject: 'sized@velora.test' });

    const small = await deliveries(viewer, [candidate.assetId], 'avatar_small');
    const large = await deliveries(viewer, [candidate.assetId], 'avatar_large');

    expect(small.body.deliveries[0]?.url).not.toBe(
      large.body.deliveries[0]?.url,
    );
  });
});
