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
 * The guard below refuses anything but a loopback API in a local environment.
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

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function guard() {
  const appEnvironment =
    process.env.VELORA_APP_ENV ??
    fileEnvironment.get('VELORA_APP_ENV') ??
    'local';
  if (appEnvironment !== 'local') {
    throw new Error(
      `dev:seed is local only; VELORA_APP_ENV is ${appEnvironment}`,
    );
  }
  const { hostname, protocol } = new URL(apiBaseUrl);
  if (protocol !== 'http:' || !loopbackHosts.has(hostname)) {
    throw new Error(`dev:seed refuses a non-loopback API at ${apiBaseUrl}`);
  }
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
  const account = await consumerSession.call('GET', '/v1/users/me');
  if (!account.ok) await consumerSession.must('POST', '/v1/users', {});
  const onboarding = await consumerSession.must(
    'GET',
    '/v1/users/me/onboarding',
  );
  if (onboarding.step === 'adult_declaration') {
    await consumerSession.must(
      'POST',
      '/v1/users/me/onboarding/adult-declaration',
      {
        declaresAdult: true,
        region: 'PT',
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
        description: wanted.description,
        name: wanted.name,
        slug: `${fixture.handle}-${String(clubIndex + 1)}`,
      });
      club = created.clubs[0];
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
  return { clubs, images, items };
}

/** Invitations, and a few of them redeemed so a member exists to be one. */
async function seedMemberships(creatorWork, people) {
  let invited = 0;
  let redeemed = 0;
  let redeemer = 0;
  for (const { clubs } of creatorWork) {
    for (const club of clubs) {
      const issued = await creatorWork
        .find((entry) => entry.clubs.includes(club))
        ?.studio.call('POST', '/v1/creator/clubs/invites', { clubId: club.id });
      if (issued?.ok !== true) continue;
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

/** A few real, ledger-backed gifts through the consumer product route. */
async function seedGifts(people, seededCreators) {
  let sent = 0;
  for (let index = 0; index < Math.min(6, people.length); index += 1) {
    const person = people[index];
    const creator = seededCreators[index % seededCreators.length];
    if (person === undefined || creator === undefined) continue;
    const catalog = await person.session.call(
      'GET',
      `/v1/billing/gifts/catalog?handle=${encodeURIComponent(creator.fixture.handle)}&currency=USD`,
    );
    if (!catalog.ok || catalog.body.items.length === 0) continue;
    const item = catalog.body.items[index % catalog.body.items.length];
    const result = await person.session.call(
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
    if (result.ok) sent += 1;
  }
  return sent;
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

  const gifts = await seedGifts(people, seededCreators);
  say(`${String(gifts)} gifts sent through verified settlement`);

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
