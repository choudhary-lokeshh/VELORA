import { consumerWebOrigin } from './auth-environment.js';
import { expect, test } from './fixtures.js';

/**
 * What VELORA actually sends a crawler, a link preview, and a stranger.
 *
 * Every assertion here reads the bytes the server sent rather than the document
 * a browser assembled afterwards, and that distinction is the whole point.
 * Something that arrives at a public address, reads no scripts, and leaves is
 * the reader these pages exist for: a search engine, a chat client building a
 * preview, a person on a connection that dropped mid-load. A test driven
 * through a rendered page would pass against a shell that fills itself in, and
 * a shell that fills itself in is an empty page to all three.
 *
 * The suite runs against `VELORA_APP_ENV=local`, so the honest expectation
 * throughout is that nothing here may be indexed. That is not a weaker test
 * than the production one — it is the more important half. An environment that
 * indexed because nobody said not to is how a preview deployment ends up in a
 * search result under a hostname nobody meant to own, and it is the one SEO
 * mistake that cannot be undone by changing a file.
 */

/** The bytes the server sent, before anything ran. */
async function serverHtml(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  path: string,
): Promise<{
  readonly body: string;
  readonly headers: Record<string, string>;
}> {
  const response = await request.get(`${consumerWebOrigin}${path}`);
  expect(
    response.status(),
    `${path} answered ${String(response.status())}`,
  ).toBe(200);
  return { body: await response.text(), headers: response.headers() };
}

function contentOf(html: string, property: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${property}"[^>]*>`,
    'iu',
  );
  const tag = pattern.exec(html)?.[0];
  if (tag === undefined) return undefined;
  return /content="([^"]*)"/iu.exec(tag)?.[1];
}

function canonicalOf(html: string): string | undefined {
  const tag = /<link[^>]+rel="canonical"[^>]*>/iu.exec(html)?.[0];
  if (tag === undefined) return undefined;
  return /href="([^"]*)"/iu.exec(tag)?.[1];
}

function titleOf(html: string): string | undefined {
  return /<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1];
}

function headings(html: string): readonly string[] {
  return [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gisu)].map((match) =>
    (match[1] ?? '').replace(/<[^>]*>/gu, '').trim(),
  );
}

/**
 * Every public address this surface publishes copy for, and its own title.
 *
 * `prose` is the floor for pages whose words are written in this repository.
 * The creator listing is deliberately lower: its body is other people's pages,
 * and in a suite that has published none it renders the empty state — which is
 * the correct page and is short. A threshold that demanded eight hundred
 * characters there would be asserting that the fixtures have creators in them.
 */
const publicPages = [
  {
    path: '/',
    prose: 800,
    title: 'VELORA — meet new people through live conversations',
  },
  { path: '/about', prose: 800, title: 'What VELORA is · VELORA' },
  {
    path: '/about/live',
    prose: 800,
    title: 'How live conversations work · VELORA',
  },
  {
    path: '/about/creators',
    prose: 800,
    title: 'Creators and communities · VELORA',
  },
  { path: '/about/safety', prose: 800, title: 'Safety and control · VELORA' },
  {
    path: '/about/questions',
    prose: 800,
    title: 'Questions people ask · VELORA',
  },
  { path: '/creators', prose: 300, title: 'Creators on VELORA · VELORA' },
] as const;

