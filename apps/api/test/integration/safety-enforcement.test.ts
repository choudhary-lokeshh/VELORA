import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { subjectLockKey } from '../../src/database/subject-lock.js';
import { SafetyEligibility } from '../../src/safety/eligibility.js';
import { EnforcementAuthority } from '../../src/safety/enforcement.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';

/**
 * The safety policy and enforcement authority against real PostgreSQL.
 *
 * Three properties are under test and each one used to be missing.
 *
 * What is in force is derivable from the enforcement log alone. It was not:
 * `account_restriction` was written both by a decision that restricted an
 * account and by the review that restored one, so the only reader that could
 * tell them apart was the domain that had applied the change.
 *
 * A reversal preserves what it reverses. The lift is a new row naming the
 * record it replaces, and the original is byte-for-byte what was written.
 *
 * And a race resolves to a serial order. The subject advisory lock is taken
 * before any row lock by everything that decides something about a subject, so
 * an imposition and a mutation authorized by its absence are never interleaved.
 *
 * The authority is exercised directly rather than through a route, for the same
 * reason the moderation seam is: it deliberately has no HTTP surface, and the
 * point of the contract is that ADMIN and MODERATION are its only callers.
 */

const databaseUrl = await provisionDatabase('velora_safety_enforcement');
const database: TestDatabase = connectDatabase(databaseUrl);

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const repository = new SafetyRepository(database.drizzle);
const authority = new EnforcementAuthority({ now, repository });
const eligibility = new SafetyEligibility(repository);

/** Subjects are opaque identifiers here, because to this domain they are. */
function subject(): string {
  return crypto.randomUUID();
}

const operator = 'session:operator-under-test';

function restrict(subjectId: string, extra: Record<string, unknown> = {}) {
  return database.drizzle.transaction((executor) =>
    authority.impose(executor, {
      actorReference: operator,
      reasonCode: 'harassment',
      scope: 'creator_suspension',
      subjectId,
      ...extra,
    }),
  );
}

function lift(subjectId: string, extra: Record<string, unknown> = {}) {
  return database.drizzle.transaction((executor) =>
    authority.lift(executor, {
      actorReference: operator,
      reasonCode: 'platform_integrity',
      scope: 'creator_suspension',
      subjectId,
      ...extra,
    }),
  );
}

function decide(subjectId: string) {
  return eligibility.decide({
    capability: 'creator_operation',
    executor: database.drizzle,
    now: now(),
    subjectId,
  });
}

async function deadlockCount(): Promise<number> {
  const rows = await rowsOf<{ deadlocks: string }>(
    database.sql`select deadlocks from pg_stat_database where datname = current_database()`,
  );
  return Number(rows[0]?.deadlocks ?? 0);
}

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('what is in force is derivable from the log alone', () => {
  it('denies a capability the moment a restriction is recorded', async () => {
    const creator = subject();
    expect((await decide(creator)).allowed).toBe(true);

    const imposed = await restrict(creator);
    expect(imposed.kind).toBe('recorded');

    const denied = await decide(creator);
    expect(denied.allowed).toBe(false);
    expect(denied.scope).toBe('creator_suspension');
    expect(denied.reasonCode).toBe('creator_capability_suspended');
    expect(denied.policyVersion).toBe('v1-provisional');
  });

  it('tells a denied subject the category and never the finding', async () => {
    const creator = subject();
    // The enforcement records `harassment` as the review's finding. The answer
    // a caller may pass on says only that the capability is suspended, because
    // a finding disclosed to a subject is a step from there to the reporter.
    await restrict(creator);
    const denied = await decide(creator);
    expect(denied.reasonCode).toBe('creator_capability_suspended');
    expect(JSON.stringify(denied)).not.toContain('harassment');
  });

  it('treats an imposition already standing as the same decision', async () => {
    const creator = subject();
    const first = await restrict(creator);
    const second = await restrict(creator);
    expect(first.kind).toBe('recorded');
    expect(second.kind).toBe('already_in_force');
    if (first.kind !== 'recorded' || second.kind !== 'already_in_force') return;
    // The same record, not a second one: how many times an operator clicked is
    // not part of the history of what was done to somebody.
    expect(second.enforcement.id).toBe(first.enforcement.id);
    expect(
      await repository.listEnforcementsFor(database.drizzle, creator),
    ).toHaveLength(1);
  });

  it('lets a restriction expire without anything being written', async () => {
    const creator = subject();
    const expiresAt = new Date(Date.now() + 60_000);
    await restrict(creator, { expiresAt });
    expect((await decide(creator)).allowed).toBe(false);

    clockOffsetMilliseconds = 61_000;
    expect((await decide(creator)).allowed).toBe(true);
    // Expiry is a property of the record, not an event. Nothing swept.
    expect(
      await repository.listEnforcementsFor(database.drizzle, creator),
    ).toHaveLength(1);
  });

  it('separates one object restriction from another', async () => {
    const creator = subject();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await database.drizzle.transaction((executor) =>
      authority.impose(executor, {
        actorReference: operator,
        reasonCode: 'sexual_content_violation',
        scope: 'creator_object_removal',
        subjectId: creator,
        targetObjectId: first,
        targetObjectType: 'creator_content',
      }),
    );

    const restricted = (objectId: string) =>
      eligibility.isObjectRestricted({
        executor: database.drizzle,
        now: now(),
        objectId,
        objectType: 'creator_content',
        subjectId: creator,
      });
    expect(await restricted(first)).toBe(true);
    expect(await restricted(second)).toBe(false);
    // One item taken down is not the creator's whole capability.
    expect((await decide(creator)).allowed).toBe(true);
  });
});

