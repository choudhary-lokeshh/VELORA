import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  commonLanguage,
  consumers,
  creators,
  subjectFor,
} from './seed-fixtures.mjs';
import { assertLocalSeedTarget } from './seed-safety.mjs';

/**
 * Fills a local VELORA with people, creators, pictures, and the relationships
 * between them: `bun run dev:seed`.
 *
 * ## Everything goes through the API
 *
 * There is no database connection in this file and there never may be. Every
 * account, declaration, acknowledgement, profile, photograph, preference,
 * availability window, introduction, message, page, catalog item, club, and
 * invitation below is created by calling the same HTTP routes a browser calls,
 * in the same order, with the same refusals. That is what makes a seeded world
 * evidence about the product rather than about a script's idea of the product:
 * a rule the API enforces stops this script too, and a route that does not exist
 * cannot be worked around here.
 *
 * The Android freeze report records what the alternative looks like. A profile
 * photograph had to be written straight into the database to get a walk past
 * onboarding, because the development storage adapter had no transport. It has
 * one now, so this asks for a capability, writes bytes to the address the
 * platform issues, and confirms — three calls, exactly as a person's browser
 * makes them.
 *
 * ## It is local-only, and structurally so
 *
 * The imported guard refuses anything but a loopback API in a local environment.
 * That is the polite half. The structural half is that a deployed environment
 * has no storage provider, no local sign-in adapter, and no notification
 * channel — configuration refuses every one of them outside local and test — so
 * this script cannot produce a seeded account anywhere it should not, whatever
 * anybody points it at.
 *
 * ## It is idempotent, and it never resets anything
 *
 * Running it twice produces the same world rather than two of it: identities are
 * derived from the fixture, an account that exists is signed into rather than
 * recreated, and work already done is skipped. Nothing here truncates, deletes,
 * or overwrites a developer's own accounts — a seeded world lives beside
 * whatever else is in the database.
 *
 * Re-running is also how the world comes back to life. An availability window is
 * capped at twenty-four hours by product policy, so a world seeded yesterday has
 * an empty Discover today. That is the product being honest rather than the seed
 * being incomplete, and the fix is to run this again.
 */

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** How long a seeded person stays visible. The product's own ceiling. */
const availabilityHours = 24;

/** How long to wait for the worker to decide what a batch of uploads is. */
const imageReadyTimeoutMilliseconds = 240_000;

function environment() {
  const values = new Map();
  try {
    const text = readFileSync(resolve(repositoryRoot, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  } catch {
    // No local environment file is not an error here; the defaults below are
    // the same ones the surfaces use.
  }
  return values;
}

const fileEnvironment = environment();
const apiBaseUrl = (
  process.env.VELORA_API_BASE_URL ??
  fileEnvironment.get('VELORA_API_BASE_URL') ??
  'http://127.0.0.1:4000'
).replace(/\/+$/u, '');
const consumerOrigin =
  process.env.AUTH_BROWSER_ORIGINS_CONSUMER_WEB ??
  fileEnvironment.get('AUTH_BROWSER_ORIGINS_CONSUMER_WEB') ??
  'http://127.0.0.1:3000';
const creatorOrigin =
  process.env.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO ??
  fileEnvironment.get('AUTH_BROWSER_ORIGINS_CREATOR_STUDIO') ??
  'http://127.0.0.1:3001';

function guard() {
  const appEnvironment =
    process.env.VELORA_APP_ENV ??
    fileEnvironment.get('VELORA_APP_ENV') ??
    'local';
  assertLocalSeedTarget({ apiBaseUrl, appEnvironment });
}

const started = Date.now();
function say(message) {
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  process.stdout.write(`  [${seconds.padStart(3)}s] ${message}\n`);
}

/**
 * One signed-in caller, holding its own cookies exactly as a browser would.
 *
 * Cookies are kept per caller rather than in one jar, because two seeded people
 * acting in the same process must not become one person with a shared session —
 * which is the bug that would make every introduction below meaningless.
 */
function caller(origin, device) {
  const jar = new Map();

  const absorb = (response) => {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator === -1) continue;
      jar.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  };

  const call = async (method, path, body, extraHeaders = {}) => {
    // A device per seeded person, because the sign-in rate limiter attributes
    // attempts to one. Thirty-two people signing in as one device is one
    // requester making thirty-two attempts, which is exactly what that limiter
    // exists to stop — and stopping it here would be the limiter working.
    const headers = { origin, 'x-velora-device': device, ...extraHeaders };
    if (jar.size > 0) {
      headers.cookie = [...jar]
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }
    const csrf =
      jar.get('__Host-velora_consumer_web_csrf') ??
      jar.get('__Host-velora_creator_studio_csrf');
    if (csrf !== undefined && method !== 'GET') headers['x-velora-csrf'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers,
      method,
    });
    absorb(response);
    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) : undefined;
    return { body: parsed, ok: response.ok, status: response.status };
  };

  return {
    call,
    /** The same call, but a refusal is a failure rather than a value. */
    async must(method, path, body, extraHeaders = {}) {
      const answer = await call(method, path, body, extraHeaders);
      if (!answer.ok) {
        throw new Error(
          `${method} ${path} -> ${String(answer.status)} ${JSON.stringify(answer.body)}`,
        );
      }
      return answer.body;
    },
  };
}

