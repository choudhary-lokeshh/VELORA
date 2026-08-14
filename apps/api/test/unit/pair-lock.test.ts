import { describe, expect, it } from 'bun:test';

import { pairLockKey } from '../../src/database/pair-lock.js';

/**
 * The pair lock's key derivation.
 *
 * Everything this lock guarantees rests on two people always producing one key.
 * The cases below are the ways that could fail: argument order, letter case,
 * and a caller that passes the same person twice.
 */

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

describe('the pair lock key', () => {
  it('is the same whichever of the two is acting', () => {
    // The pair is unordered as a fact and ordered as a key, which is what makes
    // "these two people" one lock rather than two.
    expect(pairLockKey(alice, bob)).toBe(pairLockKey(bob, alice));
  });

  it('is the same however a caller spells the identifier', () => {
    // A UUID is case-insensitive as a value and case-sensitive as a string, and
    // some of these identifiers arrive in a request body. Without this, a
    // caller could take a different lock for the same pair simply by shouting.
    expect(pairLockKey(alice.toUpperCase(), bob)).toBe(pairLockKey(alice, bob));
    expect(pairLockKey(alice, bob.toUpperCase())).toBe(pairLockKey(alice, bob));
    expect(pairLockKey(alice.toUpperCase(), bob.toUpperCase())).toBe(
      pairLockKey(alice, bob),
    );
    // And ordering survives the normalization: upper case sorts before lower
    // case in a plain string comparison, so a key built before lower-casing
    // would order the pair differently.
    expect(pairLockKey(bob.toUpperCase(), alice)).toBe(pairLockKey(alice, bob));
  });

  it('separates different pairs', () => {
    const carol = '33333333-3333-4333-8333-333333333333';
    expect(pairLockKey(alice, bob)).not.toBe(pairLockKey(alice, carol));
    expect(pairLockKey(alice, bob)).not.toBe(pairLockKey(bob, carol));
  });

  it('produces a key for a caller that names the same person twice', () => {
    // Nothing in the product asks for this, but a lock function that threw on
    // it would turn a caller's mistake into an unhandled failure inside a
    // transaction that was about to make a safety decision.
    expect(pairLockKey(alice, alice)).toBe(`${alice}:${alice}`);
  });
});
