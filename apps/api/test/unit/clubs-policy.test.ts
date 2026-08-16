import { describe, expect, it } from 'bun:test';
import {
  creatorContentLifecycleValues,
  creatorContentVisibilityValues,
  maximumContentMedia,
  maximumCreatorContentBodyLength,
  maximumCreatorContentSummaryLength,
  maximumCreatorContentTitleLength,
  minimumCreatorContentTitleLength,
} from '@velora/validation';

import * as schemaPolicy from '../../src/clubs/policy.js';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
} from '../../src/clubs/cursor.js';

/**
 * The database schema restates the published catalog bounds because
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations. This is the guard that makes the restatement safe.
 */
describe('catalog policy is stated once', () => {
  it('keeps the schema constants identical to the published contract', () => {
    expect(schemaPolicy.minimumCreatorContentTitleLength).toBe(
      minimumCreatorContentTitleLength,
    );
    expect(schemaPolicy.maximumCreatorContentTitleLength).toBe(
      maximumCreatorContentTitleLength,
    );
    expect(schemaPolicy.maximumCreatorContentSummaryLength).toBe(
      maximumCreatorContentSummaryLength,
    );
    expect(schemaPolicy.maximumContentMedia).toBe(maximumContentMedia);
    expect(schemaPolicy.maximumCreatorContentBodyLength).toBe(
      maximumCreatorContentBodyLength,
    );
    expect([...schemaPolicy.creatorContentLifecycles]).toEqual([
      ...creatorContentLifecycleValues,
    ]);
    expect([...schemaPolicy.creatorContentVisibilities]).toEqual([
      ...creatorContentVisibilityValues,
    ]);
  });

  it('bounds a page below what a caller could ask for', () => {
    expect(schemaPolicy.defaultCatalogPageSize).toBeLessThanOrEqual(
      schemaPolicy.maximumCatalogPageSize,
    );
  });
});

describe('the catalog cursor', () => {
  const cursor = {
    id: '11111111-1111-4111-8111-111111111111',
    moment: new Date('2026-08-15T12:00:00.000Z'),
  };

  it('round-trips a position exactly', () => {
    const decoded = decodeCatalogCursor(encodeCatalogCursor(cursor));
    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.moment.toISOString()).toBe(cursor.moment.toISOString());
  });

  it('refuses anything that is not one', () => {
    // A tampered cursor is a position the server does not recognise, never a
    // different query. Every one of these reads as "no position".
    for (const value of [
      'not-base64url!!',
      Buffer.from('{}', 'utf8').toString('base64url'),
      Buffer.from(
        JSON.stringify({ i: 'nope', t: cursor.moment }),
        'utf8',
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({ i: cursor.id, t: 'never' }),
        'utf8',
      ).toString('base64url'),
      Buffer.from(JSON.stringify({ i: cursor.id }), 'utf8').toString(
        'base64url',
      ),
    ]) {
      expect(decodeCatalogCursor(value), value).toBeUndefined();
    }
  });
});
