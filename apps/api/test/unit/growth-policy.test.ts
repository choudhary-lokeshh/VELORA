import { describe, expect, it } from 'bun:test';

import {
  acquisitionEventNames,
  inviteCodeLength,
  maximumRecordedOpeningsPerWindow,
  mintInviteCode,
  normalizeAcquisitionParameter,
  openingRecordWindowMilliseconds,
} from '../../src/growth/policy.js';
import type { GrowthRepository } from '../../src/growth/repository.js';
import { GrowthService } from '../../src/growth/service.js';

/**
 * GROWTH's rules, and the one write in this product a caller with no account
 * can reach.
 *
 * `POST /v1/growth/invitations/{code}/openings` has to be public — the person
 * opening an invitation does not have an account yet — and it writes a row.
 * Deduplication is on a key the visitor's own browser mints, which is exactly
 * right for somebody refreshing and worth nothing against a script sending a
 * fresh key each time. These assertions are about what stops that, and about
 * what must not change when it does: the answer the page needs.
 */

/** A repository that records what it was asked and answers what a test says. */
function repositoryDouble(recorded: number) {
  const inserted: { name: string }[] = [];
  const usableCodes = new Set(['a'.repeat(inviteCodeLength)]);
  return {
    inserted,
    repository: {
      countEventsSince: (
        _executor: unknown,
        input: { readonly name: string; readonly since: Date },
      ) => {
        // The window the service asks about is the one the policy publishes.
        expect(Date.now() - input.since.getTime()).toBeGreaterThanOrEqual(
          openingRecordWindowMilliseconds - 5_000,
        );
        return Promise.resolve(recorded);
      },
      findUsableInviteByCode: (_executor: unknown, code: string) =>
        Promise.resolve(
          usableCodes.has(code) ? { code, id: 'invite-1' } : undefined,
        ),
      insertEvent: (_executor: unknown, input: { readonly name: string }) => {
        inserted.push({ name: input.name });
        return Promise.resolve();
      },
      transactionless: {},
    } as unknown as GrowthRepository,
  };
}

function serviceOver(repository: GrowthRepository): GrowthService {
  return new GrowthService({
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    } as unknown as GrowthService['dependencies']['logger'],
    now: () => new Date(),
    randomBytes: (size: number) => crypto.getRandomValues(new Uint8Array(size)),
    repository,
  });
}

describe('an invitation code', () => {
  it('is drawn from one alphabet at one length', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = mintInviteCode((size) =>
        crypto.getRandomValues(new Uint8Array(size)),
      );
      expect(code).toHaveLength(inviteCodeLength);
      expect(code).toMatch(/^[a-z0-9]+$/u);
    }
  });
});

describe('a campaign label somebody put in an address bar', () => {
  it('keeps a label and drops everything that is not one', () => {
    expect(normalizeAcquisitionParameter('spring   launch')).toBe(
      'spring launch',
    );
    expect(normalizeAcquisitionParameter('<script>alert(1)</script>')).toBe(
      'scriptalert1script',
    );
    expect(normalizeAcquisitionParameter('   ')).toBeUndefined();
    expect(normalizeAcquisitionParameter(undefined)).toBeUndefined();
  });
});

describe('recording that an invitation was opened', () => {
  it('writes the opening while the window is under its bound', async () => {
    const { inserted, repository } = repositoryDouble(0);
    const outcome = await serviceOver(repository).recordOpening({
      code: 'a'.repeat(inviteCodeLength),
      openingKey: 'k'.repeat(22),
    });

    expect(outcome).toEqual({ usable: true });
    expect(inserted).toEqual([{ name: 'invite_opened' }]);
  });

  it('records a code nobody holds as a refusal, under its own bound', async () => {
    const { inserted, repository } = repositoryDouble(0);
    const outcome = await serviceOver(repository).recordOpening({
      code: 'z'.repeat(inviteCodeLength),
      openingKey: 'k'.repeat(22),
    });

    expect(outcome).toEqual({ usable: false });
    expect(inserted).toEqual([{ name: 'invite_refused' }]);
  });

  it('stops writing at the bound and still answers the visitor truthfully', async () => {
    const { inserted, repository } = repositoryDouble(
      maximumRecordedOpeningsPerWindow,
    );
    const service = serviceOver(repository);

    // The answer is the product's answer and does not change: the page asked
    // whether this link works, and it still gets told.
    expect(
      await service.recordOpening({
        code: 'a'.repeat(inviteCodeLength),
        openingKey: 'k'.repeat(22),
      }),
    ).toEqual({ usable: true });
    expect(
      await service.recordOpening({
        code: 'z'.repeat(inviteCodeLength),
        openingKey: 'm'.repeat(22),
      }),
    ).toEqual({ usable: false });

    // What stopped is the row. A caller minting a new key per request past this
    // point writes nothing.
    expect(inserted).toEqual([]);
  });

  it('bounds each kind of opening on its own count', () => {
    // Two names, so a flood of refusals cannot exhaust the budget that records
    // the openings of a link somebody actually shared.
    expect(acquisitionEventNames).toContain('invite_opened');
    expect(acquisitionEventNames).toContain('invite_refused');
    expect(maximumRecordedOpeningsPerWindow).toBeGreaterThan(10_000);
  });
});
