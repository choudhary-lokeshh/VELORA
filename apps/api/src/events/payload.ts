/**
 * Shape checks a published-fact parser needs.
 *
 * A stored payload was written by one version of this code and is read by
 * another, so every consumer parses rather than casts. These helpers exist once
 * so two producers cannot disagree about what a well-formed identifier is.
 */

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}
