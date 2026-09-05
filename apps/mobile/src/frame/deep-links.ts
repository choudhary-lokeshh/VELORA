import {
  submittedClubSlugPattern,
  submittedCreatorHandlePattern,
} from '@velora/validation/address-bounds';

import {
  clubPath,
  conversationPath,
  creatorPath,
  discoverPath,
  livePath,
  introductionsPath,
  messagesPath,
  noticesPath,
  personPath,
  youPath,
  youSectionPath,
  youSections,
  type YouSection,
} from './links';

/**
 * Turning a link somebody sent into an address in this application, or
 * refusing to.
 *
 * A deep link is the least trustworthy input a mobile application takes. Any
 * application on the device can fire one, so this parser starts from the
 * position that the string is hostile and the only things it is allowed to
 * produce are addresses this application already publishes.
 *
 * The three rules everything below follows:
 *
 * 1. **An allow-list, never a translation.** A path is matched against the
 *    routes that exist and mapped through the same `links.ts` builders every
 *    screen uses. Nothing is passed through, concatenated, or interpolated
 *    from the input, so there is no path traversal to defend against — a
 *    segment that is not recognized produces no address at all.
 * 2. **An identifier is validated before it is used.** The contract publishes
 *    conversation and introduction identifiers as UUIDs, so anything else is
 *    refused here. This is not authorization: it stops a malformed address
 *    reaching the router and rendering a screen whose only outcome is an
 *    error.
 * 3. **Possession grants nothing.** `docs/surfaces/02-consumer-mobile.md`
 *    requires that a link buys nothing on its own, and this preserves that
 *    exactly by not trying to help: the resolved address is rendered behind
 *    the same gate as any other, every request behind it carries the session,
 *    and the server re-authorizes. A link to a conversation somebody may not
 *    see resolves to a real address and then shows a refusal, which is
 *    indistinguishable from a conversation that does not exist — which is the
 *    required behaviour, because telling the two apart would disclose that the
 *    object exists.
 *
 * An unknown link is not an error state. It lands on Notices, which is where
 * somebody would have gone to find out what happened anyway, and the reason is
 * carried alongside so a caller can say so rather than pretending the link
 * worked.
 */

export type ResolvedLink =
  | { readonly kind: 'route'; readonly path: string }
  /**
   * An invitation somebody sent. It is remembered and then it is a launch.
   *
   * There is no invitation screen on this platform and there should not be: a
   * phone that has the application installed does not need to be told what
   * VELORA is, and a person with no session lands on the welcome screen either
   * way. What the link is actually for is the code, which is held until an
   * account is created and handed over on the request that creates it.
   */
  | {
      readonly code: string;
      readonly kind: 'invitation';
      readonly path: string;
    }
  | {
      readonly kind: 'refused';
      readonly path: string;
      readonly reason: string;
    }
  /**
   * Somebody else's address on this application's scheme. The product neither
   * serves it nor complains about it.
   */
  | { readonly kind: 'ignored'; readonly owner: string };

/** The scheme the Android manifest declares, and the only one accepted. */
export const linkScheme = 'velora';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * The shape of an invitation code, matched before anything is stored.
 *
 * Validation rather than authorization, on the same terms as every other
 * identifier here: the code grants nothing, and checking it stops a malformed
 * address becoming a stored value the server will refuse anyway. A code that
 * does not match is not repaired into one that does.
 */
const invitePattern = /^[a-z0-9]{22}$/u;

/**
 * Addresses on the `velora://` scheme that belong to something other than the
 * product.
 *
 * The development client registers itself on the application's own scheme —
 * `velora://expo-development-client/?url=...` is how a development build is
 * pointed at a bundler — so the product sees a link on every development
 * launch that is not a product link at all. Treating it as a malformed one was
 * wrong twice over: it announced a refusal nobody caused and it navigated away
 * from the address the launch was for.
 *
 * These are ignored rather than refused, and the distinction is the point: a
 * refusal is for a link that was meant for the product and could not be
 * served, which is worth saying out loud.
 */
const foreignAddresses: Readonly<Record<string, string>> = {
  'expo-development-client': 'the development client',
  expo: 'the development client',
};

/**
 * The leaves under You, read from the module that names them.
 *
 * Kept as a second list here for as long as anybody can remember, and that is
 * exactly what went wrong: `memberships` was added to the routes and to
 * `links.ts` and never added to the copy, so a screen somebody could reach by
 * tapping was refused when they arrived by link. There is one list now.
 */
function youSectionOf(segment: string): YouSection | undefined {
  return youSections.find((candidate) => candidate === segment);
}

function refused(reason: string): ResolvedLink {
  return { kind: 'refused', path: noticesPath, reason };
}

/**
 * The segments of a link, however the platform chose to spell it.
 *
 * `velora://messages/x`, `velora:///messages/x`, and `velora:/messages/x` are
 * all produced in practice — by a notification intent, by
 * `Linking.createURL`, and by a person typing one — and they all mean the same
 * thing. Rather than depend on `URL`, whose host-versus-path behaviour for a
 * non-special scheme differs between runtimes, the scheme is removed and what
 * is left is split.
 *
 * Percent-encoded separators are rejected rather than decoded. `%2f` in a
 * segment can only be an attempt to smuggle a second segment past the match
 * below, because no identifier this application publishes contains one.
 */
