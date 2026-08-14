import { describe, expect, it } from 'bun:test';

import {
  decodeFeedCursor,
  encodeFeedCursor,
  tieBreakWindowFor,
} from '../../src/discovery/cursor.js';
import { tieBreakRotationMilliseconds } from '../../src/discovery/policy.js';

describe('feed cursor', () => {
  it('round-trips a position and the window it was taken in', () => {
    const cursor = encodeFeedCursor({
      after: '0-97-9998234567-0123456789abcdef0123456789abcdef-'.concat(
        '11111111-2222-3333-4444-555555555555',
      ),
      window: 20_123,
    });
    const decoded = decodeFeedCursor(cursor);
    expect(decoded?.window).toBe(20_123);
    expect(decoded?.after).toContain('11111111-2222-3333-4444-555555555555');
  });

  it('carries no account identifier, so it cannot name another reader', () => {
    const viewerId = '11111111-2222-3333-4444-555555555555';
    const cursor = encodeFeedCursor({
      after: '0-99-0000000001-ab-cd',
      window: 1,
    });
    // A cursor is a position in the caller's own feed, never a claim about who
    // the caller is: the acting account always comes from the credential.
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toContain(
      viewerId,
    );
  });

  it('refuses anything it did not produce', () => {
    const cases = [
      '',
      'not a cursor',
      'a'.repeat(600),
      Buffer.from('[]', 'utf8').toString('base64url'),
      Buffer.from('{"a":"ok"}', 'utf8').toString('base64url'),
      Buffer.from('{"w":1}', 'utf8').toString('base64url'),
      Buffer.from('{"a":"../etc/passwd","w":1}', 'utf8').toString('base64url'),
      Buffer.from('{"a":"0-0-0","w":-1}', 'utf8').toString('base64url'),
      Buffer.from('{"a":"0-0-0","w":1.5}', 'utf8').toString('base64url'),
      Buffer.from(`{"a":"${'0'.repeat(200)}","w":1}`, 'utf8').toString(
        'base64url',
      ),
    ];
    for (const value of cases) {
      expect(decodeFeedCursor(value), value.slice(0, 24)).toBeUndefined();
    }
  });
});

describe('tie-break rotation', () => {
  it('is stable inside a window and different across one', () => {
    const start = new Date('2026-08-14T00:00:00.000Z');
    const sameWindow = new Date(start.getTime() + 60_000);
    const nextWindow = new Date(
      start.getTime() + tieBreakRotationMilliseconds + 60_000,
    );
    const window = (moment: Date) =>
      tieBreakWindowFor(moment, tieBreakRotationMilliseconds);

    expect(window(sameWindow)).toBe(window(start));
    expect(window(nextWindow)).not.toBe(window(start));
    // Monotonic, so a window number never revisits an earlier ordering.
    expect(window(nextWindow)).toBeGreaterThan(window(start));
  });
});
