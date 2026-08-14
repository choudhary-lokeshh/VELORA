import { describe, expect, it } from 'bun:test';
import {
  creatorAccountStatusReasonValues,
  creatorAccountStatusValues,
  creatorOnboardingStepValues,
  creatorPolicyKeyValues,
} from '@velora/validation';

import {
  creatorAccountStatusReasons,
  creatorAccountStatuses,
  creatorPolicyKeys,
} from '../../src/creators/schema.js';
import {
  creatorAudience,
  creatorRequiredAssurance,
  requiredCreatorPolicyDocuments,
  unpublishedCreatorPolicyVersion,
} from '../../src/creators/policy.js';
import { creatorAccountBody } from '../../src/creators/routes.js';
import type { CreatorAccountRow } from '../../src/creators/repository.js';

/**
 * The database schema restates the published creator vocabulary because
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations. This is the guard that makes the restatement safe: if the two ever
 * disagree, the database would enforce something other than what the contract
 * promises, and that must fail the build rather than reach a migration.
 */
describe('creator vocabulary is stated once', () => {
  it('keeps the schema values identical to the published contract', () => {
    expect([...creatorAccountStatuses]).toEqual([
      ...creatorAccountStatusValues,
    ]);
    expect([...creatorAccountStatusReasons]).toEqual([
      ...creatorAccountStatusReasonValues,
    ]);
    expect([...creatorPolicyKeys]).toEqual([...creatorPolicyKeyValues]);
  });

  it('publishes exactly the steps the service can derive', () => {
    expect([...creatorOnboardingStepValues]).toEqual([
      'adult_eligibility',
      'policy_acknowledgement',
      'completed',
    ]);
  });
});

describe('creator admission policy', () => {
  it('requires every creator policy document at an unpublished version', () => {
    expect(requiredCreatorPolicyDocuments.length).toBeGreaterThan(0);
    for (const document of requiredCreatorPolicyDocuments) {
      // No approved creator legal copy exists. A version that looked published
      // would be a claim this repository is not entitled to make.
      expect(document.version).toBe(unpublishedCreatorPolicyVersion);
      expect(creatorPolicyKeys).toContain(document.key);
    }
    expect(
      requiredCreatorPolicyDocuments.map((document) => document.key),
    ).toEqual([...creatorPolicyKeys]);
  });

  it('requires no more assurance than the platform can actually establish', () => {
    // Raising this to `verified_adult` without an approved provider would make
    // creator capability unreachable in every environment rather than stricter.
    expect(creatorRequiredAssurance).toBe('self_declared');
  });

  it('admits creator authority from Creator Studio alone', () => {
    expect(creatorAudience).toBe('creator_studio');
  });
});

describe('creator capability projection', () => {
  const row = (
    overrides: Partial<CreatorAccountRow> = {},
  ): CreatorAccountRow => ({
    activatedAt: null,
    authAccountId: '11111111-1111-4111-8111-111111111111',
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id: '22222222-2222-4222-8222-222222222222',
    status: 'applicant',
    statusChangedAt: new Date('2026-01-01T00:00:00.000Z'),
    statusReason: 'onboarding_incomplete',
    suspendedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  it('carries no AUTH identifier and no internal timestamps', () => {
    const body = creatorAccountBody(row());

    expect(Object.keys(body).toSorted()).toEqual([
      'createdAt',
      'id',
      'status',
      'statusReason',
    ]);
    expect(JSON.stringify(body)).not.toContain(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('omits the status reason exactly when the capability is active', () => {
    const active = creatorAccountBody(
      row({
        activatedAt: new Date('2026-02-01T00:00:00.000Z'),
        status: 'active',
        statusReason: null,
      }),
    );

    expect(active.statusReason).toBeUndefined();
    expect(active.activatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('keeps the activation instant after a suspension', () => {
    // When a capability was activated is a fact. A suspension is a different
    // fact, and one must not erase the other.
    const suspended = creatorAccountBody(
      row({
        activatedAt: new Date('2026-02-01T00:00:00.000Z'),
        status: 'suspended',
        statusReason: 'safety_enforcement',
        suspendedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    );

    expect(suspended.activatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(suspended.statusReason).toBe('safety_enforcement');
    expect(JSON.stringify(suspended)).not.toContain('2026-03-01');
  });
});
