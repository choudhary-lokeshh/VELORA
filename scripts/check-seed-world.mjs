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
  `Seed world: ${String(consumers.length)} consumers, ${String(creators.length)} creators, ${String(publicItems.length)} public items, ${String(clubs.length)} clubs, ${String(flagships.length)} flagships; local-only guard proven.\n`,
);
