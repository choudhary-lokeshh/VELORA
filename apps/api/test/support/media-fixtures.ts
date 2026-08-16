import sharp from 'sharp';

/**
 * Deterministic media fixtures, generated rather than committed.
 *
 * Nothing here is a stored binary. Every fixture is built at test time from a
 * description, which keeps hostile inputs out of the repository, keeps the
 * repository small, and makes each fixture's intent readable as code instead of
 * as an opaque file somebody would have to trust.
 *
 * Nothing here is real malware. The scanner fixture carries a Velora marker
 * string that the development scanner refuses on sight; committing an actual
 * test signature would have local anti-virus and CI scanners quarantine the
 * repository's own fixtures, and the point is a deterministic refusal rather
 * than a real detection.
 */

/** A valid image of the given format, at the given size. */
export async function image(input: {
  readonly format: 'jpeg' | 'png' | 'webp';
  readonly height?: number;
  readonly width?: number;
}): Promise<Uint8Array> {
  const pipeline = sharp({
    create: {
      background: { b: 200, g: 120, r: 10 },
      channels: 3,
      height: input.height ?? 64,
      width: input.width ?? 64,
    },
  });
  const encoded =
    input.format === 'jpeg'
      ? await pipeline.jpeg({ quality: 80 }).toBuffer()
      : input.format === 'png'
        ? await pipeline.png().toBuffer()
        : await pipeline.webp({ quality: 80 }).toBuffer();
  return new Uint8Array(encoded);
}

/**
 * A JPEG carrying a large EXIF block, for the metadata ceiling.
 *
 * The APP1 segment is spliced in by hand rather than written through the
 * encoder, because the encoder truncates what it is given: asking it for two
 * hundred kilobytes of `ImageDescription` produced a hundred and ninety-eight
 * bytes, which would have made this fixture quietly prove nothing.
 */
export async function imageWithMetadata(
  payloadBytes: number,
): Promise<Uint8Array> {
  const jpeg = Buffer.from(
    await image({ format: 'jpeg', height: 32, width: 32 }),
  );
  // `Exif\0\0`, then a little-endian TIFF header with one directory entry, then
  // the padding that makes the segment large.
  const body = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x0e, 0x01,
      0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x41, 0x41, 0x41, 0x00,
    ]),
    Buffer.alloc(payloadBytes, 0x41),
  ]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(body.length + 2, 2);
  return new Uint8Array(
    Buffer.concat([jpeg.subarray(0, 2), marker, body, jpeg.subarray(2)]),
  );
}

/**
 * An animated WebP, for the frame ceiling.
 *
 * Built by converting a hand-written two-frame GIF, because sharp will not
 * produce a multi-page WebP from a tall raw buffer — it needs an input that
 * already carries page count, and a GIF is the smallest thing that does.
 */
export async function animatedWebp(): Promise<Uint8Array> {
  const encoded = await sharp(Buffer.from(animatedGif()), { animated: true })
    .webp()
    .toBuffer();
  return new Uint8Array(encoded);
}

/** A minimal two-frame GIF89a with a Netscape looping block. */
function animatedGif(): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x02, 0x00, 0xf0, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xff, 0x0b, 0x4e, 0x45,
    0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00,
    0x00, 0x00, 0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01,
    0x00, 0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x02, 0x02, 0x8c, 0x01, 0x00,
    0x3b,
  ]);
}

/**
 * A PNG whose header claims enormous dimensions.
 *
 * Constructed by editing a real PNG's IHDR rather than by encoding one, because
 * encoding it would mean allocating it — which is the very thing the platform
 * refuses to do. The CRC is recomputed so the chunk is well-formed and the
 * decoder reaches the dimensions rather than rejecting the chunk first.
 */
export async function pixelBombPng(input: {
  readonly height: number;
  readonly width: number;
}): Promise<Uint8Array> {
  const base = Buffer.from(await image({ format: 'png', height: 8, width: 8 }));
  // 8-byte signature, then the IHDR chunk: 4 length, 4 type, then width and
  // height as big-endian 32-bit integers.
  const ihdrData = 8 + 4 + 4;
  base.writeUInt32BE(input.width, ihdrData);
  base.writeUInt32BE(input.height, ihdrData + 4);
  const chunkLength = base.readUInt32BE(8);
  const crcStart = ihdrData - 4;
  const crc = crc32(base.subarray(crcStart, crcStart + 4 + chunkLength));
  base.writeUInt32BE(crc, crcStart + 4 + chunkLength);
  return new Uint8Array(base);
}

/** Valid magic bytes followed by nothing a decoder can use. */
export function corrupt(format: 'jpeg' | 'png'): Uint8Array {
  const header =
    format === 'jpeg'
      ? [0xff, 0xd8, 0xff, 0xe0]
      : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const body = new Uint8Array(256);
  for (let index = 0; index < body.length; index += 1)
    body[index] = index % 251;
  return new Uint8Array([...header, ...body]);
}

/**
 * A file whose header says one thing and whose body is another.
 *
 * A JPEG start-of-image followed by a PNG. The sniffer calls it a JPEG and the
 * decoder disagrees, which is the disagreement inspection treats as the signal.
 */
export async function polyglot(): Promise<Uint8Array> {
  const png = await image({ format: 'png' });
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...png]);
}

/** An SVG document. Valid XML, a perfectly good image to libvips, refused here. */
export function svg(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<rect width="64" height="64" fill="red"/></svg>',
  );
}

/** A GIF, standing for every format that is simply not on the allow-list. */
export function gif(): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
    0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);
}

/**
 * A JPEG carrying GPS, device identity, and an orientation tag.
 *
 * The orientation matters as much as the GPS. A camera writes the tag and
 * expects the viewer to honour it, so a derivative that strips every tag
 * without first baking the rotation into pixels renders sideways forever. This
 * fixture is landscape with orientation 6, so a correctly processed derivative
 * comes out portrait and an incorrectly processed one does not.
 */
export async function imageWithPrivateMetadata(): Promise<{
  readonly bytes: Uint8Array;
  readonly deviceMarker: string;
}> {
  const deviceMarker = 'VeloraFixtureCamera';
  const bytes = await sharp({
    create: {
      background: { b: 200, g: 120, r: 10 },
      channels: 3,
      height: 60,
      width: 120,
    },
  })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: deviceMarker, Model: 'Fixture' },
      // IFD3 is the GPS directory in sharp's mapping. Writing this under a
      // `GPS` key type-checks nowhere and writes nothing, which would have made
      // the fixture quietly prove less than it claims.
      IFD3: {
        GPSLatitude: '51/1 30/1 0/1',
        GPSLatitudeRef: 'N',
        GPSLongitude: '0/1 7/1 0/1',
        GPSLongitudeRef: 'W',
      },
    })
    .jpeg()
    .toBuffer();
  return { bytes: new Uint8Array(bytes), deviceMarker };
}

/** A valid image carrying the development scanner's refusal marker. */
export async function markedForScanner(marker: string): Promise<Uint8Array> {
  const png = await image({ format: 'png' });
  return new Uint8Array([...png, ...new TextEncoder().encode(marker)]);
}

/** PNG chunk CRC. Table built once, because the fixture needs one value. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
