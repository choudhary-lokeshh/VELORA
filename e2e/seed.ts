/**
 * Admits the accounts the browser suite drives.
 *
 * Everything here goes through the API's own HTTP surface — account creation,
 * the adult declaration, policy acknowledgement, the profile, the photo,
 * preferences, availability, introductions, and messages — so nothing is
 * admitted by a route a person could not take.
 *
 * The photo was the exception until the development storage adapter was given a
 * transport. It had no HTTP upload endpoint at all, so the bytes had to be
 * placed out of band by a script that called the adapter directly, and the
 * comment here said so. That is gone: the seed now asks for an upload
 * capability, PUTs to the address the platform issues, and confirms — the same
 * three calls a browser makes — and the platform inspects and processes what
 * arrives exactly as it would for any upload.
 *
 * No approved storage provider exists, so this is still development transport
 * and not evidence about a deployed one. What it is evidence about is the
 * product: a new account can now reach a finished profile without anything
 * being written behind the API's back.
 */

export interface SeedPerson {
  readonly displayName: string;
  readonly id: string;
  readonly subject: string;
}

export interface SeedCohort {
  readonly conversationId: string;
  readonly introductionId: string;
  readonly people: readonly SeedPerson[];
}

interface Fixture {
  readonly bio: string;
  readonly displayName: string;
  readonly languages: readonly string[];
  readonly region: string;
  readonly tone: string;
}

const fixtures: readonly Fixture[] = [
  {
    bio: 'Architect by day. I cook far too much for one person and I am always looking for somebody to help finish it.',
    displayName: 'Mara Oduya',
    languages: ['en', 'sw'],
    region: 'ES',
    tone: '60,44,52',
  },
  {
    bio: 'Sound engineer, night owl, terrible at chess but very willing to lose.',
    displayName: 'Tomás Iglesias',
    languages: ['es', 'en'],
    region: 'ES',
    tone: '38,50,62',
  },
  {
    bio: 'Long walks, longer books. Currently rereading everything I loved at twenty to see whether it holds up.',
    displayName: 'Yuki Tanabe',
    languages: ['ja', 'en'],
    region: 'ES',
    tone: '52,40,38',
  },
  {
    // Deliberately hostile content, and it stays in the fixture set: an
    // unbreakable run is what makes a grid column wider than the viewport, and
    // the responsive assertions are the only thing that catches it.
    bio: `Ceramicist. ${'Supercalifragilisticexpialidocious'.repeat(4)} and clay under my nails.`,
    displayName: 'Maximilianovitch Wolfeschle',
    languages: ['ar', 'en', 'es', 'ja', 'sw'],
    region: 'ES',
    tone: '44,54,46',
  },
];

interface SeedOptions {
  readonly apiBaseUrl: string;
  readonly backendEnvironment: Readonly<Record<string, string>>;
  readonly cohorts: number;
  readonly origin: string;
  readonly runId: string;
}

