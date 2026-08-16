import { mediaImageFormats, type MediaImageFormat } from './policy.js';

/**
 * What a file actually is, decided from its own first bytes.
 *
 * **This runs before any decoder is invoked, and that ordering is the control.**
 * The platform's decoder is libvips, and its prebuilt reports `svg: input=true`
 * — it will happily render an SVG document to pixels and report sensible
 * dimensions. An allow-list expressed as "whatever the decoder accepts" would
 * therefore accept an XML dialect with script capability on a social platform.
 * So format admission is a platform decision taken here, on sniffed bytes, and
 * the decoder is only ever asked about formats already admitted.
 *
 * Nothing a client said is consulted. There is no filename here, no extension,
 * and no declared content type, because none of them is evidence.
 */

interface Signature {
  readonly format: MediaImageFormat;
  readonly matches: (bytes: Uint8Array) => boolean;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length &&
  prefix.every((byte, offset) => bytes[offset] === byte);

const accepted: readonly Signature[] = [
  {
    format: 'jpeg',
    matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  },
  {
    format: 'png',
    matches: (bytes) =>
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    // A RIFF container carrying a WEBP form type at offset 8. Both halves are
    // checked: `RIFF` alone is also WAV, AVI, and several other things.
    format: 'webp',
    matches: (bytes) =>
      bytes.length >= 12 &&
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      [0x57, 0x45, 0x42, 0x50].every(
        (byte, offset) => bytes[offset + 8] === byte,
      ),
  },
];

/**
 * The accepted format, or `undefined` for everything else.
 *
 * `undefined` covers a great deal: SVG, GIF, TIFF, BMP, HEIC, AVIF, PDF, ZIP,
 * HTML, and arbitrary bytes are all simply not on the list. They are not
 * enumerated as "rejected formats", because an allow-list that grows a
 * deny-list beside it eventually gets a case added to the wrong one.
 */
export function sniffMediaFormat(
  bytes: Uint8Array,
): MediaImageFormat | undefined {
  return accepted.find((signature) => signature.matches(bytes))?.format;
}

/**
 * Narrows a value read back from a database row or a decoder.
 *
 * The decoder reports its own idea of the format, and inspection compares it
 * against the sniffed one. A file that is a JPEG by its header and something
 * else to the decoder is a polyglot, and disagreement is the signal.
 */
export function isMediaImageFormat(value: string): value is MediaImageFormat {
  return (mediaImageFormats as readonly string[]).includes(value);
}
