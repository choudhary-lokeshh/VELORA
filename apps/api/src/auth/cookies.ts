import {
  browserSessionCookieNames,
  type BrowserAuthAudience,
} from '@velora/validation';

/**
 * Browser session cookie construction.
 *
 * The attributes come from ADR-0017 and are identical in every environment.
 * `__Host-` requires `Secure` and a browser only accepts `Secure` over a
 * trustworthy origin, which includes `localhost` and `127.0.0.1`, so local
 * development runs the production policy rather than a weakened variant. There
 * is deliberately no branch that relaxes an attribute for convenience.
 */

const fixedAttributes = ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax'];

export function browserSessionCookieName(
  audience: BrowserAuthAudience,
): string {
  return browserSessionCookieNames[audience];
}

export function issuedSessionCookie(input: {
  readonly audience: BrowserAuthAudience;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly token: string;
}): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((input.expiresAt.getTime() - input.now.getTime()) / 1000),
  );
  return [
    `${browserSessionCookieName(input.audience)}=${input.token}`,
    ...fixedAttributes,
    `Max-Age=${String(maxAgeSeconds)}`,
  ].join('; ');
}

export function clearedSessionCookie(audience: BrowserAuthAudience): string {
  return [
    `${browserSessionCookieName(audience)}=`,
    ...fixedAttributes,
    'Max-Age=0',
  ].join('; ');
}

/** Reads one cookie value from a `Cookie` header without trusting its shape. */
export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export interface PresentedSessionCookie {
  readonly audience: BrowserAuthAudience;
  readonly token: string;
}

/**
 * Every audience-scoped session cookie the caller presented.
 *
 * Usually there is at most one: the cookies carry different names and, in a
 * deployment where each surface has its own host, a browser only holds the one
 * for the host it is talking about. More than one appears when two surfaces
 * share a host — which is what a developer running everything on loopback has,
 * because a cookie is scoped to a host and ignores the port.
 */
export function presentedSessionCookies(
  header: string | null,
): readonly PresentedSessionCookie[] {
  const found: PresentedSessionCookie[] = [];
  for (const [audience, name] of Object.entries(browserSessionCookieNames)) {
    const token = readCookie(header, name);
    if (token !== undefined) {
      found.push({ audience: audience as BrowserAuthAudience, token });
    }
  }
  return found;
}

/**
 * Which audience-scoped session cookie this request is actually using.
 *
 * With one cookie there is nothing to decide. With several, the surface that
 * sent the request says which it is: the `Origin` header is set by the browser,
 * cannot be forged by page script, and is matched against the origins that
 * audience is configured to accept — so this is a lookup, not a preference
 * order, and the answer is then validated by the same origin check every
 * browser request already passes.
 *
 * Anything that does not resolve to exactly one audience is refused rather than
 * guessed at, because guessing would be exactly the audience confusion the
 * separate names exist to prevent. A request with no origin and several cookies
 * is therefore refused, and a foreign origin matches no audience at all.
 */
export function presentedSessionCookie(
  header: string | null,
  disambiguation?: {
    readonly allowedOrigins: Readonly<
      Record<BrowserAuthAudience, readonly string[]>
    >;
    readonly origin: string | null;
  },
): PresentedSessionCookie | undefined {
  const found = presentedSessionCookies(header);
  if (found.length <= 1) return found[0];
  if (disambiguation === undefined) return undefined;
  const { allowedOrigins, origin } = disambiguation;
  if (origin === null) return undefined;
  const matching = found.filter((candidate) =>
    allowedOrigins[candidate.audience].includes(origin),
  );
  return matching.length === 1 ? matching[0] : undefined;
}
