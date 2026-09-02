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
 * It is measured two ways, because either alone lets a real defect through. The
 * element rectangles name the culprit when there is one to name. The document's
 * own scroll width catches the case where every element looks contained and the
 * page moves anyway.
 */
export const viewportWidths = [
  320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1728,
] as const;

export async function overflowingElements(
  page: Page,
): Promise<readonly string[]> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth;
    const offenders: string[] = [];

    /**
     * Whether something is inside a container that deliberately clips or scrolls
     * sideways.
     *
     * A code block that scrolls within its own bounds is a designed answer to a
     * narrow screen; its children extend past the viewport and nothing about the
     * page moves. What this function is looking for is the other thing — an
     * element that pushes the *page* sideways.
     *
     * Position matters to that question and is easy to miss. An absolutely
     * positioned box is clipped by an ancestor's overflow only when that
     * ancestor is in its containing-block chain, so a static scroller does not
     * hold it: screen-reader-only text inside a wide table looks contained,
     * resolves against the page instead, and grows the document. Ancestors that
     * establish no containing block are therefore skipped for such a box, and a
     * fixed box is treated as contained by nothing at all.
     */
    const contained = (node: Element): boolean => {
      const position = getComputedStyle(node).position;
      if (position === 'fixed') return false;
      const needsPositionedAncestor = position === 'absolute';
      let parent = node.parentElement;
      while (parent !== null && parent !== document.body) {
        const style = getComputedStyle(parent);
        const establishesContainingBlock =
          style.position !== 'static' ||
          style.transform !== 'none' ||
          style.filter !== 'none';
        if (needsPositionedAncestor && !establishesContainingBlock) {
          parent = parent.parentElement;
          continue;
        }
        if (style.overflowX !== 'visible') return true;
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

    // The symptom itself, whether or not an element owned up to causing it.
    if (root.scrollWidth > limit + 0.5) {
      offenders.push(
        `document scrolls sideways: ${String(root.scrollWidth)} of ${String(
          limit,
        )}`,
      );
    }

    /*
     * Scroll containers themselves, measured from the inside.
     *
     * `contained()` above excuses anything inside a clipping or scrolling
     * ancestor, and that excuse has a blind spot: every `overflow-y: auto`
     * pane computes `overflow-x` to `auto` as well, so a pane whose content
     * grew sideways reports clean while hiding a sideways scrollbar of its
     * own. The one intentional sideways scroller wears `v-segmented` and is
     * allowed; everything else that actually scrolls sideways is a defect
     * this suite exists to see.
     */
    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
      if (node.classList.contains('v-segmented')) continue;
      if (node.scrollWidth <= node.clientWidth + 0.5) continue;
      const identifier =
        node.getAttribute('data-testid') ??
        (typeof node.className === 'string' ? node.className : '');
      offenders.push(
        `${node.tagName.toLowerCase()}[${identifier}] scrolls sideways inside itself: ${String(
          node.scrollWidth,
        )} of ${String(node.clientWidth)}`,
      );
    }

    return offenders;
  });
}
