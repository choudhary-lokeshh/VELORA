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
 *
 * On Android that fallback is not the exception, which is what this comment
 * used to imply. Hermes ships `Intl` — dates and times format correctly on a
 * device, and the screens prove it — but not `Intl.DisplayNames`, so every
 * region and language on this surface renders as its wire subtag: `NG` where
 * Consumer Web says "Nigeria", and "Both speak en" where it says "Both speak
 * English". Measured on an Android 36 device on 2026-08-30.
 *
 * Nothing here is fabricated by that: a subtag is the code the contract
 * carries, not an invented name, and no country list is hand-written — which
 * is the reason it was written this way and still is. But it is worse than the
 * web for every reader, and closing it means either bundling CLDR data or
 * reaching the platform's own names through a native module. Both are choices
 * with a bundle-size and dependency cost that nobody has made, so it is open
 * as "Country and language names on Android" in
 * `docs/decisions/DECISIONS_REQUIRED.md` rather than settled quietly here.
 *
 * No test can catch this. Node ships full ICU, so `DisplayNames` works under
 * Jest and the same code renders "Spain" — the device is the only place the
 * difference exists.
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
 * A date whose year is part of the fact.
 *
 * `formatDate` drops the year, which is right for a message or a gift — those
 * are recent, and "Aug 25" is how somebody would say it. It is wrong for the
 * day an account was opened, where the year is most of the information. That
 * line was the one place in the product printing a raw `toLocaleDateString()`,
 * so it read "8/25/2026" among prose dates on every other screen.
 */
export function formatFullDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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
