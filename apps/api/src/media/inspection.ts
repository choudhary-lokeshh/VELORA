import sharp from 'sharp';
import type { Metadata } from 'sharp';

import {
  maximumMediaDimension,
  maximumMediaFrames,
  maximumMediaMetadataBytes,
  maximumMediaPixels,
  maximumMediaReadBytes,
  mediaDecodeProbePixels,
  type MediaRejectionReason,
} from './policy.js';
import type { MediaInspectionFacts } from './repository.js';
import { sniffMediaFormat } from './sniff.js';
import {
  MediaScannerUnavailableError,
  type MediaScannerPort,
} from './scanner.js';
import type { MediaStoragePort } from './storage.js';

/**
 * What an object actually is, derived from the object itself.
 *
 * Every fact here comes from the stored bytes. Nothing a client declared is
 * read, and nothing the provider reported about content type is believed: a
 * provider that echoes a client-supplied header is echoing the client.
 *
 * The order of the checks is deliberate and is the cheap-first rule applied to
 * an adversary rather than to a happy path. Size before format, format before
 * decoder, header before pixels. Every step that can refuse without invoking a
 * parser does so, because the parser is the component being fed hostile input
 * and the least of it that runs, the better.
 */

export type MediaInspectionOutcome =
  | { readonly facts: MediaInspectionFacts; readonly kind: 'inspected' }
  | { readonly kind: 'quarantined'; readonly reason: MediaRejectionReason };

export interface MediaInspectorDependencies {
  readonly scanner: MediaScannerPort;
  readonly storage: MediaStoragePort;
}

export class MediaInspector {
  constructor(private readonly dependencies: MediaInspectorDependencies) {}

  async inspect(objectKey: string): Promise<MediaInspectionOutcome> {
    const { scanner, storage } = this.dependencies;

    // 1. Bytes, bounded. An object beyond the ceiling is refused by measurement
    //    rather than read into memory and refused afterwards.
    const read = await storage.readObject({
      maximumBytes: maximumMediaReadBytes,
      objectKey,
    });
    if (read.kind === 'absent') return quarantine('object_missing');
    if (read.kind === 'too_large') return quarantine('too_large');
    const bytes = read.bytes;
    if (bytes.byteLength === 0) return quarantine('empty_object');

    // 2. Format, from the object's own header, before any decoder exists in
    //    this function. libvips would render an SVG document quite happily.
    const sniffed = sniffMediaFormat(bytes);
    if (sniffed === undefined) return quarantine('unsupported_format');

    const digest = digestOf(bytes);

    // 3. The header. `metadata` parses rather than decodes, so this is the
    //    cheapest question the decoder can answer — and it is asked with the
    //    pixel limit *off* on purpose. With the limit on, libvips refuses a
    //    pixel bomb by throwing, and every bomb would be recorded as merely
    //    undecodable; with it off, the claimed dimensions come back and the
    //    platform applies its own ceiling below and says exactly why. Reading a
    //    header allocates nothing whatever the header claims, so this buys a
    //    precise refusal at no cost. The decode probe keeps the limit on.
    let metadata;
    try {
      metadata = await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: false,
        sequentialRead: true,
      }).metadata();
    } catch {
      // The decoder's own message is not recorded. It names internals, and the
      // reason this asset was refused is a platform fact rather than a libvips
      // one.
      return quarantine('undecodable');
    }

    // 4. Disagreement between the header and the decoder is the polyglot
    //    signal. A file that is a JPEG by its first three bytes and something
    //    else to the decoder is not a file this platform accepts.
    if (metadata.format !== sniffed) return quarantine('unsupported_format');

    // The decoder's types promise these are numbers. `Number.isInteger` is a
    // runtime check rather than a type narrowing, deliberately: a hostile file
    // is exactly the case where a library's declared type and what it actually
    // returns are most likely to differ, and this costs nothing.
    const { height, width } = metadata;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return quarantine('undecodable');
    }
    if (width > maximumMediaDimension || height > maximumMediaDimension) {
      return quarantine('dimensions_exceeded');
    }
    // Checked from the header rather than discovered during a decode, which is
    // the difference between refusing a pixel bomb and allocating one.
    if (width * height > maximumMediaPixels) {
      return quarantine('pixel_limit_exceeded');
    }

    const frameCount = metadata.pages ?? 1;
    if (frameCount > maximumMediaFrames) {
      return quarantine('frame_limit_exceeded');
    }

    if (metadataBytesOf(metadata) > maximumMediaMetadataBytes) {
      return quarantine('metadata_limit_exceeded');
    }

    // 5. Decodability, proven by decoding. A header that parses is a weaker
    //    claim than the one processing depends on, so the pipeline pays for a
    //    bounded thumbnail here rather than discovering the truth in Phase 4.
    try {
      await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: maximumMediaPixels,
        sequentialRead: true,
      })
        .resize({
          fit: 'inside',
          height: mediaDecodeProbePixels,
          width: mediaDecodeProbePixels,
        })
        .raw()
        .toBuffer();
    } catch {
      return quarantine('undecodable');
    }

    // 6. Scanning, last, because it is the only step that may reach a provider
    //    and the only one whose absence is itself a refusal. An unavailable
    //    scanner quarantines; it never passes.
    try {
      const verdict = await scanner.scan({ bytes, objectKey });
      if (verdict !== 'clean') return quarantine('scan_refused');
    } catch (error) {
      if (error instanceof MediaScannerUnavailableError) {
        return quarantine('scan_refused');
      }
      // A scanner that failed for any other reason has not said the object is
      // clean, and inspection will not say it on the scanner's behalf.
      return quarantine('scan_refused');
    }

    return {
      facts: {
        byteSize: bytes.byteLength,
        detectedFormat: sniffed,
        digest,
        frameCount,
        height,
        width,
      },
      kind: 'inspected',
    };
  }
}

function quarantine(reason: MediaRejectionReason): MediaInspectionOutcome {
  return { kind: 'quarantined', reason };
}

function digestOf(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/**
 * How much of the object is metadata rather than image.
 *
 * Summed across the blocks the decoder exposes. It is an approximation of the
 * container's overhead and it is meant to be: the control is a ceiling on
 * "mostly metadata", not an exact accounting of a JPEG's segment table.
 */
function metadataBytesOf(metadata: Metadata): number {
  return (
    (metadata.exif?.byteLength ?? 0) +
    (metadata.icc?.byteLength ?? 0) +
    (metadata.iptc?.byteLength ?? 0) +
    (metadata.xmp?.byteLength ?? 0) +
    (metadata.tifftagPhotoshop?.byteLength ?? 0)
  );
}
