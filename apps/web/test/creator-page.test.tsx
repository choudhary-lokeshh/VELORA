import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConsumerApi } from '@velora/consumer-client';

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
  clubs: {
    benefits?: string[];
    description?: string;
    id?: string;
    name: string;
    slug: string;
  }[] = [],
  memberships: {
    gates?: string[];
    offers?: {
      id: string;
      mode: 'subscription';
      prices: {
        amount: { amountMinor: string; currency: string };
        id: string;
        interval?: 'month' | 'year';
      }[];
      resource: { id: string; type: 'club' };
    }[];
    readiness?: {
      currencies: string[];
      enabled: boolean;
      intervals: string[];
      modes: string[];
      source: string;
    };
  } = {},
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
          new Response(
            JSON.stringify({
              clubs: clubs.map((club) => ({
                benefits: [],
                id: '99999999-9999-4999-8999-999999999999',
                ...club,
              })),
              handle: answer.body.handle,
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        );
      }
      if (
        answer.kind === 'ok' &&
        new URL(request.url).pathname === '/v1/creators/memberships'
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...(memberships.gates === undefined
                ? {}
                : { gates: memberships.gates }),
              handle: answer.body.handle,
              offers: memberships.offers ?? [],
              readiness: memberships.readiness ?? {
                currencies: [],
                enabled: false,
                intervals: [],
                modes: [],
                source: 'unpublished',
              },
              subscriptions: [],
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
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
                // The contract publishes an images array on every item, empty
                // when there are none, so a surface never distinguishes "no
                // images" from "an older server".
                media: [],
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

    // Scoped to the links the creator supplied. The page's own wordmark is a
    // VELORA link home and is not somebody else's destination.
    const links = within(screen.getByTestId('creator-page-links')).getAllByRole(
      'link',
    );
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

describe('virtual gifts on a creator page', () => {
  it('requires review, sends the catalog identity, and renders confirmed server truth', async () => {
    const calls: unknown[] = [];
    const item = {
      description: 'A small bloom of appreciation.',
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Rose',
      price: { amountMinor: '100', currency: 'USD' as const },
      tier: 'small' as const,
      visual: 'rose' as const,
    };
    const consumerApi = {
      // The membership section asks two owners for the same page. A gift test
      // has nothing to say about either, so both answer empty rather than
      // being left off and throwing inside a render.
      membershipOffers: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: {
            handle: published.handle,
            offers: [],
            readiness: {
              currencies: [],
              enabled: false,
              intervals: [],
              modes: [],
              source: 'unpublished',
            },
            subscriptions: [],
          },
        }),
      publicClubs: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: { clubs: [], handle: published.handle },
        }),
      giftCatalog: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: {
            creator: {
              displayName: published.displayName,
              handle: published.handle,
            },
            enabled: true,
            items: [item],
          },
        }),
      sendGift: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({
          kind: 'ok' as const,
          value: {
            gift: {
              createdAt: '2026-08-25T12:00:00.000Z',
              creator: {
                displayName: published.displayName,
                handle: published.handle,
              },
              gift: { id: item.id, name: item.name, visual: item.visual },
              id: '20000000-0000-4000-8000-000000000001',
              price: item.price,
              sentAt: '2026-08-25T12:00:01.000Z',
              state: 'sent' as const,
            },
          },
        });
      },
    } as unknown as ConsumerApi;

    render(
      <CreatorPublicPage
        apiBaseUrl={baseUrl}
        consumerApi={consumerApi}
        fetchImplementation={doubleFor({ body: published, kind: 'ok' }).fetch}
        handle={published.handle}
        signedIn
      />,
    );

    fireEvent.click(await screen.findByTestId('gift-choice-rose'));
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send Rose' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm gift' });
    expect(dialog.textContent).toContain('1.00 USD');
    expect(dialog.textContent).toContain('unlocks no content');
    fireEvent.click(screen.getByTestId('gift-confirm-accept'));
    fireEvent.click(screen.getByTestId('gift-confirm-accept'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toMatchObject({
      body: {
        context: { type: 'creator_profile' },
        currency: 'USD',
        giftItemId: item.id,
        handle: published.handle,
      },
    });
    expect(await screen.findByText(/Gift sent/u)).toBeDefined();
  });

  it('never presents a pending payment as a sent gift and retries one intent safely', async () => {
    const calls: { idempotencyKey: string }[] = [];
    const messages: string[] = [];
    const item = {
      description: 'A small bloom of appreciation.',
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Rose',
      price: { amountMinor: '100', currency: 'USD' as const },
      tier: 'small' as const,
      visual: 'rose' as const,
    };
    const consumerApi = {
      // The membership section asks two owners for the same page. A gift test
      // has nothing to say about either, so both answer empty rather than
      // being left off and throwing inside a render.
      membershipOffers: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: {
            handle: published.handle,
            offers: [],
            readiness: {
              currencies: [],
              enabled: false,
              intervals: [],
              modes: [],
              source: 'unpublished',
            },
            subscriptions: [],
          },
        }),
      publicClubs: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: { clubs: [], handle: published.handle },
        }),
      giftCatalog: () =>
        Promise.resolve({
          kind: 'ok' as const,
          value: {
            creator: {
              displayName: published.displayName,
              handle: published.handle,
            },
            enabled: true,
            items: [item],
          },
        }),
      sendGift: (input: { idempotencyKey: string }) => {
        calls.push(input);
        return Promise.resolve({
          kind: 'ok' as const,
          value: {
            gift: {
              createdAt: '2026-08-25T12:00:00.000Z',
              creator: {
                displayName: published.displayName,
                handle: published.handle,
              },
              gift: { id: item.id, name: item.name, visual: item.visual },
              id: '20000000-0000-4000-8000-000000000002',
              price: item.price,
              state: 'pending' as const,
            },
          },
        });
      },
    } as unknown as ConsumerApi;

    render(
      <CreatorPublicPage
        apiBaseUrl={baseUrl}
        consumerApi={consumerApi}
        fetchImplementation={doubleFor({ body: published, kind: 'ok' }).fetch}
        handle={published.handle}
        showToast={(message) => {
          messages.push(message);
        }}
        signedIn
      />,
    );
    fireEvent.click(await screen.findByTestId('gift-choice-rose'));
    fireEvent.click(screen.getByRole('button', { name: 'Send Rose' }));
    fireEvent.click(screen.getByTestId('gift-confirm-accept'));
    await waitFor(() => {
      expect(messages.at(-1)).toContain('not sent yet');
    });
    expect(screen.queryByText(/Gift sent/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send Rose' }));
    fireEvent.click(screen.getByTestId('gift-confirm-accept'));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
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
  const club = {
    benefits: ['A letter every week'],
    description: 'A quiet room.',
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Inner Circle',
    slug: 'inner',
  };

  it('offers no purchase for a club nobody priced', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }, [], [club]));

    const list = await screen.findByTestId('creator-public-clubs');
    expect(within(list).getByRole('heading', { level: 3 }).textContent).toBe(
      'Inner Circle',
    );
    // What its creator promises is presentation, and it is theirs to write.
    expect(list.textContent).toContain('A letter every week');
    const markup = document.body.textContent;
    for (const forbidden of ['Join this club', 'Subscribe', '€', '$']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
    // No member count of any kind, real or invented.
    expect(markup).not.toMatch(/\d+\s+members?/iu);
    // The honest statement about how somebody gets in.
    expect(markup).toContain('by invitation from this creator');
  });

  it('shows a price only when the commercial owner published one', async () => {
    renderPage(
      doubleFor({ body: published, kind: 'ok' }, [], [club], {
        gates: [],
        offers: [
          {
            id: 'offer-1',
            mode: 'subscription',
            prices: [
              {
                amount: { amountMinor: '1500', currency: 'USD' },
                id: 'price-1',
                interval: 'month',
              },
            ],
            resource: { id: club.id, type: 'club' },
          },
        ],
        readiness: {
          currencies: ['USD'],
          enabled: true,
          intervals: ['month'],
          modes: ['subscription'],
          source: 'local-test',
        },
      }),
    );

    const list = await screen.findByTestId('creator-public-clubs');
    // Two owners, joined on an opaque identifier by the surface that asked for
    // both. Neither route knows the other exists.
    expect(list.textContent).toContain('15.00 USD');
    expect(list.textContent).toContain('a month');
    // Signed out: the honest control is the one that gets somebody a session,
    // not one that would refuse.
    await screen.findByTestId('club-join-signin-inner');
    expect(screen.queryByTestId('club-join-inner')).toBeNull();
  });

  it('says nothing at all when a creator has published no club', async () => {
    renderPage(doubleFor({ body: published, kind: 'ok' }, [], []));
    await screen.findByTestId('creator-page');

    expect(screen.queryByTestId('creator-public-clubs')).toBeNull();
  });
});
