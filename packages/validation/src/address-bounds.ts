/**
 * The shapes that appear in a public address, with no schema library behind
 * them.
 *
 * A creator handle and a club slug are the two identifiers this platform puts
 * in a URL somebody can read, type, and send to a friend. Every other
 * identifier a client handles is a UUID, which a client can recognise without
 * being told anything; these two cannot be recognised without the repertoire,
 * so the repertoire lives here rather than being restated at each surface.
 *
 * Here rather than beside the schemas for the same reason as every other bound
 * in `*-bounds`: a client must be able to tell a malformed address from a real
 * one before it routes to it, and a React Native bundle that imported the
 * schemas to find a regular expression out would carry every schema in the
 * package to get it.
 *
 * `packages/validation` builds the zod schemas from exactly these constants, so
 * a client and the server agree about what an address can contain by
 * construction rather than by anybody remembering to update two copies.
 *
 * These are shape and nothing else. They decide whether a string could be an
 * address, never whether the thing at that address exists or may be seen — the
 * server re-derives both on every request, and a client that inferred anything
 * from a well-formed handle would be inventing an answer the server withheld.
 */

/* ------------------------------- Creators ------------------------------- */

export const minimumCreatorHandleLength = 3;
export const maximumCreatorHandleLength = 30;

/**
 * The canonical handle: lower-case ASCII, because lower-case ASCII cannot carry
 * a confusable. Bounded at both ends by an alphanumeric so a handle cannot
 * begin or end with punctuation.
 */
export const creatorHandlePattern = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/u;

/**
 * A handle as a caller may submit or link to it.
 *
 * Case is accepted and folded by the server, so a link written `@Ember_Vale`
 * addresses the same creator as `@ember_vale`. A client matching an address
 * therefore matches this rather than the canonical form: refusing the
 * capitalised link would make a perfectly good address unreachable on one
 * surface and reachable on another.
 */
export const submittedCreatorHandlePattern =
  /^[A-Za-z0-9][A-Za-z0-9_-]{1,28}[A-Za-z0-9]$/u;

/* -------------------------------- Clubs --------------------------------- */

export const minimumClubSlugLength = 3;
export const maximumClubSlugLength = 40;

/** The same repertoire as a handle, scoped to one creator rather than global. */
export const clubSlugPattern = /^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/u;

export const submittedClubSlugPattern =
  /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}[A-Za-z0-9]$/u;
