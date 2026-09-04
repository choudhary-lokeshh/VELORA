import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../src/design/dialog';

/**
 * Whether the current history entry belongs to an open overlay.
 *
 * The mark is an identity rather than a flag, because one dialog routinely
 * replaces another and each has to recognise its own entry.
 */
const marked = () => {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return false;
  return (
    typeof (state as { veloraOverlay?: unknown }).veloraOverlay === 'number'
  );
};

afterEach(async () => {
  cleanup();
  // History traversal is asynchronous, and one jsdom window carries the whole
  // file: wait until the entry a dialog pushed has actually been consumed, so
  // no test starts on top of another's leftovers.
  await waitFor(() => {
    expect(marked()).toBe(false);
  });
});

/**
 * A dialog's place in history.
 *
 * On a phone the system Back is how overlays are dismissed, and a dialog that
 * ignored it let Back navigate the page out from underneath an open sheet.
 * Opening pushes one entry; popping it closes the dialog and goes nowhere;
 * closing any other way consumes the entry so Back never needs pressing twice.
 */
describe('a dialog and the Back button', () => {
  it('marks history while open', () => {
    render(
      <Dialog onClose={() => undefined} title="A choice">
        <p>body</p>
      </Dialog>,
    );

    expect(marked()).toBe(true);
  });

  it('closes on Back instead of leaving the page', async () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} title="A choice">
        <p>body</p>
      </Dialog>,
    );

    // A real traversal rather than a synthetic event, so the history entry is
    // actually consumed the way a Back press consumes it.
    window.history.back();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps one entry when one dialog replaces another', async () => {
    // The safety menu closes and the block confirmation opens in the same
    // commit. React destroys before it creates, so the menu's consume is
    // queued first and the browser delivers it after the confirmation has
    // opened — which used to close the confirmation the instant it appeared.
    const view = render(
      <Dialog onClose={() => undefined} title="A menu">
        <p>menu</p>
      </Dialog>,
    );
    const onClose = vi.fn();
    view.rerender(
      <Dialog onClose={onClose} title="A confirmation">
        <p>confirm</p>
      </Dialog>,
    );

    await waitFor(() => {
      expect(marked()).toBe(true);
    });
    expect(onClose).not.toHaveBeenCalled();

    // And the group still holds exactly one entry: one Back closes it.
    window.history.back();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(marked()).toBe(false);
    });
  });

  it('pushes nothing extra when one dialog hands over to another', async () => {
    const view = render(
      <Dialog key="menu" onClose={() => undefined} title="A menu">
        <p>menu</p>
      </Dialog>,
    );
    // Counted with one overlay open rather than with none, because a push that
    // follows a traversal truncates whatever was ahead of it: only the delta
    // across the handover says whether a second entry appeared.
    const entries = window.history.length;

    // A real handover, which the test above is not: the menu's instance is
    // destroyed and the report dialog's is created, both in one passive-effect
    // flush, exactly as Report and block replacing the safety menu does it.
    // The count goes 1 → 0 → 1 there, so a count that decided the push read the
    // arriving dialog as the first overlay on the page and pushed a second
    // entry — which the departing dialog's consume, finding something open
    // again, then declined to spend.
    const onClose = vi.fn();
    view.rerender(
      <Dialog key="report" onClose={onClose} title="A report">
        <p>report</p>
      </Dialog>,
    );

    await waitFor(() => {
      expect(marked()).toBe(true);
    });
    expect(window.history.length).toBe(entries);
    expect(onClose).not.toHaveBeenCalled();

    // One Back still closes what is open, once.
    window.history.back();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(marked()).toBe(false);
    });
  });

  it('leaves no entry behind when a handover ends by closing', async () => {
    const view = render(
      <Dialog key="menu" onClose={() => undefined} title="A menu">
        <p>menu</p>
      </Dialog>,
    );
    view.rerender(
      <Dialog key="report" onClose={() => undefined} title="A report">
        <p>report</p>
      </Dialog>,
    );
    await waitFor(() => {
      expect(marked()).toBe(true);
    });

    // The action completed and the dialog closed itself, which is how the
    // safety flow ends. Standing on a leftover overlay entry afterwards is what
    // makes the next Back do nothing and puts a route change one entry away
    // from being spent by a consume that arrives late.
    const entries = window.history.length;
    view.unmount();

    await waitFor(() => {
      expect(marked()).toBe(false);
    });
    // One consume for one entry: nothing was left to spend, and nothing spent
    // twice, which is what would have taken the page with it.
    expect(window.history.length).toBe(entries);
  });

  it('consumes its entry when closed some other way', async () => {
    const view = render(
      <Dialog onClose={() => undefined} title="A choice">
        <p>body</p>
      </Dialog>,
    );

    view.unmount();

    // The extra entry is popped on the way out, so the next Back is the
    // page's own rather than a no-op that has to be pressed twice.
    await waitFor(() => {
      expect(marked()).toBe(false);
    });
  });
});
