import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  DepictedPersonConsentService,
  LocalTestConsentPolicy,
  UnpublishedConsentPolicy,
} from '../../src/safety/consent.js';
import { IdentityDepictedPersonEvidenceReader } from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { testServerConfig } from '../support/harness.js';
import {
  consentEvidenceFor,
  grantDepictedPersonEvidence,
} from '../support/identity-evidence.js';

/**
 * Depicted-person evidence and consent against real PostgreSQL.
 *
 * The property under test is that the platform can say who is depicted in a
 * piece of creator content and what they agreed to, **without holding anything
 * about them it should not hold**, and that every path fails closed while no
 * verifier and no wording are approved.
 *
 * Three things are easy to get wrong and each is asserted directly. A creator's
 * word must never be recorded as verification. Consent must be scoped, so
 * withdrawing one permission withdraws exactly that one. And absence must not
 * read as permission: an item nobody has been asked about is not an item with
 * nobody in it.
 *
 * The seam is exercised directly, because it publishes no HTTP surface: the
 * capability it guards is disabled and there is nothing for a creator to use.
 */

const databaseUrl = await provisionDatabase('velora_safety_consent');
const database: TestDatabase = connectDatabase(databaseUrl);

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const repository = new SafetyRepository(database.drizzle);
const identityEvidence = new IdentityDepictedPersonEvidenceReader(
  new IdentityRepository(database.drizzle),
);

/** The deployed shape: no verifier, no wording. */
const refusing = new DepictedPersonConsentService({
  copy: new UnpublishedConsentPolicy(),
  identityEvidence,
  now,
  repository,
});

/** Both development gates lifted, so the whole path is exercisable. */
const consent = new DepictedPersonConsentService({
  copy: new LocalTestConsentPolicy(),
  identityEvidence,
  now,
  repository,
});

const expiring = consent;

const creatorId = crypto.randomUUID();
const operator = 'session:creator-under-test';

function contentId(): string {
  return crypto.randomUUID();
}

/** An item declared to depict people, with one person asserted on it. */
async function asserted(
  service: DepictedPersonConsentService = consent,
): Promise<{ readonly contentId: string; readonly participantId: string }> {
  const item = contentId();
  await service.declare({
    contentId: item,
    creatorId,
    declaration: 'depicted_persons',
  });
  const declared = await service.declareParticipant({
    contentId: item,
    creatorId,
  });
  if (declared.kind !== 'declared') throw new Error('declaration failed');
  return { contentId: item, participantId: declared.participant.id };
}

async function link(
  service: DepictedPersonConsentService,
  participantId: string,
  scopes: readonly ('publication' | 'distribution' | 'commercial_use')[],
  expiresAt?: Date,
) {
  const subject = await grantDepictedPersonEvidence({
    database,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    now: now(),
    participantReference: participantId,
  });
  return service.linkParticipant({
    actorReference: operator,
    consentEvidenceReferences: consentEvidenceFor(participantId, scopes),
    ...(expiresAt === undefined ? {} : { consentExpiresAt: expiresAt }),
    identitySubjectReference: subject,
    participantId,
    scopes,
  });
}

function satisfied(
  item: string,
  scope: 'publication' | 'distribution' | 'commercial_use',
) {
  return consent.consentSatisfied({
    contentId: item,
    executor: database.drizzle,
    now: now(),
    scope,
  });
}

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('nothing is verified while nothing is approved', () => {
  it('refuses to link anybody with no Identity evidence', async () => {
    const item = await asserted(refusing);

    const outcome = await refusing.linkParticipant({
      actorReference: operator,
      consentEvidenceReferences: {},
      identitySubjectReference: crypto.randomUUID(),
      participantId: item.participantId,
      scopes: ['publication'],
    });

    expect(outcome.kind).toBe('not_verified');
    const rows = await rowsOf<{ evidence_state: string }>(
      database.sql`select evidence_state from safety_depicted_participants`,
    );
    expect(rows.map((row) => row.evidence_state)).toEqual(['asserted']);
  });

  it('links Identity evidence without consent when no wording is approved', async () => {
    const item = await asserted(refusing);

    const outcome = await link(refusing, item.participantId, [
      'publication',
      'distribution',
    ]);

    expect(outcome.kind).toBe('linked');
    if (outcome.kind !== 'linked') return;
    // The two gates are independent. A provider can establish who somebody is
    // and that they are an adult; it cannot make them agree to words nobody has
    // written, so no grant is recorded at all.
    expect(outcome.grantedScopes).toEqual([]);
    expect(await countOf('safety_consent_records')).toBe(0);

    const decision = await refusing.consentSatisfied({
      contentId: item.contentId,
      executor: database.drizzle,
      now: now(),
      scope: 'publication',
    });
    expect(decision).toMatchObject({
      reasonCode: 'authority_unavailable',
      satisfied: false,
    });
  });

  it('defaults both gates to the value that refuses', () => {
    const config = testServerConfig();
    expect(config.IDENTITY_VERIFICATION_PROVIDER).toBe('unavailable');
    expect(config.SAFETY_CONSENT_POLICY).toBe('unpublished');
  });
});

