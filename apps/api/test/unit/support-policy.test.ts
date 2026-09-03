import { describe, expect, it } from 'bun:test';
import {
  maximumSupportDescriptionCharacters as contractMaximumDescription,
  maximumSupportNoteCharacters as contractMaximumNote,
  maximumSupportSubjectCharacters as contractMaximumSubject,
  minimumSupportDescriptionCharacters as contractMinimumDescription,
  minimumSupportSubjectCharacters as contractMinimumSubject,
  createSupportTicketRequestSchema,
  idempotencyKeySchema,
  supportCategorySchema,
  supportReferencePattern,
  supportTicketStatusSchema,
} from '@velora/validation';

import {
  mayTransition,
  maximumOpenSupportTickets,
  maximumSupportClientTicketIdCharacters,
  maximumSupportDescriptionCharacters,
  maximumSupportNoteCharacters,
  maximumSupportSubjectCharacters,
  minimumSupportClientTicketIdCharacters,
  minimumSupportDescriptionCharacters,
  minimumSupportSubjectCharacters,
  openSupportTicketStatuses,
  supportCategories,
  supportReferenceAlphabet,
  supportRequiresNoProvider,
  supportStatusTransitions,
  supportTicketRateLimitCount,
  supportTicketStatuses,
} from '../../src/support/policy.js';
import { mintSupportReference } from '../../src/support/service.js';

/**
 * The SUPPORT schema module restates the contract's bounds because
 * `drizzle-kit` reads it through a CommonJS resolver that cannot follow the
 * validation package's import-only exports — the same constraint LIVE and
 * MESSAGING record. Restating is only safe while drift is impossible, which is
 * what these assertions are for.
 */
describe('support bounds match the published contract', () => {
  it('bounds a subject and a description identically in both places', () => {
    expect(minimumSupportSubjectCharacters).toBe(contractMinimumSubject);
    expect(maximumSupportSubjectCharacters).toBe(contractMaximumSubject);
    expect(minimumSupportDescriptionCharacters).toBe(
      contractMinimumDescription,
    );
    expect(maximumSupportDescriptionCharacters).toBe(
      contractMaximumDescription,
    );
    expect(maximumSupportNoteCharacters).toBe(contractMaximumNote);
  });

  it('bounds the client ticket identifier the way every other one is bounded', () => {
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumSupportClientTicketIdCharacters),
      ).success,
    ).toBe(true);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(minimumSupportClientTicketIdCharacters - 1),
      ).success,
    ).toBe(false);
    expect(
      idempotencyKeySchema.safeParse(
        'a'.repeat(maximumSupportClientTicketIdCharacters + 1),
      ).success,
    ).toBe(false);
  });

  it('publishes the same categories and statuses the database enforces', () => {
    expect(supportCategorySchema.options).toEqual([...supportCategories]);
    expect(supportTicketStatusSchema.options).toEqual([
      ...supportTicketStatuses,
    ]);
  });
});

describe('a support status is a claim about what happened', () => {
  it('names only the moves that are coherent', () => {
    // A ticket does not become unlooked-at again, and it does not go straight
    // from settled to unopened.
    expect(mayTransition('received', 'in_review')).toBe(true);
    expect(mayTransition('in_review', 'resolved')).toBe(true);
    expect(mayTransition('resolved', 'in_review')).toBe(true);
    expect(mayTransition('closed', 'in_review')).toBe(true);
    expect(mayTransition('resolved', 'received')).toBe(false);
    expect(mayTransition('closed', 'received')).toBe(false);
    expect(mayTransition('in_review', 'received')).toBe(false);
  });

  it('never names a status as a move to itself', () => {
    // Idempotence is the service's answer, not a transition: a history entry
    // saying "still resolved" describes no change.
    for (const status of supportTicketStatuses) {
      expect(supportStatusTransitions[status], status).not.toContain(status);
    }
  });

  it('treats exactly the two unanswered states as open', () => {
    expect([...openSupportTicketStatuses]).toEqual(['received', 'in_review']);
  });

  it('keeps the open bound tighter than the rate bound', () => {
    // They stop different things: the rate bound stops a burst, and this stops
    // a backlog nobody could answer being built one ticket a day. If the open
    // bound were the looser of the two it would never be the one that applies.
    expect(maximumOpenSupportTickets).toBeLessThan(supportTicketRateLimitCount);
  });
});

describe('a reference is something a person can read out loud', () => {
  it('excludes every character somebody reads back wrong', () => {
    for (const character of 'ILOU') {
      expect(supportReferenceAlphabet, character).not.toContain(character);
    }
  });

  it('mints references in the published shape, every time', () => {
    const minted = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const reference = mintSupportReference();
      expect(supportReferencePattern.test(reference), reference).toBe(true);
      minted.add(reference);
    }
    // Not a proof of uniqueness, which the unique index owns. What it rules out
    // is a generator that returns the same value, which a bad modulo or a
    // mis-seeded buffer would.
    expect(minted.size).toBeGreaterThan(490);
  });
});

describe('support depends on nothing that can be switched off', () => {
  it('has no provider, and says so', () => {
    // The whole reason a ticket is a row in this database rather than a call to
    // a hosted help desk: the one path a person uses when everything else has
    // failed them must not itself depend on something that can fail or cost
    // money. There is no configuration value to assert here, and that absence
    // is the property.
    expect(supportRequiresNoProvider).toBe(true);
  });

  it('refuses a submission that says nothing', () => {
    const parsed = createSupportTicketRequestSchema.safeParse({
      category: 'other',
      clientTicketId: 'a'.repeat(16),
      description: 'short',
      subject: 'Hi',
    });
    expect(parsed.success).toBe(false);
  });
});
