import { LocalTestMediaStorage } from '../src/media/storage.js';

/**
 * Puts real image bytes where the platform issued an upload capability for
 * them, so a browser suite can have accounts with a finished profile.
 *
 * This exists because the development media adapter deliberately has no HTTP
 * upload transport. It is filesystem-backed on purpose, and ADR-0023 is explicit
 * that inventing an upload endpoint for a development adapter would put
 * development behaviour on a production route. The integration suite places
 * bytes the same way, by calling the adapter directly, and the platform then
 * inspects and processes them exactly as it would for a real upload.
 *
 * It is also a statement about the product rather than a workaround for it: **no
 * browser can complete a profile in any environment**, because no approved
 * storage provider exists. The browser suite asserts that refusal separately;
 * this exists so the rest of the product is not unreachable behind it.
 *
 * It does nothing but write bytes. Everything else the fixtures need — accounts,
 * declarations, profiles, introductions, messages — goes through the API's own
 * HTTP surface from the browser suite, so nothing is admitted by a route a
 * person could not take.
 */

const mediaDirectory = process.env.MEDIA_LOCAL_STORAGE_DIRECTORY;
const signingKey = process.env.MEDIA_DELIVERY_SIGNING_KEY;
const databaseUrl = process.env.DATABASE_URL;
const slotId = process.argv[2];
const tone = process.argv[3] ?? '60,44,52';

if (
  mediaDirectory === undefined ||
  signingKey === undefined ||
  databaseUrl === undefined ||
  slotId === undefined
) {
  throw new Error(
    'usage: place-media-bytes <profileMediaSlotId> [r,g,b] with DATABASE_URL, MEDIA_LOCAL_STORAGE_DIRECTORY and MEDIA_DELIVERY_SIGNING_KEY set',
  );
}

const [red = 60, green = 44, blue = 52] = tone.split(',').map(Number);

const database = new Bun.SQL(databaseUrl, { connectionTimeout: 5, max: 1 });

try {
  const rows: { object_key: string }[] = await database`
    select s.object_key
      from media_upload_sessions s
      join users_profile_media m on m.media_asset_id = s.asset_id
     where m.id = ${slotId} and s.state = 'issued'
  `;
  const objectKey = rows[0]?.object_key;
  if (objectKey === undefined) {
    throw new Error(
      `no issued upload session for profile media slot ${slotId}`,
    );
  }

  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: {
      background: { b: blue, g: green, r: red },
      channels: 3,
      height: 1000,
      width: 800,
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  const storage = new LocalTestMediaStorage({
    directory: mediaDirectory,
    signingKey,
  });
  await storage.putObject(objectKey, new Uint8Array(bytes));
} finally {
  await database.close();
}