describe('absence is not permission', () => {
  it('treats an item nobody was asked about as unanswered', async () => {
    const decision = await satisfied(contentId(), 'publication');
    expect(decision).toMatchObject({
      reasonCode: 'undeclared',
      satisfied: false,
    });
  });

  it('accepts an item declared to depict nobody, with no verifier at all', async () => {
    const item = contentId();
    await refusing.declare({
      contentId: item,
      creatorId,
      declaration: 'no_depicted_persons',
    });

    const decision = await refusing.consentSatisfied({
      contentId: item,
      executor: database.drizzle,
      now: now(),
      scope: 'publication',
    });
    // The one satisfied answer that needs no evidence: there is nobody to have
    // consented, and no verifier could change that.
    expect(decision.satisfied).toBe(true);
    expect(decision.reasonCode).toBeUndefined();
  });

  it('refuses an item that declares people and names none', async () => {
    const item = contentId();
    await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'depicted_persons',
    });

    expect(await satisfied(item, 'publication')).toMatchObject({
      reasonCode: 'participants_missing',
      satisfied: false,
    });
  });

  it('refuses to add a person to an item that declares none', async () => {
    const item = contentId();
    await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'no_depicted_persons',
    });

    const declared = await consent.declareParticipant({
      contentId: item,
      creatorId,
    });
    expect(declared.kind).toBe('not_applicable');

    const undeclared = await consent.declareParticipant({
      contentId: contentId(),
      creatorId,
    });
    expect(undeclared.kind).toBe('undeclared');
  });

  it('lets a creator change the answer, and refuses a stale one', async () => {
    const item = contentId();
    const first = await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'no_depicted_persons',
    });
    if (first.kind !== 'recorded') throw new Error('setup failed');

    const changed = await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'depicted_persons',
      expectedVersion: first.declaration.version,
    });
    expect(changed.kind).toBe('recorded');

    const stale = await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'no_depicted_persons',
      expectedVersion: first.declaration.version,
    });
    expect(stale.kind).toBe('conflict');

    // And an answer that names no version at all is refused rather than
    // overwriting whatever is there.
    const unversioned = await consent.declare({
      contentId: item,
      creatorId,
      declaration: 'no_depicted_persons',
    });
    expect(unversioned.kind).toBe('conflict');
  });
});

describe("a creator's word is stored as a creator's word", () => {
  it('refuses an item whose people are only asserted', async () => {
    const item = await asserted();
    expect(await satisfied(item.contentId, 'publication')).toMatchObject({
      reasonCode: 'assertion_only',
      satisfied: false,
    });
  });

  it('supersedes the assertion rather than editing it', async () => {
    const item = await asserted();
    const before = await rowsOf<Record<string, unknown>>(
      database.sql`select * from safety_depicted_participants
        where id = ${item.participantId}`,
    );

    const verified = await link(consent, item.participantId, ['publication']);

    expect(verified.kind).toBe('linked');
    if (verified.kind !== 'linked') return;
    expect(verified.participant.supersedesId).toBe(item.participantId);
    expect(verified.participant.evidenceState).toBe('identity_referenced');
    // What the creator originally said is exactly what they said.
    const after = await rowsOf<Record<string, unknown>>(
      database.sql`select * from safety_depicted_participants
        where id = ${item.participantId}`,
    );
    expect(after).toEqual(before);
    // And the person is counted once, by the record nothing replaces.
    const live = await consent.participantsFor(item.contentId);
    expect(live).toHaveLength(1);
    expect(live[0]?.evidenceState).toBe('identity_referenced');
  });

  it('refuses to verify the same assertion twice', async () => {
    const item = await asserted();
    const first = await link(consent, item.participantId, ['publication']);
    const second = await link(consent, item.participantId, ['publication']);

    expect(first.kind).toBe('linked');
    // The chain does not fork, and the same person is not counted twice.
    expect(second.kind).toBe('conflict');
    expect(await consent.participantsFor(item.contentId)).toHaveLength(1);
  });
});

