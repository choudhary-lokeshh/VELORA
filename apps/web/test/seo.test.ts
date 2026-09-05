import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  boundedText,
  pageMetadata,
  privateMetadata,
} from '../src/seo/metadata';
import {
  crawlDisallowedPrefixes,
  informationalRoutes,
  normalizePath,
  pathIsIndexable,
  staticIndexableRoutes,
} from '../src/seo/routes';
import { absoluteUrl, resolvePublicSite } from '../src/seo/site';
import { faqData, profilePageData } from '../src/seo/structured-data';

/**
 * What a search engine, a link preview, and a stranger are allowed to see.
 *
 * The defects this suite exists for are all silent. A canonical that carries a
 * referral code splits one page into one indexed copy per link anybody ever
 * shared; an environment that indexes because nobody said not to publishes a
 * preview deployment under a hostname nobody meant to own; a description built
 * from a creator's own words leaks whatever happened to be in them. None of
 * those fails a build, appears in a log, or shows up in a browser — they show
 * up weeks later in somebody else's search results, which is why they are
 * asserted here rather than left to be noticed.
 */

const productionSite = {
  indexable: true,
  origin: 'https://velora.example',
};
const localSite = { indexable: false, origin: 'http://127.0.0.1:3000' };
const nowhereSite = { indexable: false };

describe('which addresses may be indexed', () => {
  it('offers the entry, the explanations, and the creator listing', () => {
    for (const route of staticIndexableRoutes) {
      expect(pathIsIndexable(route.path)).toBe(true);
    }
  });

  it('offers a public creator and a published club', () => {
    expect(pathIsIndexable('/c/aurora')).toBe(true);
    expect(pathIsIndexable('/c/aurora/club/inner-circle')).toBe(true);
  });

  it('refuses every address that needs a session', () => {
    for (const path of [
      '/discover',
      '/introductions',
      '/live',
      '/messages',
      '/messages/conversation-1',
      '/notifications',
      '/people/person-1',
      '/welcome',
      '/you',
      '/you/gifts',
      '/you/memberships',
      '/you/safety',
      '/you/settings',
      '/you/wallet',
      '/you/help',
      '/checkout/return',
      '/checkout/cancelled',
    ]) {
      expect(pathIsIndexable(path)).toBe(false);
    }
  });

  it('refuses the doorways that are public but are not destinations', () => {
    // An invitation would be indexed under a code belonging to one person, and
    // a window is news for a day and then a page about an afternoon that passed.
    expect(pathIsIndexable('/sign-in')).toBe(false);
    expect(pathIsIndexable('/invite/abcdefghijklmnopqrstuv')).toBe(false);
    expect(pathIsIndexable('/live-window/friday-evening')).toBe(false);
  });

  it('refuses the join step inside a club, which is an action', () => {
    expect(pathIsIndexable('/c/aurora/club/inner-circle/join')).toBe(false);
  });

  it('refuses an address nobody has classified', () => {
    // The default direction. A route added tomorrow is private until somebody
    // adds it to the policy, rather than indexable until somebody notices.
    expect(pathIsIndexable('/something-new')).toBe(false);
  });

  it('treats a trailing slash as the same address', () => {
    expect(normalizePath('/about/')).toBe('/about');
    expect(pathIsIndexable('/about/')).toBe(true);
    expect(normalizePath('/')).toBe('/');
  });

  it('ignores a query when deciding, so a referral cannot change the answer', () => {
    expect(pathIsIndexable('/c/aurora?ref=abcdefghijklmnopqrstuv')).toBe(true);
    expect(pathIsIndexable('/you?utm_source=x')).toBe(false);
  });

  /**
   * The collision that is invisible until it happens.
   *
   * `robots.txt` matches prefixes with no word boundary, so `Disallow: /live`
   * silently covers `/live-window/…` as well. Asserting it here is cheaper than
   * discovering that link previews stopped working.
   */
  it('never disallows a prefix of an address that is offered or previewed', () => {
    const offered = [
      ...staticIndexableRoutes.map((route) => route.path),
      '/c/aurora',
      '/c/aurora/club/inner-circle',
      '/live-window/friday-evening',
    ];
    for (const prefix of crawlDisallowedPrefixes) {
      for (const path of offered) {
        expect(
          path.startsWith(prefix),
          `${prefix} would disallow ${path}`,
        ).toBe(false);
      }
    }
  });
});

