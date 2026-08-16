import { describe, expect, it } from 'bun:test';
import {
  acceptedProfileMediaTypes,
  languagePattern,
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileMedia,
  maximumProfileMediaBytes,
  minimumDisplayNameLength,
} from '@velora/validation';

import * as schemaPolicy from '../../src/users/profile-policy.js';
import {
  isProfileComplete,
  outstandingProfileRequirements,
} from '../../src/users/profile-repository.js';

/**
 * The database schema restates the published profile bounds because
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations. This is the guard that makes the restatement safe: if the two ever
 * disagree, the database would enforce something other than what the contract
 * promises, and that must fail the build rather than reach a migration.
 */
describe('profile policy is stated once', () => {
  it('keeps the schema constants identical to the published contract', () => {
    expect(schemaPolicy.minimumDisplayNameLength).toBe(
      minimumDisplayNameLength,
    );
    expect(schemaPolicy.maximumDisplayNameLength).toBe(
      maximumDisplayNameLength,
    );
    expect(schemaPolicy.maximumBioLength).toBe(maximumBioLength);
    expect(schemaPolicy.maximumProfileMedia).toBe(maximumProfileMedia);
    expect(schemaPolicy.maximumProfileMediaBytes).toBe(
      maximumProfileMediaBytes,
    );
    expect(schemaPolicy.languagePattern.source).toBe(languagePattern.source);
    expect(schemaPolicy.languagePattern.flags).toBe(languagePattern.flags);
    expect([...schemaPolicy.acceptedProfileMediaTypes]).toEqual([
      ...acceptedProfileMediaTypes,
    ]);
  });
});

describe('minimum discoverable profile', () => {
  const complete = {
    hasDisplayName: true,
    hasLanguage: true,
    hasReadyMedia: true,
    hasRegion: true,
  };

  it('is complete only when every approved requirement is met', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(outstandingProfileRequirements(complete)).toEqual([]);
    for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
      expect(isProfileComplete({ ...complete, [key]: false })).toBe(false);
    }
  });

  it('names exactly what is missing, and nothing about the values', () => {
    expect(
      outstandingProfileRequirements({
        hasDisplayName: false,
        hasLanguage: false,
        hasReadyMedia: false,
        hasRegion: false,
      }),
    ).toEqual(['display_name', 'language', 'ready_media', 'region']);
  });
});

/**
 * Deciding a file's type from its bytes moved to the media platform, along with
 * every other question about what an object actually is. It is tested there,
 * against a decoder that genuinely runs, and this domain no longer restates the
 * answer. See `apps/api/test/unit/media-policy.test.ts`.
 */
