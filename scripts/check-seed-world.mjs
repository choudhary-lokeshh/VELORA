import assert from 'node:assert/strict';

import { consumers, creators, subjectFor } from './seed-fixtures.mjs';
import { assertLocalSeedTarget } from './seed-safety.mjs';

const accept = (apiBaseUrl) =>
  assert.doesNotThrow(() =>
    assertLocalSeedTarget({ apiBaseUrl, appEnvironment: 'local' }),
  );
const refuse = (appEnvironment, apiBaseUrl) =>
  assert.throws(() => assertLocalSeedTarget({ apiBaseUrl, appEnvironment }));

accept('http://127.0.0.1:4000');
accept('http://localhost:4000');
accept('http://[::1]:4000');
refuse('staging', 'http://127.0.0.1:4000');
refuse('production', 'http://127.0.0.1:4000');
refuse('test', 'http://127.0.0.1:4000');
refuse('local', 'https://127.0.0.1:4000');
refuse('local', 'http://192.0.2.1:4000');
refuse('local', 'http://user:secret@127.0.0.1:4000');

const allItems = creators.flatMap((creator) => creator.items);
const publicItems = allItems.filter((item) => item.members !== true);
const clubs = creators.flatMap((creator) => creator.clubs);
const flagships = creators.filter((creator) => creator.flagship);
const subjects = [
  ...consumers.map((_, index) => subjectFor('person', index)),
  ...creators.map((_, index) => subjectFor('creator', index)),
];

assert.ok(consumers.length >= 30, 'seed needs at least 30 consumers');
assert.ok(creators.length >= 12, 'seed needs at least 12 creators');
assert.ok(publicItems.length >= 40, 'seed needs at least 40 public items');
assert.ok(clubs.length >= 6, 'seed needs at least 6 clubs');

/**
 * What the seeded world has to be able to show about money.
 *
 * A world where every club is priced would never render the invitation-only
 * card, and one where none is could not render a membership at all. Both are
 * real products, so both have to be in the world before anybody looks at it.
 */
const priced = clubs.filter((club) => club.membership !== undefined);
assert.ok(priced.length >= 3, 'seed needs at least 3 clubs on sale');
assert.ok(
  priced.length < clubs.length,
  'seed needs at least one invitation-only club, so both cards are visible',
);
assert.ok(
  priced.some((club) => club.membership.yearlyMinor !== undefined),
  'seed needs at least one membership with a second cadence',
);
for (const club of clubs) {
  assert.ok(
    Array.isArray(club.benefits) && club.benefits.length > 0,
    `${club.name} needs benefit lines, because that is what a visitor reads`,
  );
  if (club.membership === undefined) continue;
  for (const [cadence, amount] of Object.entries(club.membership)) {
    assert.match(
      amount,
      /^[1-9][0-9]*$/u,
      `${club.name} ${cadence} must be a positive count of minor units`,
    );
  }
}
assert.equal(flagships.length, 4, 'seed needs exactly four flagship creators');
assert.equal(
  new Set(subjects).size,
  subjects.length,
  'subjects must be unique',
);
assert.equal(
  new Set(creators.map((creator) => creator.handle)).size,
  creators.length,
  'creator handles must be unique',
);
assert.equal(
  new Set(allItems.map((item) => item.title)).size,
  allItems.length,
  'content titles must be unique',
);

for (const creator of creators) {
  assert.ok(
    creator.region === 'ES' || creator.region === 'FR',
    `${creator.handle} needs an eligible local-test operating region`,
  );
  assert.equal(creator.tone.length, 2, `${creator.handle} needs generated art`);
  for (const link of creator.links) {
    assert.equal(
      new URL(link.url).hostname,
      'example.invalid',
      `${creator.handle} fixture link must stay non-routable`,
    );
  }
  for (const item of creator.items) {
    assert.ok(
      Number.isInteger(item.images) && item.images > 0,
      `${creator.handle}/${item.title} needs generated local media`,
    );
    assert.ok(
      !('imageUrl' in item) && !('mediaUrl' in item),
      `${creator.handle}/${item.title} must not use remote media`,
    );
  }
}

process.stdout.write(
  `Seed world: ${String(consumers.length)} consumers, ${String(creators.length)} creators, ${String(publicItems.length)} public items, ${String(clubs.length)} clubs (${String(priced.length)} on sale), ${String(flagships.length)} flagships; local-only guard proven.\n`,
);
