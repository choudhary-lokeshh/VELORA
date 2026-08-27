import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreatorDirectory } from '../src/product/creators';

/**
 * The creator directory, driven page by page against a server that pages.
 *
 * The defect this suite exists for was visible only in a browser console: with
 * more published pages than one request returns, the listing kept offering
 * "Show more creators" after the last page had arrived, and every further press
 * re-read the page just delivered and appended it again. React then reported
 * two children with the same key. Nothing failed, nothing threw, and every
 * assertion the suite had at the time still passed — so the reproduction is the
 * console itself: `console.error` is watched for React's duplicate-key report,
 * and a render that duplicates a creator fails on the warning rather than on a
 * count somebody remembered to assert.
 */

const baseUrl = 'http://api.test';
const pageSize = 24;

interface Directory {
  readonly calls: string[];
  readonly fetch: typeof globalThis.fetch;
}

/**
 * The directory route, keyset-paged the way the server pages it.
 *
 * `nextCursor` is where the next page starts and is absent on the last page,
 * which is the shape the contract publishes and the case the client got wrong.
 */
function directoryDouble(total: number): Directory {
  const world = Array.from({ length: total }, (_, index) => ({
    displayName: `Creator ${String(index).padStart(2, '0')}`,
    handle: `creator-${String(index).padStart(2, '0')}`,
  }));
  const calls: string[] = [];
  return {
    calls,
    fetch: (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(input instanceof URL ? input.href : input, init);
      const url = new URL(request.url);
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname !== '/v1/creators/directory') {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const rawCursor = url.searchParams.get('cursor');
      const from =
        rawCursor === null ? 0 : Number(rawCursor.replace('at-', ''));
      const rows = world.slice(from, from + pageSize);
      const end = from + rows.length;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            creators: rows,
            ...(end >= world.length ? {} : { nextCursor: `at-${String(end)}` }),
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        ),
      );
    },
  };
}

let warnings: string[] = [];
const reportedByReact = console.error;

beforeEach(() => {
  warnings = [];
  // Captured rather than silenced: React reports a duplicate key through
  // `console.error` and nowhere else, so this is the only place a test can see
  // the defect at all. The real reporter is put back after every test.
  console.error = (...args: unknown[]) => {
    warnings.push(args.map((one) => String(one)).join(' '));
  };
});

afterEach(() => {
  console.error = reportedByReact;
  cleanup();
});

/** Every duplicate-key report React made while a test ran. */
function duplicateKeyWarnings(): string[] {
  return warnings.filter((line) => /same key/iu.test(line));
}

function cards(): HTMLElement[] {
  return [...screen.getByTestId('creator-directory').querySelectorAll('li')];
}

function showMore(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Show more creators' });
}

describe('creator directory paging', () => {
  it('lists every published page exactly once and then stops offering more', async () => {
    const total = 29;
    const double = directoryDouble(total);
    render(
      <CreatorDirectory
        apiBaseUrl={baseUrl}
        fetchImplementation={double.fetch}
      />,
    );

    // Waited for the control rather than for the cards: the first page and the
    // cursor it carries arrive in that order, so a listing with 24 rows on
    // screen has not necessarily been told yet whether there is a 25th.
    await waitFor(() => {
      expect(showMore()).not.toBeNull();
    });
    expect(cards()).toHaveLength(pageSize);

    // Pressed for as long as the listing offers more, the way somebody reading
    // it would, with a bound so a control that never goes away fails here
    // instead of looping. The defect kept the control on screen for ever by
    // falling back to the first page's cursor once the last page had arrived,
    // and every press after the first appended that page again.
    let presses = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const control = showMore();
      if (control === null) break;
      fireEvent.click(control);
      presses += 1;
      const expected = presses + 1;
      await waitFor(() => {
        expect(double.calls).toHaveLength(expected);
      });
    }

    // Asserted first, because it is the symptom that was actually reported: a
    // console full of duplicate-key warnings during ordinary browsing.
    expect(duplicateKeyWarnings()).toEqual([]);
    expect(presses).toBe(1);
    expect(showMore()).toBeNull();
    expect(cards()).toHaveLength(total);
    const handles = cards().map((card) =>
      card.querySelector('a')?.getAttribute('data-testid'),
    );
    expect(new Set(handles).size).toBe(total);
  });

  it('offers nothing to continue when the whole listing fits one page', async () => {
    const total = 6;
    const double = directoryDouble(total);
    render(
      <CreatorDirectory
        apiBaseUrl={baseUrl}
        fetchImplementation={double.fetch}
      />,
    );

    await waitFor(() => {
      expect(cards()).toHaveLength(total);
    });
    expect(showMore()).toBeNull();
    expect(double.calls).toHaveLength(1);
    expect(duplicateKeyWarnings()).toEqual([]);
  });
});
