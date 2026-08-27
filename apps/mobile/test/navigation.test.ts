import { leave, type Stack } from '../src/frame/navigation';
import {
  conversationPath,
  messagesPath,
  youPath,
  youSectionPath,
} from '../src/frame/links';

/**
 * Leaving a pushed screen, with and without a stack under it.
 *
 * A phone has two Backs — the arrow on screen and the system button or gesture
 * — and both reach the same code, because the native stack pops on the system
 * one and the arrow calls this. So what is asserted here is asserted about both
 * at once: the only difference between them is who calls it.
 *
 * The case worth a test is the one that cannot be reached by navigating. A
 * notification, a `velora://` link, and a cold start on a deep link each put
 * somebody on a pushed screen with nothing behind it, and popping an empty
 * stack on Android closes the application. That is why the stack is an
 * interface here: a mounted router cannot be asked to have no history.
 */

function stackWith(history: boolean): {
  readonly calls: string[];
  readonly stack: Stack;
} {
  const calls: string[] = [];
  return {
    calls,
    stack: {
      back: () => {
        calls.push('back');
      },
      canGoBack: () => history,
      replace: (path: string) => {
        calls.push(`replace ${path}`);
      },
    },
  };
}

describe('leaving a screen that was pushed', () => {
  it('pops the stack when there is something behind the screen', () => {
    // The ordinary case, and the one the system Back does natively: return to
    // the exact screen underneath rather than to a fresh copy of it.
    const { calls, stack } = stackWith(true);
    leave(stack, messagesPath);
    expect(calls).toEqual(['back']);
  });

  it('goes to the product parent when the screen was opened directly', () => {
    // Deep link, notification, cold start. Popping here would close the
    // application instead of leaving the screen.
    const { calls, stack } = stackWith(false);
    leave(stack, messagesPath);
    expect(calls).toEqual([`replace ${messagesPath}`]);
  });

  it('replaces rather than pushes, so the screen being left does not stay behind', () => {
    const { calls, stack } = stackWith(false);
    leave(stack, youPath);
    expect(calls).toEqual([`replace ${youPath}`]);
    expect(calls.some((call) => call.startsWith('push'))).toBe(false);
  });

  it('never navigates twice for one press', () => {
    // A double-pop is the defect this shape exists to prevent: one press, one
    // navigation, whichever branch it takes.
    for (const history of [true, false]) {
      const { calls, stack } = stackWith(history);
      leave(stack, messagesPath);
      expect(calls).toHaveLength(1);
    }
  });

  it('falls back to an address the application actually serves', () => {
    // Both parents are built by the same functions the tab bar and the router
    // use, so a renamed route cannot leave a fallback pointing at nothing.
    expect(messagesPath).toBe('/messages');
    expect(youPath).toBe('/you');
    expect(conversationPath('c-1')).toBe('/messages/c-1');
    expect(youSectionPath('safety')).toBe('/you/safety');
  });

  it('keeps an identifier that would otherwise change the shape of the address', () => {
    // A conversation identifier arrives from a server payload or a link, so a
    // slash in one must not turn one address into two segments.
    expect(conversationPath('a/b')).toBe('/messages/a%2Fb');
  });
});