test.describe('what the server sends a crawler', () => {
  test('gives every public page one heading, one title, and real prose', async ({
    request,
  }) => {
    const seen = new Set<string>();
    for (const page of publicPages) {
      const { body } = await serverHtml(request, page.path);

      expect(titleOf(body), `${page.path} title`).toBe(page.title);
      expect(seen.has(page.title), `${page.title} is used twice`).toBe(false);
      seen.add(page.title);

      // Exactly one first-level heading. Two is a document with two subjects,
      // and none is a document with none.
      expect(headings(body), `${page.path} headings`).toHaveLength(1);

      // Real content in the first response, not a shell. The entry page used to
      // answer with a loading state here and nothing else.
      const text = body
        .replace(/<script[\s\S]*?<\/script>/giu, '')
        .replace(/<[^>]*>/gu, ' ');
      expect(text.length, `${page.path} server-rendered text`).toBeGreaterThan(
        page.prose,
      );
      expect(text).not.toContain('Loading VELORA');

      const description = contentOf(body, 'description');
      expect(description ?? '', `${page.path} description`).not.toBe('');
      expect((description ?? '').length).toBeLessThanOrEqual(201);
    }
  });

  test('writes a canonical that a referral or campaign cannot change', async ({
    request,
  }) => {
    const plain = await serverHtml(request, '/about');
    const decorated = await serverHtml(
      request,
      '/about?ref=abcdefghijklmnopqrstuv&utm_source=chat&utm_campaign=x',
    );
    expect(canonicalOf(plain.body)).toBe(`${consumerWebOrigin}/about`);
    expect(canonicalOf(decorated.body)).toBe(canonicalOf(plain.body));
    expect(contentOf(decorated.body, 'og:url')).toBe(
      `${consumerWebOrigin}/about`,
    );
  });

  test('treats a trailing slash as the same page', async ({ request }) => {
    const withSlash = await serverHtml(request, '/about/live/');
    expect(canonicalOf(withSlash.body)).toBe(`${consumerWebOrigin}/about/live`);
  });

  test('builds a social preview that names the page and the product', async ({
    request,
  }) => {
    const { body } = await serverHtml(request, '/about/live');
    expect(contentOf(body, 'og:title')).toBe('How live conversations work');
    expect(contentOf(body, 'og:site_name')).toBe('VELORA');
    expect(contentOf(body, 'og:type')).toBe('website');
    expect(contentOf(body, 'og:image')).toBe(
      `${consumerWebOrigin}/share/velora.png`,
    );
    expect(contentOf(body, 'twitter:card')).toBe('summary_large_image');
  });

  test('serves the share image it points at', async ({ request }) => {
    const response = await request.get(`${consumerWebOrigin}/share/velora.png`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  });

  test('publishes the organisation once, on the entry page only', async ({
    request,
  }) => {
    const entry = await serverHtml(request, '/');
    expect(entry.body).toContain('"@type":"Organization"');
    expect(entry.body).toContain('"@type":"WebSite"');
    const about = await serverHtml(request, '/about');
    expect(about.body).not.toContain('"@type":"Organization"');
  });

  test('publishes the questions it shows, and no rating of any kind', async ({
    request,
  }) => {
    const { body } = await serverHtml(request, '/about/questions');
    expect(body).toContain('"@type":"FAQPage"');
    expect(body).toContain('Is VELORA a dating app?');
    for (const forbidden of ['AggregateRating', 'ratingValue', '"Review"']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

test.describe('what this environment refuses', () => {
  test('disallows every address in robots.txt, because it is not production', async ({
    request,
  }) => {
    const response = await request.get(`${consumerWebOrigin}/robots.txt`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Disallow: /');
    // No sitemap is offered where nothing may be indexed.
    expect(body).not.toContain('Sitemap:');
  });

  test('publishes an empty sitemap rather than a 404', async ({ request }) => {
    const response = await request.get(`${consumerWebOrigin}/sitemap.xml`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).not.toContain('<loc>');
  });

  test('stamps noindex on every page, public and private alike', async ({
    request,
  }) => {
    for (const path of [
      '/',
      '/about',
      '/creators',
      '/sign-in',
      '/you',
      '/messages',
      '/invite/abcdefghijklmnopqrstuv',
    ]) {
      const response = await request.get(`${consumerWebOrigin}${path}`);
      expect(
        response.headers()['x-robots-tag'],
        `${path} index directive`,
      ).toContain('noindex');
    }
  });

  test('writes noindex into the document of a page behind the session gate', async ({
    request,
  }) => {
    const { body } = await serverHtml(request, '/you');
    expect(contentOf(body, 'robots')).toContain('noindex');
    expect(titleOf(body)).toBe('You · VELORA');
  });
});

test.describe('the public pages link to each other', () => {
  test('offers a way from the entry to every explanation and back', async ({
    request,
  }) => {
    const { body } = await serverHtml(request, '/');
    for (const path of [
      '/about',
      '/about/live',
      '/about/creators',
      '/about/safety',
      '/about/questions',
    ]) {
      expect(body, `entry links to ${path}`).toContain(`href="${path}"`);
    }

    const about = await serverHtml(request, '/about');
    expect(about.body).toContain('href="/creators"');
    expect(about.body).toContain('href="/about/live"');
  });

  test('says what VELORA is, and says it is not a dating app', async ({
    request,
  }) => {
    const { body } = await serverHtml(request, '/about');
    const text = body.replace(/<[^>]*>/gu, ' ');
    expect(text).toContain('not a dating app');
    // Nothing invented about how many people are here.
    for (const forbidden of [
      'million',
      'thousands of',
      'users online',
      'people online now',
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});

test.describe('an address with nothing behind it', () => {
  test('answers 404 for a creator nobody has published', async ({
    page,
    request,
  }) => {
    // The status is what decides whether a search engine keeps the address, and
    // it is the assertion that matters: a page saying "not available" under a
    // 200 is a tombstone indexed as content.
    const response = await request.get(`${consumerWebOrigin}/c/nobody-here`);
    expect(response.status()).toBe(404);

    /*
     * The words are asserted in a browser rather than in those bytes, and the
     * reason is worth writing down. Next delivers a `notFound()` from a
     * dynamically rendered route as an error-fallback document whose body is
     * empty and whose content arrives in the flight payload beside it — so the
     * sentence is in the response and is not in the HTML. That is acceptable
     * for a 404 specifically: nothing is meant to keep this address, and the
     * person who followed an old link gets the page a moment later.
     */
    await page.goto(`${consumerWebOrigin}/c/nobody-here`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This page is not available',
    );
    // A way back rather than a dead end.
    await expect(
      page.getByRole('link', { name: 'Browse creators' }),
    ).toBeVisible();
  });

  test('answers 404 for a club nobody has published', async ({ request }) => {
    const response = await request.get(
      `${consumerWebOrigin}/c/nobody-here/club/nothing-here`,
    );
    expect(response.status()).toBe(404);
  });

  test('gives an invitation nobody holds a page rather than an error', async ({
    request,
  }) => {
    const response = await request.get(
      `${consumerWebOrigin}/invite/zzzzzzzzzzzzzzzzzzzzzz`,
    );
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('Somebody wants you on VELORA');
    expect(body).toContain('href="/sign-in"');
  });

  test('gives a malformed invitation the same page', async ({ request }) => {
    const response = await request.get(`${consumerWebOrigin}/invite/nope`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('Somebody wants you on VELORA');
  });

  test('gives a scheduled time that has passed a page and a way on', async ({
    request,
  }) => {
    const response = await request.get(
      `${consumerWebOrigin}/live-window/nothing-scheduled`,
    );
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('This time has passed');
    expect(body).toContain('href="/about/live"');
  });
});
