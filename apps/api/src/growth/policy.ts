/**
 * GROWTH's own rules, in one place so a route, a service, and a table cannot
 * each hold a slightly different version of them.
 *
 * The domain is small and its rules are mostly refusals. What it owns is how
 * somebody arrived — an invitation, a campaign, a scheduled time — and what it
 * must never own is anything that follows from arriving: no entitlement, no
 * balance, no standing, no reward. Every constant below exists to keep one of
 * those out.
 */

/**
 * The alphabet an invitation code is drawn from, and its length.
 *
 * Lowercase alphanumerics because a code survives being read aloud, retyped,
 * and lowercased by a chat client that thinks it is helping. Twenty-two of them
 * is about 113 bits, which is not a security property — the code authorises
 * nothing — but is what stops somebody harvesting invitations by counting.
 */
const codeAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const inviteCodeLength = 22;

/**
 * A new code, from the platform's own random source.
 *
 * Rejection sampling rather than a modulo, so every character is equally
 * likely. The bias a modulo introduces would be invisible and harmless here,
 * and writing the unbiased version costs three lines — which is cheaper than
 * ever having to argue about whether it mattered.
 */
export function mintInviteCode(
  randomBytes: (size: number) => Uint8Array,
): string {
  const limit = Math.floor(256 / codeAlphabet.length) * codeAlphabet.length;
  let code = '';
  while (code.length < inviteCodeLength) {
    for (const byte of randomBytes(inviteCodeLength)) {
      if (code.length === inviteCodeLength) break;
      if (byte >= limit) continue;
      code += codeAlphabet.charAt(byte % codeAlphabet.length);
    }
  }
  return code;
}

/** Every acquisition fact GROWTH records, and nothing outside this list. */
export const acquisitionEventNames = [
  /** Somebody made themselves an invitation link. */
  'invite_created',
  /** An invitation address was opened, deduplicated per visitor. */
  'invite_opened',
  /** An invitation address was opened and the code was not usable. */
  'invite_refused',
  /** An account was created and GROWTH recorded where it came from. */
  'signup_attributed',
] as const;
export type AcquisitionEventName = (typeof acquisitionEventNames)[number];

/**
 * The longest a normalised campaign field is kept.
 *
 * Longer values are truncated rather than refused. A campaign name is a label
 * somebody typed into a link, and refusing a signup because that label was
 * verbose would be losing a person over a piece of bookkeeping.
 */
export const maximumAcquisitionParameterCharacters = 64;

/**
 * Somebody else's campaign string, made safe to store.
 *
 * It arrived in an address bar, so it is treated as hostile: everything outside
 * a small printable set is dropped, whitespace is collapsed, and the result is
 * cut to the stored length. What survives is a label, and a label is all this
 * value ever is — it is never read as permission, as money, or as an identity,
 * and no code path anywhere branches on it.
 *
 * An empty result is absent rather than empty string, so "did not say" and
 * "said nothing" are the same fact rather than two.
 */
export function normalizeAcquisitionParameter(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value
    .replace(/[^A-Za-z0-9 ._~+-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximumAcquisitionParameterCharacters);
  return cleaned.length === 0 ? undefined : cleaned;
}

/**
 * The name a signup's origin is counted under.
 *
 * An invitation is its own source and always wins, because a person told
 * another person and that is a different act from a link with a label on it. A
 * signup with neither is counted as `direct`, which is a real answer rather
 * than a gap: somebody typed the address, or arrived somewhere nothing tracked,
 * and pretending otherwise would be inventing a channel.
 */
export const directAcquisitionSource = 'direct';
export const invitationAcquisitionSource = 'invite';

/** How far back the operator summary counts. Fixed, so nobody reads a moving number. */
export const acquisitionSummaryDays = 30;

/**
 * The longest a scheduled live window may run.
 *
 * A window is a time people agree to be here at once, and something that runs
 * for a week is not that — it is the product's ordinary opening hours with a
 * name on it, which concentrates nobody. A day is the outer edge of a thing
 * somebody can plan around.
 */
export const maximumLiveWindowHours = 24;

/** How far ahead a window may be published before it stops being news. */
export const liveWindowHorizonDays = 30;
