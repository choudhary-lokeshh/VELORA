import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../src/design/dialog';

const marked = () => {
  const state: unknown = window.history.state;
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { veloraOverlay?: unknown }).veloraOverlay === true
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