describe('consent is scoped, and a withdrawal withdraws one scope', () => {
  async function verified(
    scopes: readonly ('publication' | 'distribution' | 'commercial_use')[],
  ): Promise<{ readonly contentId: string; readonly participantId: string }> {
    const item = await asserted();
    const outcome = await link(consent, item.participantId, scopes);
    if (outcome.kind !== 'linked') throw new Error('Identity linkage failed');
    return { contentId: item.contentId, participantId: outcome.participant.id };
  }

  it('covers what was agreed to and nothing beside it', async () => {
    const item = await verified(['publication']);

    expect((await satisfied(item.contentId, 'publication')).satisfied).toBe(
      true,
    );
    // Publishing a depiction is not permission to monetise it.
    expect(await satisfied(item.contentId, 'commercial_use')).toMatchObject({
      reasonCode: 'consent_missing',
      satisfied: false,
    });
  });

  it('withdraws one permission and leaves the others standing', async () => {
    const item = await verified(['publication', 'distribution']);
    const records = await consent.consentRecordsFor(item.contentId);
    const publication = records.find((row) => row.scope === 'publication');
    if (publication === undefined) throw new Error('no grant to withdraw');

    const revoked = await consent.revokeConsent({
      actorReference: operator,
      consentId: publication.id,
    });

    expect(revoked.kind).toBe('revoked');
    expect(await satisfied(item.contentId, 'publication')).toMatchObject({
      reasonCode: 'consent_revoked',
      satisfied: false,
    });
    expect((await satisfied(item.contentId, 'distribution')).satisfied).toBe(
      true,
    );
    // Both facts survive: permission was given, and it was taken back.
    expect(await countOf('safety_consent_records')).toBe(3);
  });

  it('refuses two withdrawals of the same permission', async () => {
    const item = await verified(['publication']);
    const [grant] = await consent.consentRecordsFor(item.contentId);
    if (grant === undefined) throw new Error('no grant to withdraw');
    const withdraw = () =>
      consent.revokeConsent({ actorReference: operator, consentId: grant.id });

    expect((await withdraw()).kind).toBe('revoked');
    expect((await withdraw()).kind).toBe('conflict');
    expect(await countOf('safety_consent_records')).toBe(2);
  });

  it('stops relying on evidence once it lapses', async () => {
    const item = await asserted(expiring);
    const outcome = await link(
      expiring,
      item.participantId,
      ['publication'],
      new Date(now().getTime() + 60_000),
    );
    if (outcome.kind !== 'linked') throw new Error('Identity linkage failed');
    expect((await satisfied(item.contentId, 'publication')).satisfied).toBe(
      true,
    );

    clockOffsetMilliseconds = 61_000;
    // Expiry is a property of the record rather than an event, so nothing was
    // swept and nothing was written: the same rows now answer differently.
    expect(await satisfied(item.contentId, 'publication')).toMatchObject({
      reasonCode: 'evidence_expired',
      satisfied: false,
    });
    expect(await countOf('safety_depicted_participants')).toBe(2);
  });

  it('refuses an item where one of two people has not consented', async () => {
    const item = await verified(['publication']);
    const second = await consent.declareParticipant({
      contentId: item.contentId,
      creatorId,
    });
    if (second.kind !== 'declared') throw new Error('declaration failed');

    // One person's permission is not everybody's, and the item is refused on
    // the weaker of the two rather than the stronger.
    expect(await satisfied(item.contentId, 'publication')).toMatchObject({
      reasonCode: 'assertion_only',
      satisfied: false,
    });

    await link(consent, second.participant.id, ['distribution']);
    expect(await satisfied(item.contentId, 'publication')).toMatchObject({
      reasonCode: 'consent_missing',
      satisfied: false,
    });
  });
});

