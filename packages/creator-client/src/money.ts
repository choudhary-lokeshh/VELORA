import { formatMinorUnits } from '@velora/validation/money';

/**
 * Rendering an amount, once, for every creator surface that has one.
 *
 * The arithmetic belongs to the contract package, which publishes the ISO 4217
 * minor-unit exponent for every currency Velora can represent. A surface that
 * divided by a hundred would be wrong for a yen and wrong for a dinar, and
 * would be wrong silently — so nothing here re-derives what an amount means.
 *
 * Imported from the money subpath rather than the package root. The root
 * assembles every domain's schemas, and a zod object built at module scope
 * cannot be dropped by a bundler however little of it a page uses — so reaching
 * for one formatting function through it puts the whole contract in the browser
 * of somebody looking at a sign-in form.
 *
 * No currency symbol, no thousands grouping, and no locale. Those are
 * presentation decisions nobody has approved, and picking one here would put a
 * formatting opinion where a number belongs. The code travels beside the digits
 * so an amount is never ambiguous about which currency it is in.
 */

export interface WireMoney {
  readonly amountMinor: string;
  readonly currency: string;
}

export function formatMoney(value: WireMoney): string {
  return `${formatMinorUnits(value.amountMinor, value.currency)} ${value.currency}`;
}

/** The same rendering for a bare minor-unit string and its currency. */
export function formatAmount(amountMinor: string, currency: string): string {
  return formatMoney({ amountMinor, currency });
}
