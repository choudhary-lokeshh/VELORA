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

/**
 * Finds which audience-scoped session cookie the caller presented. Presenting
 * more than one is ambiguous and is refused rather than resolved by preference
 * order, because guessing would be exactly the audience confusion the separate
 * names exist to prevent.
 */
export function presentedSessionCookie(
  header: string | null,
):
  | { readonly audience: BrowserAuthAudience; readonly token: string }
  | undefined {
  const found: { audience: BrowserAuthAudience; token: string }[] = [];
  for (const [audience, name] of Object.entries(browserSessionCookieNames)) {
    const token = readCookie(header, name);
    if (token !== undefined) {
      found.push({ audience: audience as BrowserAuthAudience, token });
    }
  }
  return found.length === 1 ? found[0] : undefined;
}
