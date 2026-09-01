import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Whether the configured RTC provider will actually accept this platform, and
 * exactly which part of the credential it refused.
 *
 * A media provider is the one dependency whose misconfiguration looks like a
 * product failure. A wrong API secret does not fail at startup — configuration
 * can only see that three values are present, never that they are the right
 * three — so the first symptom is a live encounter that connects, waits, and
 * ends, with a browser console showing a bare `401` that names nothing. This
 * script asks the project directly, before anybody opens a camera.
 *
 * It distinguishes the two answers that matter, because they have different
 * remedies. `invalid API key` means the project has never heard of the key, so
 * the key or the project address is wrong. `invalid token` means the project
 * knows the key and could not verify the signature, so the *secret* does not
 * belong to that key — the failure a key and secret copied from two different
 * key pairs produces, and the one that is otherwise indistinguishable.
 *
 * It prints no credential and no complete token. The API key, the API secret,
 * and every signature stay out of standard output, standard error, and the
 * process exit code, so the output of a failing run is safe to paste into an
 * issue. The project address is printed, because it is the project's public
 * WebSocket address and is the thing an operator needs to see.
 *
 * The token is signed here with `node:crypto` rather than with the provider
 * SDK, deliberately. This script belongs to the repository root and takes no
 * workspace dependency, and signing it by hand is also the stronger check: what
 * it proves is that the *credential* is right, not that a library agrees with
 * itself.
 *
 * It is not a gate step. It needs credentials and a network, and CI has
 * neither; a check that quietly passed without a project would be the same
 * false evidence the `unavailable` adapter exists to prevent.
 *
 * Exit codes: 0 when the project accepted the credential or when no provider is
 * configured, 1 when a configured provider refused it or could not be reached.
 */

const environmentFile = '.env';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The configured values, from the ambient environment or from `.env`.
 *
 * The ambient environment wins, so a run against a different project is one
 * prefixed command rather than an edit to a file somebody then forgets. `.env`
 * is read as text and never executed: it is parsed for the four keys this
 * script knows, and a value is taken verbatim including any character that
 * would have needed quoting in a shell.
 */
function configured() {
  const names = [
    'REALTIME_RTC_PROVIDER',
    'REALTIME_LIVEKIT_URL',
    'REALTIME_LIVEKIT_API_KEY',
    'REALTIME_LIVEKIT_API_SECRET',
  ];
  const values = {};
  if (existsSync(environmentFile)) {
    for (const line of readFileSync(environmentFile, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator === -1 || line.startsWith('#')) continue;
      const name = line.slice(0, separator).trim();
      if (names.includes(name)) values[name] = line.slice(separator + 1).trim();
    }
  }
  for (const name of names) {
    const ambient = process.env[name];
    if (ambient !== undefined && ambient.length > 0) values[name] = ambient;
  }
  return values;
}

function accessToken(apiKey, apiSecret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      exp: issuedAt + 60,
      // The narrowest grant that requires authentication at all. This script
      // never creates, joins, records, or administers anything: it asks the
      // project one read-only question and reads the status code.
      iss: apiKey,
      nbf: issuedAt - 5,
      sub: apiKey,
      video: { roomList: true },
    }),
  );
  const signature = createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

function httpOriginOf(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'ws:' ? 'http:' : 'https:';
  return parsed.origin;
}

function fail(what, remedy) {
  process.stderr.write(`\n${what}\n\n      ${remedy}\n\n`);
  process.exit(1);
}

async function main() {
  const values = configured();
  const provider = values.REALTIME_RTC_PROVIDER ?? 'unavailable';
  if (provider !== 'livekit') {
    process.stdout.write(
      `REALTIME_RTC_PROVIDER is \`${provider}\`. No external provider to check.\n`,
    );
    return;
  }

  const url = values.REALTIME_LIVEKIT_URL ?? '';
  const apiKey = values.REALTIME_LIVEKIT_API_KEY ?? '';
  const apiSecret = values.REALTIME_LIVEKIT_API_SECRET ?? '';
  const missing = [
    ['REALTIME_LIVEKIT_URL', url],
    ['REALTIME_LIVEKIT_API_KEY', apiKey],
    ['REALTIME_LIVEKIT_API_SECRET', apiSecret],
  ]
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    fail(
      `REALTIME_RTC_PROVIDER is \`livekit\` and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty.`,
      'Fill them in .env from the LiveKit project, or set REALTIME_RTC_PROVIDER=local-test.',
    );
  }
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    fail(
      'REALTIME_LIVEKIT_URL is not a WebSocket address.',
      'It must begin with wss:// (or ws:// for a server on this machine).',
    );
  }

  const origin = httpOriginOf(url);
  process.stdout.write(`Project     ${origin}\n`);
  process.stdout.write(
    `Credential  key ${apiKey.length} characters, secret ${apiSecret.length} characters\n`,
  );

  let response;
  try {
    response = await fetch(`${origin}/twirp/livekit.RoomService/ListRooms`, {
      body: '{}',
      headers: {
        authorization: `Bearer ${accessToken(apiKey, apiSecret)}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  } catch (error) {
    fail(
      `The project could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      'Check the address and this machine’s network before looking at the credential.',
    );
    return;
  }

  const body = (await response.text()).slice(0, 200);
  if (response.ok) {
    process.stdout.write(
      '\nThe project accepted the credential. Server-API authentication works.\n',
    );
    process.stdout.write(
      'This says nothing about media: only e2e/live-provider.spec.ts proves that.\n',
    );
    return;
  }

  // The two refusals worth telling apart, matched on the body because LiveKit
  // answers 401 to both and the status alone cannot separate them. The key
  // check runs first: an unrecognised key never reaches signature verification,
  // so its message is the more specific of the two.
  if (body.includes('invalid API key')) {
    fail(
      'The project does not recognise REALTIME_LIVEKIT_API_KEY.',
      'The key belongs to a different project, or REALTIME_LIVEKIT_URL points at one. Check both against the LiveKit console.',
    );
  }
  // Both spellings, because they are the same refusal from two deployments of
  // the same server. LiveKit Cloud answers `invalid token`; a self-hosted
  // livekit-server answers `invalid authorization token: token signature is
  // invalid`, and a check that knew only the one an operator happened to meet
  // first would give the vaguest possible advice about the other.
  if (body.includes('invalid token') || body.includes('signature is invalid')) {
    fail(
      'The project recognises the key and could not verify the signature: REALTIME_LIVEKIT_API_SECRET does not belong to REALTIME_LIVEKIT_API_KEY.',
      'Copy the key and the secret together from one key pair in the LiveKit console. A key from one pair and a secret from another produces exactly this.',
    );
  }
  fail(
    `The project refused the credential: ${response.status} ${body}`,
    'Check REALTIME_LIVEKIT_URL, REALTIME_LIVEKIT_API_KEY and REALTIME_LIVEKIT_API_SECRET against the LiveKit console.',
  );
}

await main();