describe('the database holds no identity evidence, and refuses to be edited', () => {
  it('has no column that could hold a document, an image, or a name', async () => {
    const rows = await rowsOf<{ column_name: string; table_name: string }>(
      database.sql`select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('safety_content_depictions',
                             'safety_depicted_participants',
                             'safety_consent_records')
        order by table_name, column_name`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Named exhaustively rather than by a pattern, because the point is that
      // somebody adding one of these would have to change this assertion and
      // read why it is here.
      expect(
        [
          'document',
          'image',
          'photo',
          'selfie',
          'biometric',
          'birth',
          'dob',
          'legal_name',
          'full_name',
          'address',
          'passport',
        ].some((forbidden) => row.column_name.includes(forbidden)),
        `${row.table_name}.${row.column_name}`,
      ).toBe(false);
    }
  });

  it('refuses an assertion dressed as verification', async () => {
    const item = await asserted();
    const insert = (values: Record<string, unknown>) =>
      execute(
        database.sql`insert into safety_depicted_participants ${database.sql({
          content_id: item.contentId,
          creator_id: creatorId,
          declared_at: new Date(),
          evidence_state: 'asserted',
          id: crypto.randomUUID(),
          identity_subject_reference: null,
          policy_version: 'v1-provisional',
          supersedes_id: null,
          ...values,
        })}`,
      );

    // A creator's word carrying an evidence reference would be exactly the
    // confusion this model exists to prevent.
    expect(
      await refused(() =>
        insert({ identity_subject_reference: crypto.randomUUID() }),
      ),
    ).toBe(true);
    // And a verification missing any part of its evidence is not a
    // verification, so there is no half-verified state to interpret.
    expect(
      await refused(() =>
        insert({
          evidence_state: 'identity_referenced',
        }),
      ),
    ).toBe(true);
    // The only cross-domain reference is UUID-typed, so it cannot hold prose.
    expect(
      await refused(() =>
        insert({
          evidence_state: 'identity_referenced',
          identity_subject_reference: 'Jane Smith, passport 12345',
        }),
      ),
    ).toBe(true);
  });

  it('refuses a grant nobody captured', async () => {
    const item = await asserted();
    const verified = await link(consent, item.participantId, ['publication']);
    if (verified.kind !== 'linked') throw new Error('setup failed');

    // A grant with no evidence behind it would be the creator asserting consent
    // on another person's behalf.
    expect(
      await refused(() =>
        execute(
          database.sql`insert into safety_consent_records ${database.sql({
            actor_reference: operator,
            consent_evidence_reference: null,
            content_id: item.contentId,
            copy_version: '0-unpublished',
            disposition: 'grant',
            expires_at: null,
            id: crypto.randomUUID(),
            participant_id: verified.participant.id,
            policy_version: 'v1-provisional',
            recorded_at: new Date(),
            scope: 'commercial_use',
            supersedes_id: null,
          })}`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses to edit or remove evidence and consent', async () => {
    const item = await asserted();
    await link(consent, item.participantId, ['publication']);

    const refusals = await Promise.all([
      refused(() =>
        execute(
          database.sql`update safety_depicted_participants
            set evidence_state = 'identity_referenced'`,
        ),
      ),
      refused(() =>
        execute(database.sql`delete from safety_depicted_participants`),
      ),
      refused(() =>
        execute(
          database.sql`update safety_consent_records set scope = 'commercial_use'`,
        ),
      ),
      refused(() => execute(database.sql`delete from safety_consent_records`)),
    ]);
    expect(refusals.every(Boolean)).toBe(true);
    expect(refusals).toHaveLength(4);
  });

  it('refuses evidence about somebody nobody said was there', async () => {
    // A participant on an item with no declaration would be evidence with no
    // question behind it.
    expect(
      await refused(() =>
        execute(
          database.sql`insert into safety_depicted_participants ${database.sql({
            content_id: crypto.randomUUID(),
            creator_id: creatorId,
            declared_at: new Date(),
            evidence_state: 'asserted',
            id: crypto.randomUUID(),
            identity_subject_reference: null,
            policy_version: 'v1-provisional',
            supersedes_id: null,
          })}`,
        ),
      ),
    ).toBe(true);
  });
});

async function countOf(table: string): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(`select count(*)::text as count from ${table}`),
  );
  return Number(rows[0]?.count ?? '0');
}
