import type { Metadata } from 'next';

import { absoluteUrl, type PublicSite } from './site';
import { normalizePath, pathIsIndexable } from './routes';

/**
 * The document metadata every page publishes, built in one place.
 *
 * Three things have to agree for a page to be found and shared correctly — the
 * canonical address, the index directive, and the social preview — and each of
 * them has a different wrong answer available. A canonical carrying a referral
 * code splits one page into many; an index directive left to a default indexes
 * a preview deployment; a preview built from a page's own props leaks whatever
 * happened to be in them. They are decided together here so a page author picks
 * a title and a sentence and cannot get the rest wrong.
 */

/** The share image, drawn by `pnpm surfaces:assets` from this surface's tokens. */
export const shareImagePath = '/share/velora.png';
const shareImageWidth = 1200;
const shareImageHeight = 630;

/**
 * The longest description worth publishing.
 *
 * A result renders roughly this much and discards the rest, and a description
 * that is cut mid-word reads as broken rather than as long. Dynamic text is
 * bounded to it on the way in, so the value that reaches the document is one
 * this surface chose the length of rather than one a creator did.
 */
export const maximumDescriptionLength = 200;

export interface PageMetadataInput {
  /** The sentence a search result and a social preview both show. */
  readonly description: string;
  /** This page's own path. Query and fragment are dropped before use. */
  readonly path: string;
  readonly site: PublicSite;
  /**
   * Forced off for a page that exists but should never be kept: an entity that
   * has been withdrawn, a state that is nobody else's business. It can only ever
   * make a page less visible — a page absent from the route policy cannot be
   * turned indexable from here.
   */
  readonly indexable?: boolean;
  /** The `<title>`, without the ` · VELORA` the root template appends. */
  readonly title: string;
  /** `profile` for a page whose subject is a person, `website` otherwise. */
  readonly type?: 'profile' | 'website';
}

/**
 * Everything a page's `<head>` needs, given what the page is about.
 *
 * The canonical is built from the path alone. That is the entire defence
 * against referral and campaign parameters splitting a page into one indexed
 * copy per link anybody has ever shared: `/c/alex?ref=abc&utm_source=x` and
 * `/c/alex` publish the same canonical, so attribution can travel in the
 * address without the address becoming a second page.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const path = normalizePath(input.path);
  const canonical = absoluteUrl(input.site, path);
  const description = boundedText(input.description, maximumDescriptionLength);
  const indexable =
    input.site.indexable && pathIsIndexable(path) && input.indexable !== false;

  return {
    alternates: { canonical },
    description,
    // Written explicitly in both directions rather than left to a default. A
    // page that is not indexable says so in the document as well as in the
    // response header, because the two are read by different crawlers at
    // different moments and neither is worth relying on alone.
    robots: indexable
      ? { follow: true, index: true }
      : { follow: false, index: false },
    openGraph: {
      description,
      locale: 'en',
      siteName: 'VELORA',
      title: input.title,
      type: input.type ?? 'website',
      url: canonical,
      // Only where an absolute address exists. A relative image in a social
      // preview is resolved against whatever host the scraper thinks it is
      // talking to, and an environment with no public identity has no honest
      // answer to give it.
      ...(input.site.origin === undefined
        ? {}
        : {
            images: [
              {
                alt: 'VELORA',
                height: shareImageHeight,
                url: absoluteUrl(input.site, shareImagePath),
                width: shareImageWidth,
              },
            ],
          }),
    },
    title: input.title,
    twitter: {
      card: 'summary_large_image',
      description,
      title: input.title,
      ...(input.site.origin === undefined
        ? {}
        : { images: [absoluteUrl(input.site, shareImagePath)] }),
    },
  };
}

/**
 * The metadata for an address nobody should arrive at from a search result.
 *
 * Sign-in, an invitation landing, a payment return, and every page behind the
 * session gate. They still get a real title, because a browser tab and a
 * history entry are read by the person using the product rather than by a
 * crawler, and "VELORA" seven times over is a worse answer for them than it is
 * for anybody else.
 */
export function privateMetadata(title: string): Metadata {
  return { robots: { follow: false, index: false }, title };
}

/**
 * Somebody else's words, made safe to publish in a document head.
 *
 * Whitespace is collapsed and the result is cut at a word boundary. Nothing
 * here escapes anything — React and Next do that where the value is written —
 * but a bio pasted with newlines produces a description that renders as a
 * paragraph break inside a search result, and a bio at its own 600-character
 * limit produces one that is silently truncated by whoever displays it. Both
 * are decided here instead.
 */
export function boundedText(value: string, limit: number): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,.;:-]+$/u, '')}…`;
}
