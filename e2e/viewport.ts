import type { Page } from '@playwright/test';

/**
 * The widths people actually use, and the one measurement worth making at each.
 *
 * `docs/design/04-responsive-platform-rules.md` asks each viewport class to
 * reflow on content and interaction needs rather than on device names, and it
 * forbids a persistent control covering content or the browser's own chrome.
 * Asserting that from a stylesheet is asserting the stylesheet; the only place
 * it is real is a browser at a size.
 *
 * Sideways scrolling is the assertion that catches the most: a single element
 * wider than the viewport turns every page into one that rocks under a thumb.
 * It is measured against the element rectangles rather than `scrollWidth`, so a
 * failure names the element rather than the symptom.
 */
export const viewportWidths = [
  320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1728,
] as const;

export async function overflowingElements(
  page: Page,
): Promise<readonly string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: string[] = [];

    /**
     * Whether something is inside a container that deliberately clips or scrolls
     * sideways.
     *
     * A code block that scrolls within its own bounds is a designed answer to a
     * narrow screen; its children extend past the viewport and nothing about the
     * page moves. What this function is looking for is the other thing — an
     * element that pushes the *page* sideways.
     */
    const contained = (node: Element): boolean => {
      let parent = node.parentElement;
      while (parent !== null && parent !== document.body) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow !== 'visible') return true;
        parent = parent.parentElement;
      }
      return false;
    };

    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const rectangle = node.getBoundingClientRect();
      if (rectangle.width === 0 || rectangle.height === 0) continue;
      // Half a pixel of slack: sub-pixel layout rounding is not an overflow.
      if (rectangle.right <= limit + 0.5 && rectangle.left >= -0.5) continue;
      if (contained(node)) continue;
      const identifier =
        node.getAttribute('data-testid') ??
        (typeof node.className === 'string' ? node.className : '');
      offenders.push(
        `${node.tagName.toLowerCase()}[${identifier}] ${String(
          Math.round(rectangle.left),
        )}..${String(Math.round(rectangle.right))} of ${String(limit)}`,
      );
    }
    return offenders;
  });
}