describe('the canonical address', () => {
  it('is built from the path alone, so attribution cannot split a page', () => {
    const withReferral = pageMetadata({
      description: 'A creator page.',
      path: '/c/aurora?ref=abcdefghijklmnopqrstuv&utm_source=chat',
      site: productionSite,
      title: 'Aurora',
    });
    const without = pageMetadata({
      description: 'A creator page.',
      path: '/c/aurora',
      site: productionSite,
      title: 'Aurora',
    });
    expect(withReferral.alternates?.canonical).toBe(
      'https://velora.example/c/aurora',
    );
    expect(withReferral.alternates?.canonical).toBe(
      without.alternates?.canonical,
    );
  });

  it('drops a fragment and a trailing slash', () => {
    const metadata = pageMetadata({
      description: 'What VELORA is.',
      path: '/about/#top',
      site: productionSite,
      title: 'What VELORA is',
    });
    expect(metadata.alternates?.canonical).toBe('https://velora.example/about');
  });

  it('degrades to a path where the environment has no public identity', () => {
    expect(absoluteUrl(nowhereSite, '/about')).toBe('/about');
    expect(absoluteUrl(localSite, '/about')).toBe(
      'http://127.0.0.1:3000/about',
    );
  });
});

describe('the index directive', () => {
  it('is granted only where the environment and the route both allow it', () => {
    const metadata = pageMetadata({
      description: 'What VELORA is.',
      path: '/about',
      site: productionSite,
      title: 'What VELORA is',
    });
    expect(metadata.robots).toEqual({ follow: true, index: true });
  });

  it('is refused everywhere in an environment that is not production', () => {
    for (const site of [localSite, nowhereSite]) {
      const metadata = pageMetadata({
        description: 'What VELORA is.',
        path: '/about',
        site,
        title: 'What VELORA is',
      });
      expect(metadata.robots).toEqual({ follow: false, index: false });
    }
  });

  it('cannot be granted to an address the route policy does not name', () => {
    const metadata = pageMetadata({
      description: 'Somebody’s inbox.',
      path: '/messages',
      site: productionSite,
      title: 'Messages',
    });
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  it('can be withdrawn from an address the policy does allow', () => {
    // A creator who has withdrawn their page. The address is still indexable in
    // principle and this particular answer must not be kept.
    const metadata = pageMetadata({
      description: 'There is nothing to show at this address.',
      indexable: false,
      path: '/c/aurora',
      site: productionSite,
      title: 'This page is not available',
    });
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  it('refuses every private page by name as well as by header', () => {
    expect(privateMetadata('You').robots).toEqual({
      follow: false,
      index: false,
    });
    expect(privateMetadata('You').title).toBe('You');
  });
});

describe('what a preview carries', () => {
  it('names the page and its canonical address and nothing else', () => {
    const metadata = pageMetadata({
      description: 'Aurora on VELORA.',
      path: '/c/aurora',
      site: productionSite,
      title: 'Aurora',
      type: 'profile',
    });
    expect(metadata.openGraph?.title).toBe('Aurora');
    expect(metadata.openGraph?.url).toBe('https://velora.example/c/aurora');
    expect(metadata.openGraph?.siteName).toBe('VELORA');
    expect(JSON.stringify(metadata)).not.toContain('velora.example/c/aurora?');
  });

  it('offers no image where there is no absolute address to offer one at', () => {
    const metadata = pageMetadata({
      description: 'What VELORA is.',
      path: '/about',
      site: nowhereSite,
      title: 'What VELORA is',
    });
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter?.images).toBeUndefined();
  });

  it('bounds somebody else’s words rather than publishing all of them', () => {
    const bio = `${'word '.repeat(200)}end`;
    const metadata = pageMetadata({
      description: boundedText(bio, 200),
      path: '/c/aurora',
      site: productionSite,
      title: 'Aurora',
    });
    const description = metadata.description ?? '';
    expect(description.length).toBeLessThanOrEqual(201);
    expect(description.endsWith('…')).toBe(true);
  });

  it('collapses newlines a bio was pasted with', () => {
    expect(boundedText('one\n\n  two\t three', 200)).toBe('one two three');
  });

  it('cuts at a word rather than mid-word', () => {
    expect(boundedText('alpha beta gamma delta', 14)).toBe('alpha beta…');
  });
});

describe('structured data', () => {
  it('says about a person only what the page already shows', () => {
    const data = profilePageData({
      description: 'Photographer.',
      displayName: 'Aurora',
      handle: 'aurora',
      path: '/c/aurora',
      site: productionSite,
    });
    const encoded = JSON.stringify(data);
    expect(encoded).toContain('Aurora');
    expect(encoded).toContain('aurora');
    // Nothing about ratings, counts, or anything the platform cannot support.
    for (const forbidden of [
      'aggregateRating',
      'AggregateRating',
      'interactionStatistic',
      'Review',
      'ratingValue',
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it('carries only questions that are on the page', () => {
    const questions = [{ answer: 'No.', question: 'Is VELORA a dating app?' }];
    const data = faqData(questions);
    const encoded = JSON.stringify(data);
    expect(encoded).toContain('Is VELORA a dating app?');
    expect(encoded).toContain('"@type":"FAQPage"');
  });
});

describe('the environment decides indexability', () => {
  it('refuses a developer machine even though it has an origin', () => {
    const site = resolvePublicSite({
      NODE_ENV: 'development',
      VELORA_API_BASE_URL: 'http://127.0.0.1:4000',
      VELORA_APP_ENV: 'local',
      VELORA_WEB_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    });
    expect(site.origin).toBe('http://127.0.0.1:3000');
    expect(site.indexable).toBe(false);
  });

  it('refuses production with no declared origin', () => {
    const site = resolvePublicSite({
      VELORA_API_BASE_URL: 'https://api.velora.example',
      VELORA_APP_ENV: 'production',
    });
    expect(site.origin).toBeUndefined();
    expect(site.indexable).toBe(false);
  });

  it('allows production with one', () => {
    const site = resolvePublicSite({
      VELORA_API_BASE_URL: 'https://api.velora.example',
      VELORA_APP_ENV: 'production',
      VELORA_WEB_PUBLIC_ORIGIN: 'https://velora.example',
    });
    expect(site).toEqual({
      indexable: true,
      origin: 'https://velora.example',
    });
  });

  it('degrades to no identity rather than throwing on a bad origin', () => {
    // Every page reads this, including pages with nothing to do with search, so
    // a configuration mistake must not be a 500 on every route.
    const site = resolvePublicSite({
      VELORA_API_BASE_URL: 'https://api.velora.example',
      VELORA_APP_ENV: 'production',
      VELORA_WEB_PUBLIC_ORIGIN: 'https://velora.example/with/a/path',
    });
    expect(site).toEqual({ indexable: false });
  });
});

/**
 * Every page under `app/` says what it is, one way or the other.
 *
 * Read off the filesystem rather than listed here, so a route added without a
 * title or an index directive fails this rather than shipping silently. The two
 * accepted answers are the two that exist: a public page builds its metadata
 * from the route policy, and a private one declares itself unindexable.
 */
describe('every route declares itself', () => {
  const appRoot = join(import.meta.dirname, '../app');

  function pages(directory: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...pages(path));
        continue;
      }
      if (entry.name === 'page.tsx') found.push(path);
    }
    return found;
  }

  it('either builds public metadata or declares itself private', () => {
    const files = pages(appRoot);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const declares =
        source.includes('pageMetadata(') || source.includes('privateMetadata(');
      expect(declares, `${file} declares no metadata`).toBe(true);
    }
  });

  it('never publishes a page whose only heading is the product’s name', () => {
    // `VELORA · VELORA` is what a template produces when a page forgets to name
    // itself. The entry is the one page allowed to be called VELORA alone, and
    // it says so by not using the template at all.
    for (const route of [...staticIndexableRoutes, ...informationalRoutes]) {
      expect(route.title).not.toBe('VELORA');
      expect(route.title.length).toBeGreaterThan(4);
    }
    const titles = staticIndexableRoutes.map((route) => route.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every offered address a description a result can render', () => {
    for (const route of staticIndexableRoutes) {
      expect(route.description.length).toBeGreaterThan(60);
      expect(route.description.length).toBeLessThanOrEqual(260);
    }
  });
});

/**
 * The two files a crawler asks for before anything else.
 *
 * Exercised in both directions, because only one of them can be observed in
 * this repository's browser suite: that suite runs against a local environment,
 * where the honest answer is refusal. The production shape has no environment
 * here to be seen in, so it is asserted against the modules themselves with the
 * environment set — which is the only place the "yes" branch exists at all.
 */
describe('robots.txt and the sitemap', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  /**
   * The environment as this case needs it, built rather than mutated.
   *
   * Assigning a fresh object is what makes "absent" expressible: these modules
   * read `process.env` at call time and distinguish an unset value from an
   * empty one, so a case about a missing origin has to be able to remove it.
   */
  function setEnvironment(values: Record<string, string | undefined>): void {
    const next: NodeJS.ProcessEnv = { ...original };
    for (const key of [
      'VELORA_API_BASE_URL',
      'VELORA_APP_ENV',
      'VELORA_WEB_PUBLIC_ORIGIN',
    ]) {
      Reflect.deleteProperty(next, key);
    }
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) next[key] = value;
    }
    process.env = next;
  }

  it('disallows everything where nothing may be indexed', async () => {
    setEnvironment({
      VELORA_API_BASE_URL: 'http://127.0.0.1:4000',
      VELORA_APP_ENV: 'local',
      VELORA_WEB_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    });
    const robots = (await import('../app/robots')).default;
    expect(robots()).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });

    const sitemap = (await import('../app/sitemap')).default;
    expect(await sitemap()).toEqual([]);
  });

  it('offers the public addresses and names the sitemap in production', async () => {
    setEnvironment({
      VELORA_API_BASE_URL: 'https://api.velora.example',
      VELORA_APP_ENV: 'production',
      VELORA_WEB_PUBLIC_ORIGIN: 'https://velora.example',
    });
    const robots = (await import('../app/robots')).default;
    const answer = robots();
    expect(answer.sitemap).toBe('https://velora.example/sitemap.xml');
    const rule = Array.isArray(answer.rules) ? answer.rules[0] : answer.rules;
    expect(rule?.allow).toBe('/');
    expect(rule?.disallow).toEqual([...crawlDisallowedPrefixes]);
  });

  it('lists every static public address, and never a private one', async () => {
    setEnvironment({
      VELORA_API_BASE_URL: 'https://api.velora.example',
      VELORA_APP_ENV: 'production',
      VELORA_WEB_PUBLIC_ORIGIN: 'https://velora.example',
    });
    const sitemap = (await import('../app/sitemap')).default;
    // The creator listing behind this cannot be reached from here, and the walk
    // answers with what it gathered rather than withdrawing the static half.
    const entries = await sitemap();
    const addresses = entries.map((entry) => entry.url);
    for (const route of staticIndexableRoutes) {
      expect(addresses).toContain(`https://velora.example${route.path}`);
    }
    for (const address of addresses) {
      const path = new URL(address).pathname;
      expect(pathIsIndexable(path), `${path} is in the sitemap`).toBe(true);
    }
    // Nothing carries a fabricated last-modified date.
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });
});
