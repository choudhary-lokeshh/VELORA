/**
 * Turning the codes the contract carries into words a person recognises.
 *
 * The contract stores a two-letter region and BCP 47 primary language subtags,
 * which is the right thing for it to store and the wrong thing to show
 * somebody. `Intl.DisplayNames` is the platform's own answer to that, so there
 * is no country or language list invented here — and no list implying which
 * countries VELORA is available in, which is a market-entry decision nobody has
 * made.
 *
 * An unknown or malformed code comes back as itself rather than as an error.
 * That fallback is doing more work here than on the web: Hermes ships Intl, but
 * `DisplayNames` is not guaranteed on every platform and version this
 * application runs on. Where it is missing, a person sees `ES` rather than
 * "Spain" — which is worse than the web and much better than a blank screen or
 * a hand-written country list.
 */

function displayName(
  type: 'language' | 'region',
  code: string,
): string | undefined {
  try {
    const names = new Intl.DisplayNames(undefined, { fallback: 'none', type });
    return names.of(code);
  } catch {
    return undefined;
  }
}

export function regionName(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(normalized)) return undefined;
  return displayName('region', normalized) ?? normalized;
}

export function languageName(code: string): string {
  const normalized = code.trim().toLowerCase();
  return displayName('language', normalized) ?? normalized;
}

export function languageNames(codes: readonly string[]): string {
  return codes.map(languageName).join(', ');
}

/** A clock time, in the reader's own locale and time zone. */
export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A date, for anything older than the day it happened. */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * When something happened, at the coarseness the moment deserves.
 *
 * Today reads as a clock time and anything older as a date, because "14:32" on
 * a message from last week tells somebody nothing they wanted to know.
 */
export function formatWhen(value: string, now: Date = new Date()): string {
  const at = new Date(value);
  return at.toDateString() === now.toDateString()
    ? formatTime(value)
    : formatDate(value);
}
