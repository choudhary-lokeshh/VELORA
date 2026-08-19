import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  DepictedPersonConsentService,
  LocalTestConsentPolicy,
} from '../../src/safety/consent.js';
import { IdentityDepictedPersonEvidenceReader } from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import { ContentSafetyGate } from '../../src/safety/content-safety.js';
import { SafetyEligibility } from '../../src/safety/eligibility.js';
import { EnforcementAuthority } from '../../src/safety/enforcement.js';
import {
  contentDenialReasons,
  distributionSurfaces,
  type ContentCapability,
  type ContentClassification,
  type DistributionSurface,
} from '../../src/safety/policy.js';
import { SafetyRepository } from '../../src/safety/repository.js';
import {
  connectDatabase,
  provisionDatabase,
  type TestDatabase,
} from '../support/database.js';
import { testServerConfig } from '../support/harness.js';
import {
  consentEvidenceFor,
  grantDepictedPersonEvidence,
} from '../support/identity-evidence.js';

/**
 * The composed content safety answer against real PostgreSQL.
 *
 * The property under test is that publishing, staying public, delivering, and
 * monetising are decided by a **conjunction of independent gates** rather than
 * by one column — and that the mature classes are refused in every environment
 * however many of those gates are satisfied.
 *
 * The gate reports every closed gate rather than the first, which is what these
 * tests read. A caller told only the first refusal would reasonably conclude
 * that fixing it is enough, and for a mature class that is never true.
 */

const databaseUrl = await provisionDatabase('velora_safety_content');
const database: TestDatabase = connectDatabase(databaseUrl);

const now = () => new Date();
const repository = new SafetyRepository(database.drizzle);
const authority = new EnforcementAuthority({ now, repository });
const eligibility = new SafetyEligibility(repository);
const consent = new DepictedPersonConsentService({
  copy: new LocalTestConsentPolicy(),
  identityEvidence: new IdentityDepictedPersonEvidenceReader(
    new IdentityRepository(database.drizzle),
  ),
  now,
  repository,
});

/** The deployed shape. The only shape configuration can produce. */
const gate = new ContentSafetyGate({
  consent,
  eligibility,
  matureContentEnabled: false,
  now,
  repository,
});

const operator = 'session:operator-under-test';

function decide(input: {
  readonly capability?: ContentCapability;
  readonly classification: ContentClassification;
  readonly contentId: string;
  readonly creatorId: string;
  readonly surface?: DistributionSurface;
  readonly viewerAdultAssurance?: 'none' | 'self_declared' | 'verified_adult';
}) {
  return gate.decide({
    capability: input.capability ?? 'publish',
    classification: input.classification,
    contentId: input.contentId,
    creatorId: input.creatorId,
    executor: database.drizzle,
    now: now(),
    surface: input.surface ?? 'web',
    ...(input.viewerAdultAssurance === undefined
      ? {}
      : { viewerAdultAssurance: input.viewerAdultAssurance }),
  });
}

/** An item classified as the caller says it is. */
async function classified(
  classification: ContentClassification,
): Promise<{ readonly contentId: string; readonly creatorId: string }> {
  const item = {
    contentId: crypto.randomUUID(),
    creatorId: crypto.randomUUID(),
  };
  const outcome = await gate.classify({ classification, ...item });
  if (outcome.kind !== 'recorded') throw new Error('classification failed');
  return item;
}

