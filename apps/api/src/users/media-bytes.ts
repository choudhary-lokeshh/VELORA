import {
  acceptedProfileMediaTypes,
  type ProfileMediaContentType,
} from '@velora/validation';

/**
 * Content-type identification from an object's own bytes.
 *
 * `docs/security/04-media-upload-delivery.md` forbids trusting a client-supplied
 * MIME type, filename, or URL, so every storage adapter decides an object's type
 * here rather than believing what it was told. This is deterministic byte
 * inspection, not a provider: it belongs to the platform and every adapter,
 * present and future, must use it.
 *
 * It is not a malware scanner and is not a substitute for one. Recognising a
 * JPEG header says the object is a JPEG, nothing more.
 */

const signatures: readonly {
  readonly contentType: ProfileMediaContentType;
  readonly matches: (bytes: Uint8Array) => boolean;
}[] = [
  {
    contentType: 'image/jpeg',
    matches: (bytes) =>
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
  },
  {
    contentType: 'image/png',
    matches: (bytes) =>
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, offset) => bytes[offset] === byte,
      ),
  },
  {
    // RIFF container with a WEBP form type at offset 8.
    contentType: 'image/webp',
    matches: (bytes) =>
      bytes.length >= 12 &&
      [0x52, 0x49, 0x46, 0x46].every(
        (byte, offset) => bytes[offset] === byte,
      ) &&
      [0x57, 0x45, 0x42, 0x50].every(
        (byte, offset) => bytes[offset + 8] === byte,
      ),
  },
];

export function sniffProfileMediaContentType(
  bytes: Uint8Array,
): ProfileMediaContentType | undefined {
  const match = signatures.find((signature) => signature.matches(bytes));
  return match?.contentType;
}

/**
 * Guard for the accepted set, so a value read back from storage or a database
 * row is narrowed rather than asserted.
 */
export function isAcceptedProfileMediaType(
  value: string,
): value is ProfileMediaContentType {
  return (acceptedProfileMediaTypes as readonly string[]).includes(value);
}
