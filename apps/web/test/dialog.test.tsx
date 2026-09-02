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