/** The same, with one verified depicted person who consented to everything. */
async function consented(
  classification: ContentClassification,
): Promise<{ readonly contentId: string; readonly creatorId: string }> {
  const item = await classified(classification);
  await consent.declare({
    contentId: item.contentId,
    creatorId: item.creatorId,
    declaration: 'depicted_persons',
  });
  const declared = await consent.declareParticipant({
    contentId: item.contentId,
    creatorId: item.creatorId,
  });
  if (declared.kind !== 'declared') throw new Error('declaration failed');
  const subject = await grantDepictedPersonEvidence({
    database,
    now: now(),
    participantReference: declared.participant.id,
  });
  const verified = await consent.linkParticipant({
    actorReference: operator,
    consentEvidenceReferences: consentEvidenceFor(declared.participant.id, [
      'publication',
      'distribution',
      'commercial_use',
    ]),
    identitySubjectReference: subject,
    participantId: declared.participant.id,
    scopes: ['publication', 'distribution', 'commercial_use'],
  });
  if (verified.kind !== 'linked') throw new Error('Identity linkage failed');
  return item;
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('an ordinary item passes an ordinary check', () => {
  it('allows a general item nobody has classified', async () => {
    // The platform carries one content class today, and an item nobody has
    // declared anything about is not blocked by a gate that applies to a class
    // it was never declared to be.
    const decision = await decide({
      classification: 'general',
      contentId: crypto.randomUUID(),
      creatorId: crypto.randomUUID(),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.closedGates).toEqual([]);
    expect(decision.reasonCode).toBeUndefined();
    expect(decision.policyVersion).toBe('v1-provisional');
  });

  it('allows a general item on every surface, including the mobile ones', async () => {
    const item = await classified('general');
    for (const surface of distributionSurfaces) {
      const decision = await decide({
        ...item,
        classification: 'general',
        surface,
      });
      // Surface ineligibility is about the mature classes. A general item is
      // not held off a store that never prohibited it.
      expect(decision.allowed, surface).toBe(true);
    }
  });
});

describe('a mature class is refused everywhere, however much is satisfied', () => {
  it('refuses when nothing else is wrong at all', async () => {
    const item = await consented('mature_simulated');

    const decision = await decide({
      ...item,
      classification: 'mature_simulated',
    });

    // Declared, consented, on an eligible surface, by an unrestricted creator,
    // on an item nothing has removed. The capability is still off, and that is
    // the only gate left closed.
    expect(decision.allowed).toBe(false);
    expect(decision.closedGates).toEqual(['mature_content_disabled']);
    expect(decision.reasonCode).toBe('mature_content_disabled');
  });

  it('holds the mobile surfaces ineligible as a property of the surface', async () => {
    const item = await consented('mature_actual');

    for (const surface of ['mobile_ios', 'mobile_android'] as const) {
      const decision = await decide({
        ...item,
        classification: 'mature_actual',
        surface,
      });
      expect(decision.closedGates, surface).toContain('surface_ineligible');
    }
    // And it is not configuration: the same item on the web is refused only by
    // the capability being off, so nothing about the deployment differs.
    const web = await decide({ ...item, classification: 'mature_actual' });
    expect(web.closedGates).toEqual(['mature_content_disabled']);
  });

  it('reports every closed gate rather than only the first', async () => {
    const item = await classified('mature_actual');

    const decision = await decide({
      ...item,
      capability: 'deliver',
      classification: 'mature_actual',
      surface: 'mobile_ios',
      viewerAdultAssurance: 'self_declared',
    });

    // Nothing here is fixable one at a time, and a caller told only the first
    // refusal would reasonably believe otherwise.
    expect(decision.closedGates).toEqual([
      'mature_content_disabled',
      'surface_ineligible',
      'consent_incomplete',
      'adult_assurance_insufficient',
    ]);
    // Strongest first, in the order the vocabulary declares.
    expect(decision.closedGates).toEqual(
      contentDenialReasons.filter((reason) =>
        decision.closedGates.includes(reason),
      ),
    );
  });

  it('refuses delivery to anything short of verified adult assurance', async () => {
    const item = await consented('mature_actual');
    const deliverTo = (
      viewerAdultAssurance: 'none' | 'self_declared' | 'verified_adult',
    ) =>
      decide({
        ...item,
        capability: 'deliver',
        classification: 'mature_actual',
        viewerAdultAssurance,
      });

    // Self-declaration is named as not highly effective by Ofcom, and a
    // completed purchase is named alongside it. Neither is accepted here.
    expect((await deliverTo('none')).closedGates).toContain(
      'adult_assurance_insufficient',
    );
    expect((await deliverTo('self_declared')).closedGates).toContain(
      'adult_assurance_insufficient',
    );
    expect((await deliverTo('verified_adult')).closedGates).not.toContain(
      'adult_assurance_insufficient',
    );
  });

  it('asks the consent scope the capability actually needs', async () => {
    const item = await classified('mature_actual');
    await consent.declare({
      contentId: item.contentId,
      creatorId: item.creatorId,
      declaration: 'depicted_persons',
    });
    const declared = await consent.declareParticipant({
      contentId: item.contentId,
      creatorId: item.creatorId,
    });
    if (declared.kind !== 'declared') throw new Error('declaration failed');
    const subject = await grantDepictedPersonEvidence({
      database,
      now: now(),
      participantReference: declared.participant.id,
    });
    await consent.linkParticipant({
      actorReference: operator,
      consentEvidenceReferences: consentEvidenceFor(declared.participant.id, [
        'publication',
      ]),
      identitySubjectReference: subject,
      participantId: declared.participant.id,
      // Publication only. Publishing a depiction is not permission to
      // monetise it, and the gate asks the scope the capability needs.
      scopes: ['publication'],
    });

    const publish = await decide({ ...item, classification: 'mature_actual' });
    const monetise = await decide({
      ...item,
      capability: 'monetise',
      classification: 'mature_actual',
    });

    expect(publish.closedGates).not.toContain('consent_incomplete');
    expect(monetise.closedGates).toContain('consent_incomplete');
  });
});

describe('a class is what was declared, not what a caller says', () => {
  it('refuses a mature capability on an item nobody classified', async () => {
    const decision = await decide({
      classification: 'mature_actual',
      contentId: crypto.randomUUID(),
      creatorId: crypto.randomUUID(),
    });
    expect(decision.closedGates).toContain('classification_undeclared');
  });

  it('refuses a caller that names a class the item was not declared to be', async () => {
    const item = await classified('mature_actual');

    // The direction that matters: an item declared mature cannot be published
    // as general by asking a different question at the call site.
    const asGeneral = await decide({ ...item, classification: 'general' });
    expect(asGeneral.allowed).toBe(false);
    expect(asGeneral.closedGates).toEqual(['classification_undeclared']);

    const asSimulated = await decide({
      ...item,
      classification: 'mature_simulated',
    });
    expect(asSimulated.closedGates).toContain('classification_undeclared');
  });

  it('refuses a reclassification taken against a stale read', async () => {
    const item = await classified('general');
    const current = await gate.classificationFor(item.contentId);
    if (current === undefined) throw new Error('setup failed');

    const changed = await gate.classify({
      classification: 'mature_simulated',
      ...item,
      expectedVersion: current.version,
    });
    expect(changed.kind).toBe('recorded');

    const stale = await gate.classify({
      classification: 'general',
      ...item,
      expectedVersion: current.version,
    });
    expect(stale.kind).toBe('conflict');

    const unversioned = await gate.classify({
      classification: 'general',
      ...item,
    });
    expect(unversioned.kind).toBe('conflict');
  });
});

describe('enforcement closes the gate whatever the class is', () => {
  it('refuses a creator whose publication capability is suspended', async () => {
    const item = await classified('general');
    await database.drizzle.transaction((executor) =>
      authority.impose(executor, {
        actorReference: operator,
        reasonCode: 'sexual_content_violation',
        scope: 'creator_suspension',
        subjectId: item.creatorId,
      }),
    );

    const decision = await decide({ ...item, classification: 'general' });
    // An enforcement decision is not about maturity, so this gate applies to
    // the ordinary content the platform actually carries.
    expect(decision.allowed).toBe(false);
    expect(decision.closedGates).toEqual(['creator_restricted']);
  });

  it('refuses an item an operator took out of view', async () => {
    const item = await classified('general');
    await database.drizzle.transaction((executor) =>
      authority.impose(executor, {
        actorReference: operator,
        reasonCode: 'sexual_content_violation',
        scope: 'creator_object_removal',
        subjectId: item.creatorId,
        targetObjectId: item.contentId,
        targetObjectType: 'creator_content',
      }),
    );

    const decision = await decide({
      ...item,
      capability: 'remain_public',
      classification: 'general',
    });
    expect(decision.closedGates).toEqual(['object_restricted']);
    // The creator's other work is untouched: one item removed is not a
    // capability suspended.
    const other = await decide({
      classification: 'general',
      contentId: crypto.randomUUID(),
      creatorId: item.creatorId,
    });
    expect(other.allowed).toBe(true);
  });

  it('asks commercial participation of a monetisation rather than publication', async () => {
    const item = await classified('general');
    await database.drizzle.transaction((executor) =>
      authority.impose(executor, {
        actorReference: operator,
        reasonCode: 'platform_integrity',
        scope: 'creator_suspension',
        subjectId: item.creatorId,
      }),
    );

    // A suspension denies both today. They stay separate questions because the
    // moment a scope stops one without the other, that must be one row of a map
    // rather than a change at every call site.
    expect(
      (
        await decide({
          ...item,
          capability: 'monetise',
          classification: 'general',
        })
      ).closedGates,
    ).toEqual(['creator_restricted']);
  });
});

describe('the capability cannot be turned on', () => {
  it('offers exactly one configured value, and it is off', () => {
    const config = testServerConfig();
    expect(config.SAFETY_MATURE_CONTENT).toBe('disabled');
    // Not a flag. The schema admits no other value in any environment, so
    // there is no state to flip and no dormant feature to enable remotely.
    expect(() =>
      testServerConfig({ SAFETY_MATURE_CONTENT: 'enabled' }),
    ).toThrow();
  });
});
