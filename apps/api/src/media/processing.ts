import sharp from 'sharp';

import {
  maximumMediaPixels,
  mediaProcessingVersion,
  mediaVariantFormat,
  mediaVariantGeometry,
  mediaVariantQuality,
  type MediaImageFormat,
  type MediaVariantKind,
} from './policy.js';

/**
 * Producing the platform's own delivery artefacts.
 *
 * A derivative is **rendered from decoded pixels**, never assembled by copying
 * the source container. That single rule is what makes the privacy guarantee
 * hold: there is no path by which a source's EXIF, GPS, device identity,
 * colour profile, or embedded comment can reach an output, because the output
 * is built from pixels and an encoder rather than from the file it came from.
 *
 * Orientation is baked in for the same reason. A camera writes an orientation
 * tag and expects the viewer to honour it; the platform strips every tag, so a
 * derivative that had not been rotated during decode would render sideways
 * forever. Measured on this toolchain: a 120×60 source tagged orientation 6
 * becomes a 60×120 derivative when auto-oriented, and stays 120×60 — wrongly —
 * when it is not. Both are asserted in the suite.
 */

export interface MediaVariantRendition {
  readonly bytes: Uint8Array;
  readonly format: MediaImageFormat;
  readonly height: number;
  readonly width: number;
}

export interface MediaImageProcessorPort {
  /** Recorded on every object this processor writes. */
  readonly version: number;
  render(input: {
    readonly bytes: Uint8Array;
    readonly kind: MediaVariantKind;
  }): Promise<MediaVariantRendition>;
}

export class MediaProcessingFailedError extends Error {
  constructor() {
    // Carries no decoder text. A libvips message names internals, and what
    // failed is a platform fact rather than a library one.
    super('Media derivative could not be rendered');
    this.name = 'MediaProcessingFailedError';
  }
}

/**
 * The platform's image processor: sharp on libvips, in-process.
 *
 * A library rather than a provider. No bytes leave the machine, there is no
 * account, and no terms of service apply — which is the whole reason this is
 * done here: every assessed hosted image processor prohibits content Velora
 * does not author, so a resize behind a provider URL would have been a product
 * constraint rather than a convenience. See ADR-0023.
 */
export class SharpMediaImageProcessor implements MediaImageProcessorPort {
  readonly version = mediaProcessingVersion;

  async render(input: {
    readonly bytes: Uint8Array;
    readonly kind: MediaVariantKind;
  }): Promise<MediaVariantRendition> {
    const geometry = mediaVariantGeometry[input.kind];
    try {
      const { data, info } = await sharp(input.bytes, {
        failOn: 'warning',
        limitInputPixels: maximumMediaPixels,
        sequentialRead: true,
      })
        // Before the resize, so the pixels being resized are the ones a viewer
        // is meant to see.
        .autoOrient()
        .resize({
          fit: geometry.fit,
          height: geometry.height,
          // A source smaller than the box stays its own size. Upscaling would
          // produce a larger, blurrier copy and a recorded dimension that
          // describes padding rather than picture.
          width: geometry.width,
          withoutEnlargement: true,
        })
        .webp({ effort: 4, quality: mediaVariantQuality })
        // No `keepMetadata`, no `withMetadata`, no `withExif`. Metadata is
        // dropped because nothing asks for it to be kept, which is the version
        // of this that cannot be undone by an option somebody adds later
        // without noticing.
        .toBuffer({ resolveWithObject: true });

      return {
        bytes: new Uint8Array(data),
        format: mediaVariantFormat,
        height: info.height,
        width: info.width,
      };
    } catch {
      throw new MediaProcessingFailedError();
    }
  }
}
