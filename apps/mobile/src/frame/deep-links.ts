import {
  conversationPath,
  discoverPath,
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
  // own and Discover is where a launch lands.
  if (first === undefined) return { kind: 'route', path: discoverPath };

  const owner = foreignAddresses[first];
  if (owner !== undefined) return { kind: 'ignored', owner };

  if (extra.length > 0)
    return refused('That link does not lead anywhere here.');

  switch (first) {
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
