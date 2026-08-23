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

export const discoverPath = '/discover';
export const introductionsPath = '/introductions';
export const messagesPath = '/messages';
export const noticesPath = '/notices';
export const youPath = '/you';

export function conversationPath(conversationId: string): string {
  return `${messagesPath}/${encodeURIComponent(conversationId)}`;
}

/** The five leaves under You, named so a typo is a compile error. */
export type YouSection =
  'account' | 'availability' | 'notices' | 'profile' | 'safety';

export function youSectionPath(section: YouSection): string {
  return `${youPath}/${section}`;
}