describe('a reversal preserves what it reverses', () => {
  it('records a lift naming the restriction, leaving the original untouched', async () => {
    const creator = subject();
    const imposed = await restrict(creator);
    if (imposed.kind !== 'recorded') throw new Error('setup failed');
    const before = await repository.findEnforcement(
      database.drizzle,
      imposed.enforcement.id,
    );

    const lifted = await lift(creator);
    expect(lifted.kind).toBe('recorded');
    if (lifted.kind !== 'recorded') return;
    expect(lifted.enforcement.disposition).toBe('lift');
    expect(lifted.enforcement.supersedesId).toBe(imposed.enforcement.id);
    expect(lifted.enforcement.scope).toBe('creator_suspension');

    // The record that was superseded is exactly what it was.
    expect(
      await repository.findEnforcement(
        database.drizzle,
        imposed.enforcement.id,
      ),
    ).toEqual(before);
    expect((await decide(creator)).allowed).toBe(true);
  });

  it('refuses a lift when nothing is in force to take away', async () => {
    const creator = subject();
    expect((await lift(creator)).kind).toBe('nothing_to_lift');
    expect(
      await repository.listEnforcementsFor(database.drizzle, creator),
    ).toHaveLength(0);
  });

  it('refuses a lift that has already happened', async () => {
    const creator = subject();
    await restrict(creator);
    expect((await lift(creator)).kind).toBe('recorded');
    // The chain does not fork: there is nothing live left to supersede.
    expect((await lift(creator)).kind).toBe('nothing_to_lift');
  });

  it('refuses to reverse a scope no domain publishes a way to reverse', async () => {
    const person = subject();
    const conversation = crypto.randomUUID();
    await database.drizzle.transaction((executor) =>
      authority.impose(executor, {
        actorReference: operator,
        reasonCode: 'harassment',
        scope: 'conversation_closure',
        subjectId: person,
        targetConversationId: conversation,
      }),
    );
    const outcome = await database.drizzle.transaction((executor) =>
      authority.lift(executor, {
        actorReference: operator,
        reasonCode: 'platform_integrity',
        scope: 'conversation_closure',
        subjectId: person,
        targetConversationId: conversation,
      }),
    );
    // MESSAGING has no contract that reopens a conversation, so a record
    // claiming one was reopened would describe something that never happened.
    expect(outcome.kind).toBe('not_liftable');
  });

  it('lets a subject be restricted again after a lift', async () => {
    const creator = subject();
    await restrict(creator);
    await lift(creator);
    const again = await restrict(creator);
    expect(again.kind).toBe('recorded');
    expect((await decide(creator)).allowed).toBe(false);
    // Three records: restriction, reversal, restriction. Nothing rewritten.
    expect(
      await repository.listEnforcementsFor(database.drizzle, creator),
    ).toHaveLength(3);
  });
});