async function signIn(audience, subject) {
  const origin = audience === 'consumer_web' ? consumerOrigin : creatorOrigin;
  const session = caller(origin, `seed-${audience}-${subject}`);
  await session.must('POST', '/v1/auth/local/web-sessions', {
    audience,
    subject,
  });
  return session;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((settle) => setTimeout(settle, 1000));
  }
  throw new Error(
    `The API at ${apiBaseUrl} did not become ready. Is \`bun run dev\` running?`,
  );
}

/**
 * A picture, generated from the fixture that asks for it.
 *
 * Two colours and a few soft shapes, deterministic in both. It is not a
 * photograph of anybody and is not meant to look like one: the platform's rules
 * forbid a real person's likeness in seeded data, and a plausible face would be
 * exactly that. What it does do is exercise the whole pipeline — a real decode,
 * a real orientation pass, three real resizes — and give every surface something
 * with genuine colour in it to lay out.
 */
async function picture(tone, variation) {
  const [from, to] = tone;
  const width = 1200;
  const height = 1500;
  const seed = variation * 37;
  const circles = Array.from({ length: 5 }, (_, index) => {
    const x = ((seed + index * 211) % 100) / 100;
    const y = ((seed + index * 137) % 100) / 100;
    const r = 120 + ((seed + index * 89) % 260);
    const opacity = 0.06 + ((seed + index * 53) % 12) / 100;
    return `<circle cx="${String(Math.round(x * width))}" cy="${String(
      Math.round(y * height),
    )}" r="${String(r)}" fill="#ffffff" opacity="${opacity.toFixed(2)}" />`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}" />
        <stop offset="1" stop-color="${to}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
    ${circles}
  </svg>`;
  // Rasterised here and encoded as JPEG, because the platform's format
  // allow-list is applied to sniffed bytes and deliberately excludes SVG.
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/** Reserve, write the bytes, confirm. The three calls every image goes through. */
async function upload(
  session,
  reservePath,
  reserveBody,
  completionPath,
  bytes,
) {
  const capability = await session.must('POST', reservePath, reserveBody);
  const written = await fetch(capability.uploadUrl, {
    body: bytes,
    headers: capability.uploadHeaders,
    method: capability.method,
  });
  if (!written.ok) {
    throw new Error(`upload -> ${String(written.status)}`);
  }
  await session.must('POST', completionPath, { mediaId: capability.mediaId });
  return capability.mediaId;
}

/** A consumer with a complete, discoverable, currently available profile. */
async function seedConsumer(fixture, index) {
  const subject = subjectFor('person', index);
  const session = await signIn('consumer_web', subject);

  let account = await session.call('GET', '/v1/users/me');
  if (!account.ok) {
    account = { body: await session.must('POST', '/v1/users', {}) };
  }

  const onboarding = await session.must('GET', '/v1/users/me/onboarding');
  if (onboarding.step === 'adult_declaration') {
    await session.must('POST', '/v1/users/me/onboarding/adult-declaration', {
      declaresAdult: true,
      region: fixture.region,
    });
  }
  const afterDeclaration = await session.must('GET', '/v1/users/me/onboarding');
  if (afterDeclaration.outstandingPolicies.length > 0) {
    await session.must('POST', '/v1/users/me/onboarding/acknowledgements', {
      acknowledgements: afterDeclaration.outstandingPolicies.map((one) => ({
        key: one.key,
        version: one.version,
      })),
    });
  }

  const profile = await session.must('GET', '/v1/users/me/profile');
  await session.must('POST', '/v1/users/me/profile', {
    ...(fixture.bio.length === 0 ? {} : { bio: fixture.bio }),
    displayName: fixture.displayName,
    ...(profile.version === undefined
      ? {}
      : { expectedVersion: profile.version }),
    languages: [commonLanguage, ...fixture.languages],
  });

  // What this person says about themselves, through the one route that takes
  // it. A fixture with no declaration is left with none: "never asked" is a
  // real state a paid filter has to handle, and it is the state every existing
  // account is in.
  if (fixture.matchingGender !== undefined) {
    await session.must('POST', '/v1/users/me/matching-gender', {
      matchingGender: fixture.matchingGender,
    });
  }

  const live = profile.media.filter((one) => one.state !== 'removed');
  if (live.length === 0) {
    await upload(
      session,
      '/v1/users/me/profile/media',
      {},
      '/v1/users/me/profile/media/completion',
      await picture(fixture.tone, index),
    );
  }

  return { fixture, id: account.body.id, session, subject };
}

/** Waits until every seeded person has a photograph the platform accepted. */
async function waitForConsumerImages(people) {
  const deadline = Date.now() + imageReadyTimeoutMilliseconds;
  const waiting = new Set(people);
  while (waiting.size > 0 && Date.now() < deadline) {
    for (const person of [...waiting]) {
      const profile = await person.session.must('GET', '/v1/users/me/profile');
      const states = profile.media.map((one) => one.state);
      if (states.includes('ready')) {
        waiting.delete(person);
        continue;
      }
      if (states.every((state) => state === 'rejected')) {
        throw new Error(
          `${person.fixture.displayName}: every image was refused`,
        );
      }
    }
    if (waiting.size > 0) {
      say(`waiting on ${String(waiting.size)} picture(s)`);
      await new Promise((settle) => setTimeout(settle, 2500));
    }
  }
  if (waiting.size > 0) {
    throw new Error(
      'Pictures never became ready. Is the worker running under `bun run dev`?',
    );
  }
}

/** Discoverability is refused until the minimum profile is genuinely complete. */
async function makeVisible(people) {
  for (const person of people) {
    const profile = await person.session.must('GET', '/v1/users/me/profile');
    if (!profile.discoverable) {
      await person.session.must('POST', '/v1/users/me/preferences', {
        discoverable: true,
        ...(profile.preferencesVersion === undefined
          ? {}
          : { expectedVersion: profile.preferencesVersion }),
      });
    }
    await person.session.must('POST', '/v1/users/me/availability', {
      availableUntil: new Date(
        Date.now() + availabilityHours * 60 * 60 * 1000 - 60_000,
      ).toISOString(),
      state: 'available',
    });
  }
}

/**
 * The social graph, built out of the same two decisions a person makes.
 *
 * A mutual introduction is both people signalling, and nothing else produces
 * one. A pending one is a single signal, which is what somebody sees waiting for
 * them. Every pair below is a fixed pair of indices, so the world is the same
 * world on every machine.
 */
const mutualPairs = [
  [0, 1],
  [0, 4],
  [2, 3],
  [5, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
];
const pendingPairs = [
  [1, 15],
  [16, 0],
  [17, 2],
  [3, 18],
  [19, 5],
  [20, 6],
];
const blockedPairs = [[21, 22]];

const conversationOpeners = [
  'Hello — your profile made me laugh, which is a good start.',
  'Hi. I have been looking for somebody to argue about films with.',
  'Hello. Long shot, but do you also do the six a.m. thing?',
  'Hi — what are you working on at the moment?',
  'Hello. I am terrible at these first messages, so: hello.',
];
const conversationReplies = [
  'Hello back. What made you say yes?',
  'Hi — I do, and it is a lonely business. Tell me more.',
  'Ha. It worked, then. How is your week going?',
];

async function seedRelationships(people) {
  const introductions = new Map();
  for (const [left, right] of mutualPairs) {
    const one = people[left];
    const other = people[right];
    if (one === undefined || other === undefined) continue;
    const first = await one.session.call(
      'POST',
      '/v1/discovery/introductions',
      {
        candidateId: other.id,
      },
    );
    const second = await other.session.call(
      'POST',
      '/v1/discovery/introductions',
      {
        candidateId: one.id,
      },
    );
    if (second.ok && second.body.state === 'mutual') {
      introductions.set(second.body.id, { one, other });
    } else if (first.ok && first.body.state === 'mutual') {
      introductions.set(first.body.id, { one, other });
    }
  }
  for (const [from, to] of pendingPairs) {
    const one = people[from];
    const other = people[to];
    if (one === undefined || other === undefined) continue;
    await one.session.call('POST', '/v1/discovery/introductions', {
      candidateId: other.id,
    });
  }
  for (const [from, to] of blockedPairs) {
    const one = people[from];
    const other = people[to];
    if (one === undefined || other === undefined) continue;
    await one.session.call('POST', '/v1/safety/blocks', { targetId: other.id });
  }
  return introductions;
}

/** Conversations, opened the only way one can be: from a mutual introduction. */
async function seedConversations(introductions) {
  let messages = 0;
  let opened = 0;
  let index = 0;
  for (const [introductionId, pair] of introductions) {
    const conversation = await pair.one.session.call(
      'POST',
      '/v1/messaging/conversations',
      { introductionId },
    );
    if (!conversation.ok) continue;
    opened += 1;
    const conversationId = conversation.body.id;
    const opener = conversationOpeners[index % conversationOpeners.length];
    const reply = conversationReplies[index % conversationReplies.length];
    const sent = await pair.one.session.call('POST', '/v1/messaging/messages', {
      body: opener,
      clientMessageId: `seed-${conversationId}-1`,
      conversationId,
    });
    if (sent.ok) messages += 1;
    // Not every conversation gets an answer, because not every real one does,
    // and a list where every thread is symmetrical hides what an unanswered one
    // looks like.
    if (index % 3 !== 2) {
      const answered = await pair.other.session.call(
        'POST',
        '/v1/messaging/messages',
        {
          body: reply,
          clientMessageId: `seed-${conversationId}-2`,
          conversationId,
        },
      );
      if (answered.ok) messages += 1;
    }
    index += 1;
  }
  return { messages, opened };
}

/** A creator: a consumer account, a capability, a published page, and imagery. */
async function seedCreator(fixture, index) {
  const subject = subjectFor('creator', index);
  const consumerSession = await signIn('consumer_web', subject);
  const foundAccount = await consumerSession.call('GET', '/v1/users/me');
  if (!foundAccount.ok) await consumerSession.must('POST', '/v1/users', {});
  const account = await consumerSession.must('GET', '/v1/users/me');
  if (account.region !== fixture.region) {
    await consumerSession.must(
      'POST',
      '/v1/users/me/onboarding/adult-declaration',
      {
        declaresAdult: true,
        region: fixture.region,
      },
    );
  }

  const studio = await signIn('creator_studio', subject);
  const capability = await studio.call('GET', '/v1/creator/me');
  if (!capability.ok) await studio.must('POST', '/v1/creator', {});
  const creatorOnboarding = await studio.must('GET', '/v1/creator/onboarding');
  if (creatorOnboarding.outstandingPolicies.length > 0) {
    await studio.must('POST', '/v1/creator/onboarding/acknowledgements', {
      acknowledgements: creatorOnboarding.outstandingPolicies.map((one) => ({
        key: one.key,
        version: one.version,
      })),
    });
  }

  const existing = await studio.call('GET', '/v1/creator/profile');
  const saved = await studio.must('POST', '/v1/creator/profile', {
    bio: fixture.bio,
    displayName: fixture.displayName,
    handle: fixture.handle,
    links: fixture.links,
    ...(existing.ok ? { version: existing.body.version } : {}),
  });
  if (saved.publication !== 'published') {
    await studio.must('POST', '/v1/creator/profile/publication', {
      publication: 'published',
      version: saved.version,
    });
  }

  const profile = await studio.must('GET', '/v1/creator/profile');
  const slots = new Set(profile.media.map((one) => one.slot));
  for (const [slot, variation] of [
    ['avatar', index * 3],
    ['cover', index * 3 + 1],
  ]) {
    if (slots.has(slot)) continue;
    await upload(
      studio,
      '/v1/creator/profile/media',
      { slot },
      '/v1/creator/profile/media/completion',
      await picture(fixture.tone, variation),
    );
  }

  await studio.must('POST', '/v1/creator/gifts/catalog/provision');

  return { fixture, studio, subject };
}

/** A creator's clubs, catalog, and the images on both. */
async function seedCreatorWork(creator, index) {
  const { fixture, studio } = creator;
  const clubsAnswer = await studio.must('GET', '/v1/creator/clubs');
  const clubsByName = new Map(
    clubsAnswer.clubs.map((club) => [club.name, club]),
  );
  const clubs = [];
  for (const [clubIndex, wanted] of fixture.clubs.entries()) {
    let club = clubsByName.get(wanted.name);
    if (club === undefined) {
      const created = await studio.must('POST', '/v1/creator/clubs', {
        benefits: wanted.benefits ?? [],
        description: wanted.description,
        name: wanted.name,
        slug: `${fixture.handle}-${String(clubIndex + 1)}`,
      });
      club = created.clubs[0];
    } else if ((club.benefits ?? []).length === 0 && wanted.benefits) {
      // A club seeded before benefits existed keeps everything else and gains
      // the lines its creator would have written. Re-running the seed is how a
      // world catches up rather than how it is replaced.
      const edited = await studio.call('POST', '/v1/creator/clubs', {
        benefits: wanted.benefits,
        description: wanted.description,
        clubId: club.id,
        name: club.name,
        slug: club.slug,
        version: club.version,
      });
      if (edited.ok) club = edited.body.clubs[0];
    }
    if (club !== undefined && club.lifecycle !== 'published') {
      const published = await studio.call(
        'POST',
        '/v1/creator/clubs/lifecycle',
        {
          clubId: club.id,
          lifecycle: 'published',
          version: club.version,
        },
      );
      if (published.ok) club = published.body.clubs[0];
    }
    if (club !== undefined) clubs.push(club);
  }

  const catalog = await studio.must('GET', '/v1/creator/content?pageSize=50');
  const byTitle = new Map(catalog.content.map((item) => [item.title, item]));
  let items = 0;
  let images = 0;
  for (const [itemIndex, wanted] of fixture.items.entries()) {
    let item = byTitle.get(wanted.title);
    if (item === undefined) {
      const created = await studio.must('POST', '/v1/creator/content', {
        ...(wanted.body === undefined ? {} : { body: wanted.body }),
        ...(wanted.members === true && clubs[0] !== undefined
          ? { clubId: clubs[0].id }
          : {}),
        ...(wanted.summary === undefined ? {} : { summary: wanted.summary }),
        title: wanted.title,
        visibility: wanted.members === true ? 'members_only' : 'public',
      });
      item = created.content[0];
    }
    if (item === undefined) continue;
    items += 1;

    const held = item.media.filter((one) => one.state !== 'removed').length;
    for (let picture_ = held; picture_ < (wanted.images ?? 0); picture_ += 1) {
      await upload(
        studio,
        '/v1/creator/content/media',
        { contentId: item.id },
        '/v1/creator/content/media/completion',
        await picture(fixture.tone, index * 17 + itemIndex * 5 + picture_),
      );
      images += 1;
    }

    const current = await studio.must('GET', '/v1/creator/content?pageSize=50');
    const fresh = current.content.find((one) => one.id === item.id);
    if (fresh !== undefined && fresh.lifecycle !== 'published') {
      await studio.call('POST', '/v1/creator/content/lifecycle', {
        contentId: fresh.id,
        lifecycle: 'published',
        version: fresh.version,
      });
    }
  }
  return { clubs, fixture, images, items, studio };
}

/** Invitations, and a few of them redeemed so a member exists to be one. */
async function seedMemberships(creatorWork, people) {
  let invited = 0;
  let redeemed = 0;
  let redeemer = 0;
  for (const { clubs, studio } of creatorWork) {
    for (const club of clubs) {
      const existing = await studio.must(
        'GET',
        `/v1/creator/clubs/invites?clubId=${encodeURIComponent(club.id)}`,
      );
      if (existing.invites.length > 0) {
        invited += existing.invites.length;
        redeemed += existing.invites.filter(
          (invite) => invite.redeemedAt !== undefined,
        ).length;
        continue;
      }

      const issued = await studio.call('POST', '/v1/creator/clubs/invites', {
        clubId: club.id,
      });
      if (!issued.ok) continue;
      invited += 1;
      // Every other invitation is used, so both an outstanding invitation and a
      // live membership exist to look at.
      if (invited % 2 === 1) continue;
      const member = people[redeemer % people.length];
      redeemer += 1;
      if (member === undefined) continue;
      const used = await member.session.call('POST', '/v1/clubs/redemptions', {
        secret: issued.body.secret,
      });
      if (used.ok) redeemed += 1;
    }
  }
  return { invited, redeemed };
}

/**
 * What each club costs, and a few people actually paying it.
 *
 * Every step is the product's own: the creator drafts an offer, publishes a
 * price, puts it on sale; a consumer starts a checkout and completes it on the
 * provider's own hosted page, exactly as a browser does. Nothing here writes a
 * subscription, a membership, or a journal entry — those are what the platform
 * does in response, and a seed that produced them directly would be evidence
 * about itself rather than about the product.
 *
 * The world it leaves behind has all four states somebody would want to look
 * at: a live membership, one scheduled to end, one whose payment was abandoned,
 * and clubs that are invitation-only because their creator never priced them.
 */
async function seedMembershipOffers(creatorWork) {
  const priced = [];
  for (const { clubs, fixture, studio } of creatorWork) {
    const existing = await studio.must('GET', '/v1/creator/offers?pageSize=50');
    const byResource = new Map(
      existing.offers.map((offer) => [offer.resourceId, offer]),
    );
    for (const [clubIndex, wanted] of fixture.clubs.entries()) {
      const club = clubs[clubIndex];
      // A club with no published terms is not a mistake. Invitation-only is a
      // real product and always has been.
      if (club === undefined || wanted.membership === undefined) continue;
      let offer = byResource.get(club.id);
      if (offer === undefined) {
        const created = await studio.call('POST', '/v1/creator/offers', {
          mode: 'subscription',
          resourceId: club.id,
          resourceType: 'club',
        });
        if (!created.ok) continue;
        offer = created.body.offer;
      }
      const live = offer.prices.filter((price) => price.state === 'active');
      const cadences = [
        { amountMinor: wanted.membership.monthlyMinor, interval: 'month' },
        ...(wanted.membership.yearlyMinor === undefined
          ? []
          : [
              {
                amountMinor: wanted.membership.yearlyMinor,
                interval: 'year',
              },
            ]),
      ];
      for (const cadence of cadences) {
        if (live.some((price) => price.interval === cadence.interval)) continue;
        const published = await studio.call(
          'POST',
          '/v1/creator/offers/prices',
          {
            amountMinor: cadence.amountMinor,
            currency: 'USD',
            interval: cadence.interval,
            offerId: offer.id,
          },
        );
        if (published.ok) offer = published.body.offer;
      }
      if (offer.state === 'draft') {
        const activated = await studio.call(
          'POST',
          '/v1/creator/offers/lifecycle',
          { offerId: offer.id, state: 'active', version: offer.version },
        );
        if (activated.ok) offer = activated.body.offer;
      }
      if (offer.state === 'active') {
        priced.push({ club, handle: fixture.handle, offer });
      }
    }
  }
  return priced;
}

/**
 * A few people actually joining, through checkout and the provider's own page.
 *
 * The consumer countries here are the ones the local-test commerce authority
 * publishes. Choosing a person who already declared one keeps the proof honest:
 * a seed that edited somebody's declared region to make a sale go through would
 * be demonstrating the seed rather than the gate.
 */
async function seedSubscriptions(priced, people) {
  const eligibleRegions = new Set(['ES', 'FR', 'JP']);
  const buyers = people.filter((person) =>
    eligibleRegions.has(person.fixture.region),
  );
  let active = 0;
  let ending = 0;
  let abandoned = 0;

  for (const [index, sale] of priced.entries()) {
    const buyer = buyers[index % buyers.length];
    if (buyer === undefined) continue;
    const held = await buyer.session.must('GET', '/v1/billing/subscriptions');
    const already = held.subscriptions.find(
      (row) => row.offerId === sale.offer.id,
    );
    if (already !== undefined) {
      if (already.state === 'cancel_at_period_end') ending += 1;
      else if (already.state === 'active') active += 1;
      continue;
    }

    // The cadence is named rather than left to the server. An offer that
    // publishes both a monthly and a yearly price refuses a request that does
    // not say which, and choosing here is what makes the seeded world show
    // both being paid for.
    const cadences = sale.offer.prices
      .filter((price) => price.state === 'active')
      .map((price) => price.interval)
      .filter((interval) => interval !== undefined);
    const interval =
      cadences.length === 0
        ? undefined
        : (cadences[index % cadences.length] ?? cadences[0]);
    const started = await buyer.session.call(
      'POST',
      '/v1/billing/checkouts',
      {
        currency: 'USD',
        ...(interval === undefined ? {} : { interval }),
        offerId: sale.offer.id,
      },
      {
        'x-velora-idempotency-key': `seed-join-${sale.offer.id}-${interval ?? 'once'}`,
      },
    );
    if (!started.ok) continue;
    const redirect = started.body.redirectUrl;
    if (typeof redirect !== 'string') continue;

    // Every third person abandons on the provider's page, because a world with
    // no abandoned payment in it cannot show what one looks like.
    const outcome = index % 3 === 2 ? 'cancel' : 'pay';
    const finished = await completeProviderCheckout(redirect, outcome);
    if (!finished) continue;
    if (outcome === 'cancel') {
      abandoned += 1;
      continue;
    }

    const settled = await buyer.session.must(
      'GET',
      '/v1/billing/subscriptions',
    );
    const subscription = settled.subscriptions.find(
      (row) => row.offerId === sale.offer.id,
    );
    if (subscription === undefined) continue;
    // Every other live membership is scheduled to end, so both states are on
    // the Memberships page from the first run.
    if (index % 2 === 1) {
      const cancelled = await buyer.session.call(
        'POST',
        '/v1/billing/subscriptions/cancellation',
        { subscriptionId: subscription.id },
      );
      if (cancelled.ok) {
        ending += 1;
        continue;
      }
    }
    active += 1;
  }
  return { abandoned, active, ending };
}

/**
 * Pressing the button on the local-test provider's own hosted page.
 *
 * A form post to somebody else's origin, which is exactly what a browser does
 * at this point. The page is served by the API only because the local-test
 * adapter has no origin of its own; it is outside `/v1`, carries no session,
 * and settles nothing — the settlement is the signed event it delivers
 * afterwards through the ordinary verified inbox.
 */
async function completeProviderCheckout(redirectUrl, outcome) {
  const reference = new URL(redirectUrl).searchParams.get('reference');
  if (reference === null) return false;
  const response = await fetch(redirectUrl, {
    body: new URLSearchParams({ outcome, reference }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    redirect: 'manual',
  });
  return response.status === 303 || response.ok;
}

/** A few real, ledger-backed gifts through the consumer product route. */
async function seedGifts(people, seededCreators) {
  // These are the explicit consumer countries published by the local-test
  // commerce authority. Choosing from the fixture rather than changing a
  // person's declaration keeps the checkout proof honest.
  const eligibleRegions = new Set(['ES', 'FR', 'JP']);
  const senders = people.filter((person) =>
    eligibleRegions.has(person.fixture.region),
  );
  let sent = 0;
  for (let index = 0; index < 6; index += 1) {
    const person = senders[index % senders.length];
    const creator = seededCreators[index % seededCreators.length];
    if (person === undefined || creator === undefined) continue;
    const catalog = await person.session.must(
      'GET',
      `/v1/billing/gifts/catalog?handle=${encodeURIComponent(creator.fixture.handle)}&currency=USD`,
    );
    const item = catalog.items[index % catalog.items.length];
    if (item === undefined) {
      throw new Error(`${creator.fixture.handle}: gift catalog is empty`);
    }
    await person.session.must(
      'POST',
      '/v1/billing/gifts',
      {
        context: { type: 'creator_profile' },
        currency: 'USD',
        giftItemId: item.id,
        handle: creator.fixture.handle,
      },
      {
        'x-velora-idempotency-key': `seed-gift-${String(index).padStart(3, '0')}`,
      },
    );
    sent += 1;
  }
  return sent;
}

/**
 * Coins, so the paid matching preference is walkable without buying anything.
 *
 * Three deliberate groups rather than one. Most people are funded generously
 * enough to open several windows, because the interesting walk is the matcher
 * and not the arithmetic. Some are funded with *less than one window costs*, so
 * the insufficient-balance state is reachable without anybody having to spend
 * down to it first. And some have nothing at all, because a zero balance is the
 * state every new account is in and the one a surface most often gets wrong.
 *
 * Every coin here goes through the published grant route, which the server
 * refuses outside local and test — so this cannot fund anybody anywhere it
 * should not, whatever it is pointed at. Nothing writes a balance directly, and
 * the reference is stable per person so running the seed twice funds them once.
 */
async function seedCoins(people) {
  let funded = 0;
  let empty = 0;
  for (const [index, person] of people.entries()) {
    const group = index % 5;
    if (group === 3) {
      empty += 1;
      continue;
    }
    // Below the cheapest single preference, so the refusal is reachable.
    const coins = group === 4 ? '5' : '400';
    const response = await person.session.call('POST', '/v1/wallet/grants', {
      coins,
      reference: `seed-coins-${String(index)}`,
    });
    if (!response.ok) {
      // No coin ledger in this environment. That is a configuration this world
      // may legitimately have — the free product is the whole product without
      // it — so it is reported rather than fatal.
      say('no coin ledger configured; wallets left empty');
      return { empty: people.length, funded: 0 };
    }
    funded += 1;
  }
  return { empty, funded };
}

async function main() {
  guard();
  say(`seeding ${apiBaseUrl}`);
  await waitForApi();

  const people = [];
  for (const [index, fixture] of consumers.entries()) {
    people.push(await seedConsumer(fixture, index));
    if ((index + 1) % 8 === 0) say(`${String(index + 1)} people created`);
  }
  say(`${String(people.length)} people created`);

  await waitForConsumerImages(people);
  say('every picture is ready');
  await makeVisible(people);
  say('everybody is discoverable and available');

  const introductions = await seedRelationships(people);
  say(`${String(introductions.size)} mutual introductions`);
  const conversations = await seedConversations(introductions);
  say(
    `${String(conversations.opened)} conversations, ${String(conversations.messages)} messages`,
  );

  const seededCreators = [];
  for (const [index, fixture] of creators.entries()) {
    seededCreators.push(await seedCreator(fixture, index));
    say(`creator ${fixture.handle} published`);
  }

  const work = [];
  for (const [index, creator] of seededCreators.entries()) {
    const done = await seedCreatorWork(creator, index);
    work.push({ ...done, studio: creator.studio });
  }
  const items = work.reduce((total, one) => total + one.items, 0);
  const images = work.reduce((total, one) => total + one.images, 0);
  const clubs = work.reduce((total, one) => total + one.clubs.length, 0);
  say(
    `${String(items)} catalog items, ${String(images)} item pictures, ${String(clubs)} clubs`,
  );

  const memberships = await seedMemberships(work, people);
  say(
    `${String(memberships.invited)} invitations, ${String(memberships.redeemed)} redeemed`,
  );

  const priced = await seedMembershipOffers(work);
  say(`${String(priced.length)} memberships on sale`);
  const joined = await seedSubscriptions(priced, people);
  say(
    `${String(joined.active)} paid memberships live, ${String(joined.ending)} ending at the period, ${String(joined.abandoned)} payments abandoned`,
  );

  const gifts = await seedGifts(people, seededCreators);
  say(`${String(gifts)} gifts present through verified settlement`);

  const coins = await seedCoins(people);
  say(
    `${String(coins.funded)} wallets funded, ${String(coins.empty)} deliberately empty`,
  );

  process.stdout.write(
    [
      '',
      'VELORA local world seeded.',
      '',
      `  people            ${String(people.length)}`,
      `  creators          ${String(seededCreators.length)}`,
      `  catalog items     ${String(items)}`,
      `  clubs             ${String(clubs)}`,
      `  invitations       ${String(memberships.invited)} (${String(memberships.redeemed)} redeemed)`,
      `  memberships       ${String(priced.length)} on sale`,
      `  subscriptions     ${String(joined.active)} live, ${String(joined.ending)} ending, ${String(joined.abandoned)} abandoned`,
      `  introductions     ${String(introductions.size)} mutual, ${String(pendingPairs.length)} waiting`,
      `  conversations     ${String(conversations.opened)}`,
      `  gifts             ${String(gifts)}`,
      '',
      `Sign in on Consumer Web as any of: ${subjectFor('person', 0)} … ${subjectFor('person', consumers.length - 1)}`,
      `Sign in on Creator Studio as any of: ${subjectFor('creator', 0)} … ${subjectFor('creator', creators.length - 1)}`,
      '',
      'Availability is capped at twenty-four hours by product policy, so run',
      'this again tomorrow to bring the world back into Discover.',
      '',
    ].join('\n'),
  );
}

await main();
