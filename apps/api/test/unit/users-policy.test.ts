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
import { sniffProfileMediaContentType } from '../../src/users/media-bytes.js';

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
 * `docs/security/04-media-upload-delivery.md` forbids trusting a client-supplied
 * MIME type. These are the bytes the platform decides from instead.
 */
describe('profile media content type is decided from bytes', () => {
  it('recognises the accepted image formats', () => {
    expect(
      sniffProfileMediaContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe('image/jpeg');
    expect(
      sniffProfileMediaContentType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
    expect(
      sniffProfileMediaContentType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ),
    ).toBe('image/webp');
  });

  it('refuses anything else, including a truncated header', () => {
    expect(sniffProfileMediaContentType(new Uint8Array())).toBeUndefined();
    expect(
      sniffProfileMediaContentType(new Uint8Array([0xff, 0xd8])),
    ).toBeUndefined();
    // A RIFF container that is not WEBP, such as a WAV file.
    expect(
      sniffProfileMediaContentType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56,
          0x45,
        ]),
      ),
    ).toBeUndefined();
    // An SVG would be text; scripts inside it are exactly why it is refused.
    expect(
      sniffProfileMediaContentType(
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'),
      ),
    ).toBeUndefined();
  });
});
