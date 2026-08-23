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
 * The server has already validated the shape; a display helper that threw would
 * turn an unfamiliar but valid code into a blank screen.
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

/**
 * A timestamp, in the reader's own locale, at the coarseness the moment
 * deserves.
 *
 * Rendered on the client only. The server renders a page before it knows the
 * reader's locale or time zone, so formatting a date during that render and
 * again in the browser produces two different strings for the same instant and
 * a hydration mismatch — which is why every caller of this passes through a
 * component that waits for the browser.
 */
export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A date and a time, without the seconds nobody needs. */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'long',
  });
}

export function formatDay(value: string): string {
  const at = new Date(value);
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  if (sameDay) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    at.getFullYear() === yesterday.getFullYear() &&
    at.getMonth() === yesterday.getMonth() &&
    at.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * How long ago, said the way somebody would say it.
 *
 * Coarse on purpose. A notice that claimed "37 seconds ago" would be precise
 * about something nobody needs precision about, and would go stale between the
 * render and the read.
 */
export function formatRelative(
  value: string,
  now: number = Date.now(),
): string {
  const elapsed = now - new Date(value).getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  return formatDay(value);
}
