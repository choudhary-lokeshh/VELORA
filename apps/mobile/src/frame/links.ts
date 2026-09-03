/**
 * Every address in the application, built in one place.
 *
 * Expo Router can generate a union of literal route types, and this application
 * does not use it: the generated file lives under `.expo/`, which is not
 * committed, so it is absent in CI and present locally — and `expo export`
 * rewrites it with an empty route list, which turns the next `tsc` run red for
 * links that are perfectly correct. A check that is red locally and green in CI
 * for the same code is worse than no check.
 *
 * These functions are the replacement, and a stronger one for what actually
 * goes wrong: a path is never written as a literal at a call site, an
 * identifier is always interpolated by a function that knows the shape, and a
 * route that is renamed is renamed here once. `docs/surfaces/02-consumer-mobile.md`
 * requires that link possession grants nothing — every one of these addresses
 * is re-authorized by the server behind it, and the identifier in the path buys
 * nothing on its own.
 */

export const livePath = '/live';
export const discoverPath = '/discover';
export const introductionsPath = '/introductions';
export const messagesPath = '/messages';
export const noticesPath = '/notices';
export const youPath = '/you';

export function conversationPath(conversationId: string): string {
  return `${messagesPath}/${encodeURIComponent(conversationId)}`;
}

/**
 * The leaves under You, named so a typo is a compile error.
 *
 * A list first and a type second, rather than a type alone. Everything that
 * has to agree about the set — the router, the deep-link parser, and the tests
 * for both — reads this one array, so a section cannot exist for somebody
 * tapping through the application and not exist for somebody arriving by link.
 * That is not hypothetical: `memberships` arrived on 2026-08-28 and was a real
 * screen the parser refused from that day until this one, because the parser
 * kept a second copy of this list.
 */
export const youSections = [
  'account',
  'availability',
  'gifts',
  'help',
  'memberships',
  'notices',
  'profile',
  'safety',
  'wallet',
] as const;

export type YouSection = (typeof youSections)[number];

export function youSectionPath(section: YouSection): string {
  return `${youPath}/${section}`;
}

/**
 * One person, at their own address.
 *
 * By identifier rather than by handle, because a person in Discover has no
 * handle — only a creator does. Possession grants nothing: the server decides
 * on every request whether this reader may be shown anything behind it.
 */
export function personPath(personId: string): string {
  return `/people/${encodeURIComponent(personId)}`;
}

/**
 * A creator's public page, and one of their clubs.
 *
 * Addressed by handle and slug rather than by identifier, so the address a
 * person sees on a phone is the address they see anywhere else and a link
 * shared between the two lands in the same place. Possession of either grants
 * nothing: the server re-derives on every request whether this reader may see
 * what is inside.
 */
export function creatorPath(handle: string): string {
  return `/c/${encodeURIComponent(handle)}`;
}

export function clubPath(handle: string, slug: string): string {
  return `${creatorPath(handle)}/club/${encodeURIComponent(slug)}`;
}