/** One caller, holding its own cookies, exactly as a browser would. */
function caller(options: SeedOptions, device: string) {
  const jar = new Map<string, string>();

  const absorb = (response: Response) => {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator === -1) continue;
      jar.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  };

  return async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      origin: options.origin,
      'x-velora-device': device,
    };
    if (jar.size > 0) {
      headers.cookie = [...jar]
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }
    const csrf = jar.get('__Host-velora_consumer_web_csrf');
    if (csrf !== undefined && method !== 'GET') headers['x-velora-csrf'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${options.apiBaseUrl}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers,
      method,
    });
    absorb(response);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${method} ${path} -> ${String(response.status)} ${text}`,
      );
    }
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  };
}

/**
 * Uploads a fixture photo the way a browser does.
 *
 * This used to write bytes into the storage directory out of band, by running
 * a script in the API workspace that called the adapter directly. It had to:
 * the development adapter issued an unroutable address and had no transport
 * behind it, so no HTTP client could complete an upload anywhere. Now it does,
 * so the seed takes the same three steps a person takes — ask for a capability,
 * PUT to the address it names, confirm — and the suite stops depending on a
 * path no user has.
 */
async function uploadBytes(
  capability: MediaUploadCapability,
  tone: string,
): Promise<void> {
  const [red = 60, green = 44, blue = 52] = tone.split(',').map(Number);
  // Large enough that every derivative the platform makes is a real resize, and
  // no larger: a fixture is measured in how much of the pipeline it exercises,
  // not in megapixels, and a browser suite pays for every one of them.
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: {
      background: { b: blue, g: green, r: red },
      channels: 3,
      height: 600,
      width: 480,
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  const response = await fetch(capability.uploadUrl, {
    body: new Uint8Array(bytes),
    headers: capability.uploadHeaders,
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(
      `uploading the fixture photo -> ${String(response.status)}`,
    );
  }
}

interface MediaUploadCapability {
  readonly mediaId: string;
  readonly uploadHeaders: Record<string, string>;
  readonly uploadUrl: string;
}

/** Waits for the worker to inspect and process what was just uploaded. */
async function waitForReadyImage(
  call: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  attempts = 160,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const profile = await call<{
      media: { rejectionReason?: string; state: string }[];
    }>('GET', '/v1/users/me/profile');
    if (profile.media.some((item) => item.state === 'ready')) return;
    const rejected = profile.media.find((item) => item.state === 'rejected');
    if (rejected !== undefined) {
      throw new Error(
        `fixture image rejected: ${String(rejected.rejectionReason)}`,
      );
    }
    await new Promise((settle) => setTimeout(settle, 250));
  }
  throw new Error('fixture image never became ready');
}

async function admit(
  options: SeedOptions,
  fixture: Fixture,
  cohort: number,
  index: number,
) {
  const label = `${String(cohort)}-${String(index)}`;
  const subject = `browser-${options.runId}-${label}@velora.test`;
  const call = caller(options, `seed-${options.runId}-${label}`);

  await call('POST', '/v1/auth/local/web-sessions', {
    audience: 'consumer_web',
    subject,
  });
  const account = await call<{ id: string }>('POST', '/v1/users', {});
  await call('POST', '/v1/users/me/onboarding/adult-declaration', {
    declaresAdult: true,
    region: fixture.region,
  });
  const onboarding = await call<{
    outstandingPolicies: { key: string; version: string }[];
  }>('GET', '/v1/users/me/onboarding');
  if (onboarding.outstandingPolicies.length > 0) {
    await call('POST', '/v1/users/me/onboarding/acknowledgements', {
      acknowledgements: onboarding.outstandingPolicies,
    });
  }
  await call('POST', '/v1/users/me/profile', {
    bio: fixture.bio,
    displayName: fixture.displayName,
    languages: [...fixture.languages],
  });

  const slot = await call<MediaUploadCapability>(
    'POST',
    '/v1/users/me/profile/media',
  );
  await uploadBytes(slot, fixture.tone);
  await call('POST', '/v1/users/me/profile/media/completion', {
    mediaId: slot.mediaId,
  });
  await waitForReadyImage(call);

  await call('POST', '/v1/users/me/preferences', { discoverable: true });
  await call('POST', '/v1/users/me/availability', {
    availableUntil: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    state: 'available',
  });

  return { call, displayName: fixture.displayName, id: account.id, subject };
}

export async function seedCohorts(input: {
  readonly apiBaseUrl: string;
  readonly backendEnvironment: Readonly<Record<string, string>>;
  readonly cohorts: number;
  readonly origin: string;
  readonly runId: string;
}): Promise<readonly SeedCohort[]> {
  const options: SeedOptions = {
    apiBaseUrl: input.apiBaseUrl,
    backendEnvironment: input.backendEnvironment,
    cohorts: input.cohorts,
    origin: input.origin,
    runId: input.runId,
  };

  const cohorts: SeedCohort[] = [];
  for (let cohort = 0; cohort < options.cohorts; cohort += 1) {
    const people = [];
    for (const [index, fixture] of fixtures.entries()) {
      people.push(await admit(options, fixture, cohort, index));
    }

    const [first, second, waiting] = people;
    if (first === undefined || second === undefined) {
      throw new Error('the fixture set needs at least two people');
    }

    // A mutual introduction, made the way the product makes one: both sides
    // signal, and the server decides that the pair is introduced.
    await first.call('POST', '/v1/discovery/introductions', {
      candidateId: second.id,
    });
    const introduction = await second.call<{ id: string }>(
      'POST',
      '/v1/discovery/introductions',
      { candidateId: first.id },
    );
    const conversation = await first.call<{ id: string }>(
      'POST',
      '/v1/messaging/conversations',
      { introductionId: introduction.id },
    );
    const lines: readonly [(typeof people)[number], string][] = [
      [
        first,
        'Hello! Your profile said sound engineer and I have been carrying a broken record player around three flats now.',
      ],
      [
        second,
        'That is either a cry for help or the best opening line this year.',
      ],
      [first, 'It is definitely both.'],
      // The longest thing the contract accepts, containing a run no layout can
      // break for it. A transcript is where a client most easily pushes a page
      // sideways, so the widest message the product allows is always present.
      [
        second,
        `${'Supercalifragilisticexpialidocious'.repeat(8)} ${'and then a great deal more besides, '.repeat(90)}`.slice(
          0,
          3990,
        ),
      ],
    ];
    for (const [who, body] of lines) {
      await who.call('POST', '/v1/messaging/messages', {
        body,
        clientMessageId: crypto.randomUUID(),
        conversationId: conversation.id,
      });
    }

    // One person signals the first and waits, so the introductions screen has
    // something to answer. The last person signals nobody, so discovery has
    // somebody left to show.
    if (waiting !== undefined) {
      await waiting.call('POST', '/v1/discovery/introductions', {
        candidateId: first.id,
      });
    }

    cohorts.push({
      conversationId: conversation.id,
      introductionId: introduction.id,
      people: people.map((person) => ({
        displayName: person.displayName,
        id: person.id,
        subject: person.subject,
      })),
    });
  }

  return cohorts;
}
