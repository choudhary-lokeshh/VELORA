import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CreatorPublicPage } from '../src/product/creator-page';

/**
 * The public creator page, driven through the generated client against answers
 * the server would actually give.
 *
 * What is proved here is mostly about absence: that a visitor with no session
 * reaches a published page, that every unavailable case looks identical, and
 * that nothing on the page implies a purchase, a member count, or an internal
 * identifier.
 */

const baseUrl = 'http://api.test';

afterEach(cleanup);

interface PublicCreatorBody {
  bio?: string;
  displayName: string;
  handle: string;
  links: { label?: string; url: string }[];
  publishedAt: string;
}

function doubleFor(
  answer:
    | { readonly kind: 'ok'; readonly body: PublicCreatorBody }
    | { readonly kind: 'missing' }
    | { readonly kind: 'offline' },
  catalog: { id: string; summary?: string; title: string }[] = [],
  clubs: { description?: string; name: string; slug: string }[] = [],
): { readonly calls: string[]; readonly fetch: typeof globalThis.fetch } {
  const calls: string[] = [];
  return {
    calls,
    fetch: (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(input instanceof URL ? input.href : input, init);
      calls.push(request.url);
      if (
        answer.kind === 'ok' &&
        new URL(request.url).pathname === '/v1/creators/clubs'
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ clubs, handle: answer.body.handle }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
        );
      }
      if (
        answer.kind === 'ok' &&
        new URL(request.url).pathname === '/v1/creators/catalog'
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: catalog.map((entry) => ({
                ...entry,
                publishedAt: '2026-08-15T12:00:00.000Z',
              })),
              handle: answer.body.handle,
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        );
      }
      if (answer.kind === 'offline') throw new TypeError('network error');
      if (answer.kind === 'missing') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'RESOURCE_NOT_FOUND',
              correlationId: 'test',
              message: 'Request failed',
            }),
            { headers: { 'content-type': 'application/json' }, status: 404 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    },
  };
}

const published: PublicCreatorBody = {
  bio: 'Ceramics, slowly.',
  displayName: 'Ember Vale',
  handle: 'ember_vale',
  links: [
    { label: 'Shop', url: 'https://example.test/shop' },
    { url: 'https://example.test/journal' },
  ],
  publishedAt: '2026-08-15T12:00:00.000Z',
};

function renderPage(
  double: { readonly fetch: typeof globalThis.fetch },
  handle = 'ember_vale',
) {
  return render(
    <CreatorPublicPage
      apiBaseUrl={baseUrl}
      fetchImplementation={double.fetch}
      handle={handle}
    />,
  );
}

describe('the public creator page', () => {
  it('renders a published creator for a visitor carrying no credential', async () => {
    const double = doubleFor({ body: published, kind: 'ok' });
    renderPage(double);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ember Vale' }),
    ).toBeDefined();
    expect(screen.getByTestId('creator-page-handle').textContent).toBe(
      '@ember_vale',
    );
    expect(screen.getByTestId('creator-page-bio').textContent).toBe(
      'Ceramics, slowly.',
    );
    expect(double.calls[0]).toContain('handle=ember_vale');
  });

  it('shows nothing purchasable and no fabricated numbers', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }));
    await screen.findByTestId('creator-page');

    const markup = document.body.textContent;
    for (const forbidden of [
      'Subscribe',
      'Join',
      'Buy',
      'Members',
      'Followers',
      'Views',
      '€',
      '$',
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    expect(screen.queryByRole('button', { name: /subscribe|join|buy/iu })).toBe(
      null,
    );
  });

  it('gives every creator-supplied link the attributes a stranger link needs', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }));
    await screen.findByTestId('creator-page');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      const rel = link.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      expect(rel).toContain('nofollow');
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
    // A link with no label shows its address rather than an invented name.
    expect(links[1]?.textContent).toBe('https://example.test/journal');
  });

  it('says the page is unavailable without saying why, and offers no retry', async () => {
    renderPage(doubleFor({ kind: 'missing' }), 'nobody-here');

    const missing = await screen.findByTestId('creator-page-missing');
    expect(missing.textContent).toBe(
      'There is nothing to show at this address.',
    );
    // A refusal is a decision; repeating it changes nothing, so no retry is
    // offered. It also never says whether the handle exists.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.body.textContent).not.toContain('draft');
    expect(document.body.textContent).not.toContain('suspended');
  });

  it('offers a retry when the server could not be reached at all', async () => {
    renderPage(doubleFor({ kind: 'offline' }));

    await waitFor(() => {
      expect(screen.getByTestId('creator-page-missing')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('exposes exactly one document heading and a named link region', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }));
    await screen.findByTestId('creator-page');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('navigation', {
        name: 'Links this creator chose to show',
      }),
    ).toBeDefined();
  });
});

describe('the public creator catalog', () => {
  it('lists what the creator published, with no lifecycle or price anywhere', async () => {
    renderPage(
      doubleFor({ body: published, kind: 'ok' }, [
        { id: 'one', summary: 'A summary.', title: 'First post' },
        { id: 'two', title: 'Second post' },
      ]),
    );

    const list = await screen.findByTestId('creator-catalog');
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    const markup = document.body.textContent;
    for (const forbidden of ['Draft', 'draft', 'Archived', 'Price', 'Buy']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('says an empty catalog is empty rather than showing a failure', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }, []));

    const empty = await screen.findByTestId('creator-catalog-empty');
    expect(empty.textContent).toBe('Nothing published yet.');
  });
});

describe('the public club listing', () => {
  it('shows club metadata and nothing about members or payment', async () => {
    renderPage(
      doubleFor(
        { body: published, kind: 'ok' },
        [],
        [{ description: 'A quiet room.', name: 'Inner Circle', slug: 'inner' }],
      ),
    );

    const list = await screen.findByTestId('creator-public-clubs');
    expect(within(list).getByRole('heading', { level: 3 }).textContent).toBe(
      'Inner Circle',
    );
    const markup = document.body.textContent;
    for (const forbidden of ['Join', 'Subscribe', 'Price', 'Buy', '€', '$']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    // No member count of any kind, real or invented.
    expect(markup).not.toMatch(/\d+\s+members?/iu);
    // The honest statement about how somebody gets in.
    expect(markup).toContain('by invitation from this creator');
  });

  it('says nothing at all when a creator has published no club', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }, [], []));
    await screen.findByTestId('creator-page');

    expect(screen.queryByTestId('creator-public-clubs')).toBeNull();
  });
});