describe('safety wins the races', () => {
  it('settles fifty simultaneous impositions into one decision', async () => {
    const creator = subject();
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () => restrict(creator)),
    );
    expect(
      outcomes.filter((outcome) => outcome.kind === 'recorded'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === 'already_in_force'),
    ).toHaveLength(49);
    expect(
      await repository.listEnforcementsFor(database.drizzle, creator),
    ).toHaveLength(1);
  });

  it('settles simultaneous reversals into one, and never forks the chain', async () => {
    const creator = subject();
    await restrict(creator);
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, () => lift(creator)),
    );
    expect(
      outcomes.filter((outcome) => outcome.kind === 'recorded'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === 'nothing_to_lift'),
    ).toHaveLength(15);
  });

  it('resolves an imposition against a reversal to a serial order', async () => {
    const creator = subject();
    await restrict(creator);
    // Whichever order these take, the outcome is one of two serial histories
    // and never a state where both believe they acted on the same record.
    const [lifted, imposed] = await Promise.all([
      lift(creator),
      restrict(creator),
    ]);
    const live = await repository.listLiveEnforcements(database.drizzle, {
      now: now(),
      scopes: ['creator_suspension'],
      subjectId: creator,
    });
    if (lifted.kind === 'recorded') {
      // The lift went first or second; either way there is at most one live
      // restriction afterwards, and never two.
      expect(live.length).toBeLessThanOrEqual(1);
    }
    expect(
      imposed.kind === 'recorded' || imposed.kind === 'already_in_force',
    ).toBe(true);
    expect(live.length).toBeLessThanOrEqual(1);
  });

  it('serializes a decision against the subject lock rather than racing it', async () => {
    const creator = subject();
    // Holding the subject's advisory lock from outside proves the authority
    // takes it: if a decision could reach its "is anything in force" read
    // without the lock, this would complete while the lock was held, which is
    // exactly the stale read that must never authorize a later mutation.
    const holder = new Bun.SQL(database.url, { max: 1 });
    await holder.unsafe('begin');
    await holder.unsafe(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [subjectLockKey(creator)],
    );

    let settled = false;
    const imposing = restrict(creator).then((outcome) => {
      settled = true;
      return outcome;
    });
    await Bun.sleep(250);
    // Deterministic rather than timing-dependent: the lock is held, so the
    // decision cannot have proceeded, however long or short the wait.
    expect(settled).toBe(false);

    await holder.unsafe('commit');
    await holder.close();
    expect((await imposing).kind).toBe('recorded');
  });

  it('takes no deadlock across a batch of contended decisions', async () => {
    const creators = Array.from({ length: 8 }, () => subject());
    const before = await deadlockCount();
    await Promise.all(
      creators.flatMap((creator) => [
        restrict(creator),
        restrict(creator),
        lift(creator),
        restrict(creator),
      ]),
    );
    expect(await deadlockCount()).toBe(before);
  });
});

describe('the database enforces the enforcement invariants', () => {
  async function insert(values: Record<string, unknown>): Promise<void> {
    const row = {
      actor_reference: operator,
      created_at: new Date(),
      disposition: 'restrict',
      effective_at: new Date(),
      expires_at: null,
      id: crypto.randomUUID(),
      policy_version: 'v1-provisional',
      reason_code: 'harassment',
      report_id: null,
      scope: 'creator_suspension',
      subject_id: crypto.randomUUID(),
      supersedes_id: null,
      target_conversation_id: null,
      target_object_id: null,
      target_object_type: null,
      ...values,
    };
    await execute(
      database.sql`insert into safety_enforcements ${database.sql(row)}`,
    );
  }

  it('refuses a reversal that does not name what it reversed', async () => {
    expect(await refused(() => insert({ disposition: 'lift' }))).toBe(true);
  });

  it('refuses a reversal that carries an expiry', async () => {
    const creator = subject();
    const imposed = await restrict(creator);
    if (imposed.kind !== 'recorded') throw new Error('setup failed');
    // A lift that stopped applying would silently reinstate a restriction
    // nobody decided to reimpose.
    expect(
      await refused(() =>
        insert({
          disposition: 'lift',
          expires_at: new Date(Date.now() + 60_000),
          subject_id: creator,
          supersedes_id: imposed.enforcement.id,
        }),
      ),
    ).toBe(true);
  });

  it('refuses an expiry that precedes the moment it took effect', async () => {
    const effectiveAt = new Date();
    expect(
      await refused(() =>
        insert({
          effective_at: effectiveAt,
          expires_at: new Date(effectiveAt.getTime() - 1),
        }),
      ),
    ).toBe(true);
  });

  it('refuses a record that supersedes itself', async () => {
    const id = crypto.randomUUID();
    expect(
      await refused(() =>
        insert({ disposition: 'lift', id, supersedes_id: id }),
      ),
    ).toBe(true);
  });

  it('refuses a supersession of a record that does not exist', async () => {
    expect(
      await refused(() =>
        insert({ disposition: 'lift', supersedes_id: crypto.randomUUID() }),
      ),
    ).toBe(true);
  });

  it('refuses two records superseding the same one', async () => {
    const creator = subject();
    const imposed = await restrict(creator);
    if (imposed.kind !== 'recorded') throw new Error('setup failed');
    await lift(creator);
    expect(
      await refused(() =>
        insert({
          disposition: 'lift',
          subject_id: creator,
          supersedes_id: imposed.enforcement.id,
        }),
      ),
    ).toBe(true);
  });

  it('refuses a scope and a disposition outside the vocabulary', async () => {
    expect(
      await refused(() => insert({ scope: 'creator_reinstatement' })),
    ).toBe(true);
    expect(await refused(() => insert({ disposition: 'suspend' }))).toBe(true);
  });
});