export function linkSegments(url: string): readonly string[] | undefined {
  const trimmed = url.trim();
  const marker = `${linkScheme}:`;
  if (!trimmed.toLowerCase().startsWith(marker)) return undefined;
  let rest = trimmed.slice(marker.length);
  // A query or a fragment carries nothing this application reads. Dropping
  // them here means no later match can be influenced by one.
  rest = rest.split('?')[0] ?? '';
  rest = rest.split('#')[0] ?? '';
  rest = rest.replace(/^\/+/u, '');
  if (rest === '') return [];
  const raw = rest.split('/').filter((segment) => segment !== '');
  const segments: string[] = [];
  for (const segment of raw) {
    if (/%2f|%5c/iu.test(segment)) return undefined;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (decoded.includes('/') || decoded.includes('\\')) return undefined;
    if (decoded === '.' || decoded === '..') return undefined;
    segments.push(decoded);
  }
  return segments;
}

export function resolveDeepLink(url: string): ResolvedLink {
  const segments = linkSegments(url);
  if (segments === undefined) {
    return refused('That link is not a VELORA link.');
  }

  const [first, second, ...extra] = segments;

  // The launch address. Every destination is named, so `/` has nothing of its
  // own and Live is where a launch lands — it is the primary destination, and
  // a bare `velora://` is somebody opening the product rather than following a
  // link to a particular thing.
  if (first === undefined) return { kind: 'route', path: livePath };

  const owner = foreignAddresses[first];
  if (owner !== undefined) return { kind: 'ignored', owner };

  // Every destination but a club is at most two segments deep, so depth is
  // checked once here and the one route that is deeper checks its own.
  if (extra.length > 0 && first !== 'c')
    return refused('That link does not lead anywhere here.');

  switch (first) {
    case 'live':
      return second === undefined
        ? { kind: 'route', path: livePath }
        : refused('That link does not lead anywhere here.');

    case 'discover':
      return second === undefined
        ? { kind: 'route', path: discoverPath }
        : refused('That link does not lead anywhere here.');

    case 'introductions':
      return second === undefined
        ? { kind: 'route', path: introductionsPath }
        : refused('That link does not lead anywhere here.');

    case 'messages': {
      if (second === undefined) return { kind: 'route', path: messagesPath };
      if (!uuidPattern.test(second)) {
        return refused('That conversation link is not readable.');
      }
      return { kind: 'route', path: conversationPath(second) };
    }

    case 'notices':
      return second === undefined
        ? { kind: 'route', path: noticesPath }
        : refused('That link does not lead anywhere here.');

    /*
     * One person. There is no listing of people, so `velora://people` alone
     * leads nowhere and is refused rather than quietly sent to Discover —
     * which would be a different address than the one somebody was given.
     */
    case 'people': {
      if (second === undefined || !uuidPattern.test(second)) {
        return refused('That link does not lead anywhere here.');
      }
      return { kind: 'route', path: personPath(second) };
    }

    /*
     * A creator, and one of their clubs.
     *
     * The one address on this platform somebody is expected to *send*. It is
     * the address Consumer Web serves, it is what a creator puts next to their
     * name, and both screens behind it already exist here and are already
     * reached by tapping — `app/c/[handle]/index.tsx` says in its own comment
     * that it is reachable by deep link. It was not: this parser refused it,
     * and because a refusal navigates, following a perfectly good creator link
     * on a phone landed on Notices under a sentence saying the link led
     * nowhere. That is the `memberships` failure again, from the same cause —
     * a screen that exists for somebody tapping and not for somebody arriving.
     *
     * Handle and slug are matched against the *submitted* repertoire rather
     * than the canonical one. The server folds case, so `@Ember_Vale` is a real
     * address that a person writes down and another person types, and refusing
     * it here would make a working link work on one surface and not the other.
     * They are validated, not sanitized: a value that does not match is not
     * repaired into one that does.
     */
    case 'c': {
      if (second === undefined || !submittedCreatorHandlePattern.test(second)) {
        return refused('That link does not lead anywhere here.');
      }
      if (extra.length === 0)
        return { kind: 'route', path: creatorPath(second) };
      // `c/<handle>/club/<slug>` and nothing else at this depth. The literal
      // `club` is required rather than assumed, so a third segment naming
      // something this application does not serve is refused instead of being
      // read as a slug.
      const [marker, slug, ...beyond] = extra;
      if (
        marker !== 'club' ||
        beyond.length > 0 ||
        slug === undefined ||
        !submittedClubSlugPattern.test(slug)
      ) {
        return refused('That link does not lead anywhere here.');
      }
      return { kind: 'route', path: clubPath(second, slug) };
    }

    /*
     * An invitation. The address a person is most likely to be *sent* rather
     * than to arrive at by tapping.
     *
     * It resolves to the launch address rather than to a screen of its own,
     * because on a phone there is nothing an invitation screen could say that
     * the welcome screen does not: somebody opening this already has the
     * application. A code that is not the shape this platform issues is refused
     * with the ordinary sentence, so a mistyped link lands somewhere real
     * rather than silently pretending to have worked.
     */
    case 'invite': {
      if (second === undefined || !invitePattern.test(second)) {
        return refused('That invitation link is not readable.');
      }
      return { code: second, kind: 'invitation', path: livePath };
    }

    case 'you': {
      if (second === undefined) return { kind: 'route', path: youPath };
      const section = youSectionOf(second);
      if (section === undefined) {
        return refused('That link does not lead anywhere here.');
      }
      return { kind: 'route', path: youSectionPath(section) };
    }

    default:
      return refused('That link does not lead anywhere here.');
  }
}
