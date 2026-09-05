import { cookies } from 'next/headers';
import { cache } from 'react';

import {
  createConsumerApi,
  type ClubDetail,
  type LiveWindow,
  type PublicClubList,
} from '@velora/consumer-client';
import { browserSessionCookieNames } from '@velora/validation';
import {
  createCreatorApi,
  type PublicCreator,
  type PublicCreatorDirectory,
} from '@velora/creator-client';

import { resolveApiBaseUrl } from '../api';

/**
 * The public answers this surface reads on the server, before anything renders.
 *
 * They were already reachable from the browser and are read here as well, for
 * one reason: a page whose only content arrives after hydration is an empty
 * document to anything that does not run scripts, and the addresses a person
 * arrives at from a search result or a shared link are exactly the ones with no
 * session to wait for. Rendering them on the server is what makes a creator's
 * page a page rather than a loading state.
 *
 * Every call here carries no credential, because every route it calls answers
 * identically for everybody. That is also what makes the answers safe to render
 * before a session exists: there is no viewer-specific state in them to leak,
 * and nothing here decides who may see what — the server already did.
 */

/**
 * How long a public read may take before the page gives up on it.
 *
 * A crawler and a person share the same budget, and both would rather have a
 * page that says the creator could not be loaded than a request that hangs
 * until a proxy kills it. Short enough that a failing API cannot hold a render
 * open; long enough that an ordinary cold answer arrives.
 */
const readTimeoutMilliseconds = 4_000;

/** No credential, ever. These routes answer the same for every requester. */
const anonymousTransport = { headers: () => Promise.resolve({}) };

function timeout(): AbortSignal {
  return AbortSignal.timeout(readTimeoutMilliseconds);
}

/**
 * One public creator, or nothing.
 *
 * An unknown handle, a page still in draft, and a creator who is not active are
 * one answer, because the server gives one answer. Nothing here tries to tell
 * them apart, and a transport failure joins them: a page that rendered "this
 * creator does not exist" because the API was briefly unreachable would be
 * publishing a claim it cannot support, so the caller is told the read failed
 * and decides what to say.
 *
 * Memoised for the life of one request. A creator page asks this twice — once
 * to write the document head and once to render — and without this the address
 * would cost two round trips to answer one question that cannot have changed
 * between them.
 */
export const readPublicCreator = cache(
  async (
    handle: string,
  ): Promise<
    | { readonly kind: 'creator'; readonly creator: PublicCreator }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unavailable' }
  > => {
    const api = createCreatorApi({
      apiBaseUrl: resolveApiBaseUrl(),
      transport: anonymousTransport,
    });
    const result = await api.publicCreator(handle);
    if (result.kind === 'ok') return { creator: result.value, kind: 'creator' };
    if (result.kind === 'not-found') return { kind: 'absent' };
    return { kind: 'unavailable' };
  },
);

/**
 * Whether this request arrived carrying a Consumer Web session cookie.
 *
 * Presence only, and it authorises nothing — the cookie is opaque, this surface
 * cannot read it, and every request behind it is authorised by the server that
 * issued it. What it answers is a rendering question: is the anonymous
 * projection the right thing to put in this response, or would it be a state
 * this reader is about to be moved out of.
 *
 * A crawler, a link preview, and somebody following a shared link have no
 * cookie, and they are exactly the readers a public page is rendered on the
 * server for.
 */
export async function arrivedWithoutSession(): Promise<boolean> {
  return !(await cookies()).has(browserSessionCookieNames.consumer_web);
}

/**
 * One club as somebody with no session sees it.
 *
 * The response carries the club's public facts and an empty feed, because the
 * server decides who may read the feed and answers with an empty one for
 * everybody else. That is what makes this safe to render into a document
 * anybody can be served: there is no protected body in it to hide.
 *
 * Three answers rather than two, on the same reasoning as the creator read: a
 * club that has been closed and a club the API could not be asked about are
 * different facts, and answering 404 for the second would publish a claim about
 * somebody else's community on the strength of our own outage.
 *
 * Memoised per request for the same reason the creator read is.
 */
export const readPublicClub = cache(
  async (input: {
    readonly handle: string;
    readonly slug: string;
  }): Promise<
    | { readonly kind: 'club'; readonly detail: ClubDetail }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unavailable' }
  > => {
    const api = createConsumerApi({
      apiBaseUrl: resolveApiBaseUrl(),
      transport: anonymousTransport,
    });
    const result = await api.club(input, timeout());
    if (result.kind === 'ok') return { detail: result.value, kind: 'club' };
    if (result.kind === 'not-found') return { kind: 'absent' };
    return { kind: 'unavailable' };
  },
);

/** The published clubs on a creator's page, as somebody with no session sees them. */
export async function readPublicClubs(
  handle: string,
): Promise<PublicClubList | undefined> {
  const api = createConsumerApi({
    apiBaseUrl: resolveApiBaseUrl(),
    transport: anonymousTransport,
  });
  const result = await api.publicClubs(handle, timeout());
  return result.kind === 'ok' ? result.value : undefined;
}

/**
 * The scheduled times worth announcing, read on the server.
 *
 * Read here rather than in the browser because it appears on the entry page,
 * which is the address a search result and a shared link both land on: a time
 * that only exists after hydration is a time nothing reading the document can
 * see. It is the same answer for everybody, so there is nothing viewer-specific
 * to leak by rendering it before a session exists.
 *
 * A failure answers with no windows rather than with an error. The entry page
 * is not about this, and a section that cannot be filled is a section that is
 * absent.
 */
export const readLiveWindows = cache(
  async (): Promise<readonly LiveWindow[]> => {
    const api = createConsumerApi({
      apiBaseUrl: resolveApiBaseUrl(),
      transport: anonymousTransport,
    });
    const result = await api.liveWindows(timeout());
    return result.kind === 'ok' ? result.value.windows : [];
  },
);

/** One page of the published creator listing. */
export async function readCreatorDirectory(query?: {
  readonly cursor?: string | undefined;
  readonly pageSize?: number | undefined;
}): Promise<PublicCreatorDirectory | undefined> {
  const api = createCreatorApi({
    apiBaseUrl: resolveApiBaseUrl(),
    transport: anonymousTransport,
  });
  const result = await api.publicCreatorDirectory(query);
  return result.kind === 'ok' ? result.value : undefined;
}

/**
 * Every published creator handle a sitemap is willing to offer, newest first.
 *
 * Walked rather than loaded: the listing is keyset paged and this follows the
 * cursor, so the database is asked for a bounded page at a time instead of for
 * every creator at once. The ceiling is a real limit rather than a guess at how
 * many there will ever be — a sitemap is a hint to a crawler, not an inventory,
 * and one that grows without bound would eventually be a request that times out
 * instead of a file anybody reads.
 *
 * A failed page stops the walk and returns what was gathered. A partial sitemap
 * is a smaller hint; an empty response because the last page failed would
 * withdraw every address in it.
 */
export async function readPublishedCreatorHandles(
  ceiling = 1_000,
): Promise<readonly string[]> {
  const pageSize = 50;
  const handles: string[] = [];
  let cursor: string | undefined;

  while (handles.length < ceiling) {
    const page = await readCreatorDirectory({
      ...(cursor === undefined ? {} : { cursor }),
      pageSize,
    });
    if (page === undefined) break;
    for (const creator of page.creators) {
      if (handles.length >= ceiling) break;
      handles.push(creator.handle);
    }
    if (page.nextCursor === undefined || page.creators.length === 0) break;
    cursor = page.nextCursor;
  }

  return handles;
}
